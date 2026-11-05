import "server-only";
import { prisma } from "@/shared/lib/prisma";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit, assertOrgActive } from "@/shared/audit";
import { generateIdempotencyKey } from "@/shared/lib/security";
import type { AuthContext } from "@/shared/auth";
import {
  getAdapter,
  type ProviderResultStatus,
} from "./adapter";
import { registerAllAdapters } from "./adapters";

// Regista os adaptadores apenas no módulo de serviço, executado no servidor.
registerAllAdapters();
import type { InitiatePaymentInput, ManualReviewInput } from "./schemas";
import { markHoldVerifying } from "@/modules/inventory/service";

// ============================================================
// Módulo payments — orquestração (Domínio 5).
//
// Decisões aprovadas implementadas:
// - Opção B: novas tentativas controladas (PaymentAttempt numerado;
//   tentativa confirmada BLOQUEIA as restantes).
// - Opção C: pagamentos pendentes/sem resultado definitivo →
//   InventoryHold.VERIFYING (inventário protegido); análise manual
//   por operador autorizado exige evidência escrita; ninguém marca
//   como paga sem evidência.
// - Emissão de bilhetes apenas após confirmação idempotente.
// ============================================================

const PROVIDER_STATUS_MAP: Record<ProviderResultStatus, string> = {
  INITIATED: "INITIATED",
  AWAITING_AUTHORIZATION: "AWAITING_AUTHORIZATION",
  PROCESSING: "PROCESSING",
  CONFIRMED: "CONFIRMED",
  DECLINED: "DECLINED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNDER_REVIEW",
};

export async function listPaymentOptions(currency: string) {
  const providers = await prisma.paymentProvider.findMany({
    where: { isActive: true },
    select: { code: true, name: true, country: true, adapterConfig: true },
    orderBy: { name: "asc" },
  });

  return providers.flatMap((provider) => {
    const adapter = getAdapter(provider.code);
    const adapterConfig = (provider.adapterConfig ?? {}) as Record<string, unknown>;
    if (
      !adapter ||
      !adapter.isConfigured(adapterConfig) ||
      (adapter.supportedCurrencies &&
        !adapter.supportedCurrencies.includes(currency))
    ) {
      return [];
    }

    return adapter.supportedMethods.map((method) => ({
      providerCode: provider.code,
      providerName: provider.name,
      country: provider.country,
      method,
    }));
  });
}

/** Iniciar pagamento: cria/atualiza Payment + nova tentativa (Opção B). */
export async function initiatePayment(ctx: AuthContext, input: InitiatePaymentInput) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new NotFoundError("Encomenda");
  const isBuyer = order.buyerUserId === ctx.userId;
  const isOrgOperator =
    ctx.organizationId === order.organizationId && ctx.permissions.has("boxoffice:sell");
  if (!isBuyer && !isOrgOperator) throw new ForbiddenError("not-buyer");
  await assertOrgActive(order.organizationId);
  if (
    isOrgOperator &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  if (order.status !== "RESERVED" && order.status !== "PENDING_PAYMENT") {
    throw new ConflictError(`Encomenda em estado ${order.status}.`);
  }
  if (order.holdId) {
    const hold = await prisma.inventoryHold.findUnique({
      where: { id: order.holdId },
      select: { status: true, organizationId: true, expiresAt: true },
    });
    if (
      !hold ||
      hold.organizationId !== order.organizationId ||
      hold.expiresAt <= new Date() ||
      !["RESERVED", "PENDING_PAYMENT", "VERIFYING"].includes(hold.status)
    ) {
      throw new BusinessRuleError("A reserva de inventário já não está ativa para pagamento.");
    }
  }

  const provider = await prisma.paymentProvider.findUnique({
    where: { code: input.providerCode },
  });
  if (!provider || !provider.isActive) throw new NotFoundError("Prestador");
  const adapter = getAdapter(provider.code);
  if (!adapter) throw new AppError("ADAPTER_MISSING", 500, "Adaptador do prestador não instalado.");
  const adapterConfig = (provider.adapterConfig ?? {}) as Record<string, unknown>;
  if (!adapter.isConfigured(adapterConfig)) {
    throw new BusinessRuleError("Este meio de pagamento ainda não está configurado.");
  }
  if (!adapter.supportedMethods.includes(input.method)) {
    throw new BusinessRuleError("O prestador não suporta este método de pagamento.");
  }
  if (
    adapter.supportedCurrencies &&
    !adapter.supportedCurrencies.includes(order.currency)
  ) {
    throw new BusinessRuleError("Este prestador não aceita a moeda da encomenda.");
  }

  const attemptKey = input.idempotencyKey ?? generateIdempotencyKey();
  const existingAttempt = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: attemptKey },
    include: { payment: { select: { id: true, orderId: true, organizationId: true, providerId: true } } },
  });
  if (existingAttempt) {
    if (
      existingAttempt.payment.orderId !== order.id ||
      existingAttempt.payment.organizationId !== order.organizationId ||
      existingAttempt.payment.providerId !== provider.id
    ) {
      throw new ConflictError("Chave de idempotência de pagamento já utilizada.");
    }
    return { paymentId: existingAttempt.paymentId, alreadyStarted: true };
  }

  // Um pagamento por encomenda/prestador; o advisory lock evita duas linhas
  // concorrentes e a claim bloqueia uma segunda tentativa enquanto a primeira decorre.
  const payment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id}::uuid FOR UPDATE`;
    const freshOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true, holdId: true, organizationId: true },
    });
    if (
      !freshOrder ||
      !["RESERVED", "PENDING_PAYMENT"].includes(freshOrder.status) ||
      freshOrder.organizationId !== order.organizationId
    ) {
      throw new ConflictError("A encomenda foi alterada antes da iniciação do pagamento.");
    }
    if (freshOrder.holdId) {
      const freshHold = await tx.inventoryHold.findUnique({
        where: { id: freshOrder.holdId },
        select: { status: true, organizationId: true, expiresAt: true },
      });
      if (
        !freshHold ||
        freshHold.organizationId !== order.organizationId ||
        freshHold.expiresAt <= new Date() ||
        !["RESERVED", "PENDING_PAYMENT", "VERIFYING"].includes(freshHold.status)
      ) {
        throw new BusinessRuleError("A reserva de inventário já não está ativa para pagamento.");
      }
    }
    const lockKey = `payment-init:${order.id}:${provider.id}`;
    await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS locked
    `;
    let current = await tx.payment.findFirst({
      where: { orderId: order.id, providerId: provider.id },
    });
    const otherActivePayment = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        status: { in: ["INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] },
        ...(current ? { id: { not: current.id } } : {}),
      },
      select: { id: true },
    });
    if (otherActivePayment) {
      throw new ConflictError("Já existe um pagamento ativo para esta encomenda noutro prestador.");
    }
    if (!current) {
      current = await tx.payment.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          providerId: provider.id,
          method: input.method,
          status: "CREATED",
          amountCents: order.totalCents,
          currency: order.currency,
        },
      });
    }
    const claimed = await tx.payment.updateMany({
      where: {
        id: current.id,
        status: { in: ["CREATED", "DECLINED", "CANCELLED", "EXPIRED"] },
      },
      data: { status: "INITIATED" },
    });
    if (claimed.count !== 1) {
      throw new ConflictError("Já existe uma tentativa de pagamento em curso ou em revisão.");
    }
    // Bloqueia tentativas anteriores antes de chamar novamente o prestador.
    await tx.paymentAttempt.updateMany({
      where: { paymentId: current.id, status: "ACTIVE" },
      data: { status: "BLOCKED", finishedAt: new Date() },
    });
    const orderClaim = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
      data: { status: "PENDING_PAYMENT" },
    });
    if (orderClaim.count !== 1) {
      throw new ConflictError("A encomenda foi alterada antes da iniciação do pagamento.");
    }
    if (freshOrder.holdId) {
      const holdClaim = await tx.inventoryHold.updateMany({
        where: {
          id: freshOrder.holdId,
          organizationId: order.organizationId,
          status: { in: ["RESERVED", "PENDING_PAYMENT", "VERIFYING"] },
        },
        data: { status: "PENDING_PAYMENT" },
      });
      if (holdClaim.count !== 1) {
        throw new BusinessRuleError("A reserva de inventário deixou de estar ativa.");
      }
    }
    return current;
  });

  // Se o adaptador falhar, o resultado pode ser incerto. Mantém o inventário
  // protegido até revisão manual em vez de libertar uma venda possivelmente paga.
  let result: Awaited<ReturnType<typeof adapter.initiate>>;
  try {
    result = await adapter.initiate({
    paymentId: payment.id,
    amountCents: order.totalCents,
    currency: order.currency,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/checkout/return?order=${order.id}`,
    idempotencyKey: attemptKey,
    adapterConfig,
    });
  } catch {
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: payment.id, status: "INITIATED" },
        data: { status: "UNDER_REVIEW" },
      });
      if (order.holdId) {
        await tx.inventoryHold.updateMany({
          where: {
            id: order.holdId,
            organizationId: order.organizationId,
            status: { in: ["RESERVED", "PENDING_PAYMENT", "VERIFYING"] },
          },
          data: { status: "VERIFYING" },
        });
      }
    });
    await writeAudit({
      organizationId: order.organizationId,
      actorUserId: ctx.userId,
      action: "payment.initiation_uncertain",
      after: sanitizeForAudit({ paymentId: payment.id, provider: provider.code }),
    });
    throw new AppError("PAYMENT_PROVIDER_UNCERTAIN", 502, "Não foi possível confirmar a resposta do prestador. O pagamento ficou em revisão.");
  }

  const paymentId = payment.id;
  const statusFromProvider = PROVIDER_STATUS_MAP[result.status] as never;
  const terminalDecline = ["DECLINED", "CANCELLED", "EXPIRED"].includes(result.status);
  const attached = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
    const attemptNumber = (await tx.paymentAttempt.count({ where: { paymentId } })) + 1;
    const freshPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true },
    });
    if (!freshPayment || freshPayment.status !== "INITIATED") {
      // Outra confirmação/revisão ganhou a corrida enquanto o prestador respondia.
      // Regista esta tentativa como bloqueada; um callback posterior vai para revisão.
      await tx.paymentAttempt.create({
        data: {
          paymentId,
          attemptNumber,
          status: "BLOCKED",
          finishedAt: new Date(),
          idempotencyKey: attemptKey,
          providerRef: result.providerRef,
          notes: "Resposta recebida após alteração concorrente do estado do pagamento.",
        },
      });
      return false;
    }
    await tx.paymentAttempt.updateMany({
      where: { paymentId, status: "ACTIVE" },
      data: { status: "BLOCKED", finishedAt: new Date() },
    });
    await tx.paymentAttempt.create({
      data: {
        paymentId,
        attemptNumber,
        status: terminalDecline ? "FAILED" : "ACTIVE",
        finishedAt: terminalDecline ? new Date() : null,
        idempotencyKey: attemptKey,
        providerRef: result.providerRef,
      },
    });
    const paymentUpdated = await tx.payment.updateMany({
      where: { id: paymentId, status: "INITIATED" },
      data: {
        status: result.status === "CONFIRMED" ? "PROCESSING" : statusFromProvider,
        providerRef: result.providerRef,
        providerRawPayload: result.rawPayload as never,
      },
    });
    if (paymentUpdated.count !== 1) return false;

    const orderClaim = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
      data: { status: "PENDING_PAYMENT" },
    });
    if (orderClaim.count !== 1) {
      if (!terminalDecline) {
        await tx.payment.updateMany({
          where: { id: paymentId, status: { not: "DECLINED" } },
          data: { status: "UNDER_REVIEW" },
        });
      }
      return false;
    }

    if (order.holdId) {
      const holdClaim = await tx.inventoryHold.updateMany({
        where: {
          id: order.holdId,
          organizationId: order.organizationId,
          status: { in: ["RESERVED", "PENDING_PAYMENT", "VERIFYING"] },
        },
        data: {
          status: result.status === "UNKNOWN" ? "VERIFYING" : "PENDING_PAYMENT",
          ...(terminalDecline ? { expiresAt: new Date(Date.now() + 10 * 60 * 1000) } : {}),
        },
      });
      if (holdClaim.count !== 1) {
        if (!terminalDecline) {
          await tx.payment.updateMany({
            where: { id: paymentId, status: { not: "DECLINED" } },
            data: { status: "UNDER_REVIEW" },
          });
        }
        return false;
      }
    }
    return true;
  });

  await writeAudit({
    organizationId: order.organizationId,
    actorUserId: ctx.userId,
    action: "payment.initiated",
    after: sanitizeForAudit({
      paymentId,
      provider: provider.code,
      amountCents: order.totalCents,
      outcomeAttachedToOrder: attached,
      providerStatus: result.status,
    }),
  });
  if (!attached) {
    if (!terminalDecline) {
      await flagOrderForPaymentReview(order.id, result.rawPayload);
    }
    throw new BusinessRuleError("A encomenda foi alterada durante a iniciação. O resultado do prestador permanece em revisão.");
  }

  if (result.status === "CONFIRMED") {
    await confirmPayment(result.providerRef, result.rawPayload, provider.code);
  }

  return {
    paymentId,
    attemptId: attemptKey,
    redirectUrl: result.redirectUrl,
    providerRef: result.providerRef,
  };
}

/** Confirmação idempotente: atualiza Payment, encomenda, hold e emite bilhetes. */
async function flagOrderForPaymentReview(
  orderId: string,
  rawPayload: unknown,
  blockedAttemptId?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, holdId: true },
    });
    const payments = await tx.payment.findMany({ where: { orderId }, select: { id: true } });
    const paymentIds = payments.map((item) => item.id);
    if (paymentIds.length > 0) {
      await tx.payment.updateMany({
        where: {
          id: { in: paymentIds },
          status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW", "DECLINED", "CANCELLED", "EXPIRED"] },
        },
        data: { status: "UNDER_REVIEW", providerRawPayload: rawPayload as never },
      });
      await tx.paymentAttempt.updateMany({
        where: { paymentId: { in: paymentIds }, status: "ACTIVE" },
        data: { status: "BLOCKED", finishedAt: new Date() },
      });
    }
    if (blockedAttemptId) {
      await tx.paymentAttempt.updateMany({
        where: { id: blockedAttemptId, status: { in: ["BLOCKED", "FAILED"] } },
        data: { notes: "Callback tardio de tentativa bloqueada; encaminhado para revisão financeira." },
      });
    }
    if (order?.holdId && ["RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
      await tx.inventoryHold.updateMany({
        where: { id: order.holdId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
        data: { status: "VERIFYING" },
      });
    }
  });
}

export async function confirmPayment(
  providerRef: string,
  rawPayload: unknown,
  providerCode?: string
): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: {
      providerRef,
      ...(providerCode ? { provider: { code: providerCode } } : {}),
    },
    include: { order: { include: { lines: true } } },
  });
  if (!payment) {
    console.error("[webhook] payment-not-found", { providerRef });
    return;
  }
  const matchingAttempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId: payment.id, providerRef },
    select: { id: true, status: true },
  });
  if (matchingAttempt && ["BLOCKED", "FAILED"].includes(matchingAttempt.status)) {
    await flagOrderForPaymentReview(payment.orderId, rawPayload, matchingAttempt.id);
    await writeAudit({
      organizationId: payment.organizationId,
      actorUserId: null,
      action: "payment.blocked_attempt_confirmation",
      after: sanitizeForAudit({ paymentId: payment.id, attemptId: matchingAttempt.id, providerRef }),
    });
    return;
  }
  // A confirmação financeira pode ter sido persistida antes de uma falha
  // transitória na emissão dos bilhetes. Repetir a emissão é seguro:
  // issueTicketsForOrder serializa por encomenda e não duplica bilhetes.
  if (payment.status === "CONFIRMED") {
    if (payment.order.status === "CONFIRMED") {
      const { issueTicketsForOrder } = await import("@/modules/access/service");
      await issueTicketsForOrder(payment.orderId);
    }
    return;
  }

  const didConfirm = await prisma.$transaction(async (tx) => {
    // Ordem de locks consistente: encomenda → pagamento → reserva.
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${payment.orderId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
    // Não confirmar pagamento se o hold foi libertado/expirado.
    const hold = payment.order.holdId
      ? await tx.inventoryHold.findUnique({
          where: { id: payment.order.holdId },
          select: { id: true, status: true, sessionId: true, quantity: true },
        })
      : null;
    if (payment.order.holdId && (!hold || !["RESERVED", "PENDING_PAYMENT", "VERIFYING", "CONFIRMED"].includes(hold.status))) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] } },
        data: { status: "UNDER_REVIEW", providerRawPayload: rawPayload as never },
      });
      return false;
    }

    // Claim do pagamento primeiro. DECLINED/CANCELLED/EXPIRED nunca passam
    // diretamente a CONFIRMED; callbacks tardios seguem para revisão manual.
    const paymentClaim = await tx.payment.updateMany({
      where: {
        id: payment.id,
        providerRef,
        status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] },
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        providerRawPayload: rawPayload as never,
      },
    });
    if (paymentClaim.count !== 1) {
      const fresh = await tx.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
      if (fresh && ["DECLINED", "CANCELLED", "EXPIRED"].includes(fresh.status)) {
        const reopened = await tx.payment.updateMany({
          where: { id: payment.id, status: fresh.status },
          data: { status: "UNDER_REVIEW", providerRawPayload: rawPayload as never },
        });
        if (reopened.count === 1) {
          const order = await tx.order.findUnique({
            where: { id: payment.orderId },
            select: { status: true, holdId: true },
          });
          if (order?.holdId && ["RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
            await tx.inventoryHold.updateMany({
              where: { id: order.holdId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
              data: { status: "VERIFYING" },
            });
          }
        }
      }
      return false;
    }

    // Uma encomenda só pode ser confirmada por um pagamento.
    const orderClaim = await tx.order.updateMany({
      where: { id: payment.orderId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    if (orderClaim.count !== 1) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: "CONFIRMED" },
        data: { status: "UNDER_REVIEW" },
      });
      return false;
    }

    if (hold && hold.status !== "CONFIRMED") {
      const holdClaim = await tx.inventoryHold.updateMany({
        where: { id: hold.id, status: hold.status },
        data: { status: "CONFIRMED", releasedAt: new Date() },
      });
      if (holdClaim.count !== 1) throw new ConflictError("Reserva alterada durante a confirmação do pagamento.");
      for (const line of payment.order.lines) {
        const inv = await tx.ticketInventory.findUnique({
          where: {
            sessionId_ticketTypeId_batchId: {
              sessionId: payment.order.sessionId ?? hold.sessionId,
              ticketTypeId: line.ticketTypeId,
              batchId: line.batchId,
            },
          },
          select: { id: true },
        });
        if (!inv) throw new BusinessRuleError("Inventário da encomenda não encontrado.");
        await tx.ticketInventory.update({
          where: { id: inv.id },
          data: {
            reservedQuantity: { decrement: line.quantity },
            soldQuantity: { increment: line.quantity },
          },
        });
      }
    }

    await tx.paymentAttempt.updateMany({
      where: { paymentId: payment.id, status: "ACTIVE" },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    await tx.paymentAttempt.updateMany({
      where: { paymentId: payment.id, status: "BLOCKED" },
      data: { finishedAt: new Date() },
    });
    if (payment.order.channel === "BOX_OFFICE" && payment.order.shiftId) {
      await tx.cashShift.updateMany({
        where: { id: payment.order.shiftId },
        data: {
          totalSalesCents: { increment: payment.amountCents },
          ...(payment.method === "CASH" ? { expectedCents: { increment: payment.amountCents } } : {}),
        },
      });
    }
    return true;
  });

  if (!didConfirm) return;

  const { issueTicketsForOrder } = await import("@/modules/access/service");
  await issueTicketsForOrder(payment.orderId);
  await writeAudit({
    organizationId: payment.organizationId,
    actorUserId: null,
    action: "payment.confirmed",
    after: sanitizeForAudit({ paymentId: payment.id, providerRef }),
  });
}

/** Webhook: validar assinatura + rotear estado (nunca confiar no corpo). */
export async function handleWebhook(
  providerCode: string,
  rawBody: string,
  headers: Record<string, string>
): Promise<{ processed: boolean }> {
  const provider = await prisma.paymentProvider.findUnique({ where: { code: providerCode } });
  if (!provider || !provider.isActive) throw new NotFoundError("Prestador");
  const adapter = getAdapter(providerCode);
  if (!adapter) throw new AppError("ADAPTER_MISSING", 500, "Adaptador não instalado.");

  const payload = adapter.verifyWebhook(
    rawBody,
    headers,
    (provider.adapterConfig ?? {}) as Record<string, unknown>
  );
  if (!payload) {
    throw new AppError("WEBHOOK_INVALID", 401, "Assinatura de webhook inválida.");
  }

  const payment = await prisma.payment.findFirst({
    where: {
      providerRef: payload.providerRef,
      provider: { code: providerCode },
    },
    select: { id: true, amountCents: true, orderId: true, organizationId: true, status: true },
  });
  if (!payment) {
    // Tentativa antiga/bloqueada: nunca emitir bilhetes automaticamente, mas
    // não ignorar uma eventual captura tardia que possa exigir reembolso.
    const staleAttempt = await prisma.paymentAttempt.findFirst({
      where: {
        providerRef: payload.providerRef,
        payment: { provider: { code: providerCode } },
      },
      include: {
        payment: {
          include: {
            order: { select: { id: true, status: true, holdId: true } },
          },
        },
      },
    });
    if (!staleAttempt) return { processed: false };
    if (["BLOCKED", "FAILED"].includes(staleAttempt.status)) {
      if (
        payload.status === "CONFIRMED" ||
        payload.status === "UNKNOWN" ||
        payload.amountCents !== staleAttempt.payment.amountCents
      ) {
        await flagOrderForPaymentReview(
          staleAttempt.payment.orderId,
          payload.rawPayload,
          staleAttempt.id
        );
        await writeAudit({
          organizationId: staleAttempt.payment.organizationId,
          actorUserId: null,
          action: "payment.blocked_attempt_callback",
          after: sanitizeForAudit({
            paymentId: staleAttempt.paymentId,
            attemptId: staleAttempt.id,
            providerRef: payload.providerRef,
            providerStatus: payload.status,
          }),
        });
      } else if (["DECLINED", "CANCELLED", "EXPIRED"].includes(payload.status)) {
        await prisma.paymentAttempt.updateMany({
          where: { id: staleAttempt.id, status: staleAttempt.status },
          data: { status: "FAILED", finishedAt: new Date() },
        });
      }
      return { processed: true };
    }
    return { processed: false };
  }
  // Um webhook não confirmado não pode rebaixar um pagamento já confirmado.
  // Confirmações de tentativas bloqueadas seguem para auditoria/revisão abaixo.
  if (payment.status === "CONFIRMED" && payload.status !== "CONFIRMED") {
    return { processed: true };
  }

  // Montante tem de bater com o registado (conciliação server-side)
  if (payload.amountCents !== payment.amountCents) {
    // Divergência → resultado indefinido: inventário protegido + revisão manual
    const changed = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW", "DECLINED", "CANCELLED", "EXPIRED"] },
      },
      data: { status: "UNDER_REVIEW", providerRawPayload: payload.rawPayload as never },
    });
    if (changed.count === 1) {
      const order = await prisma.order.findUnique({
        where: { id: payment.orderId },
        select: { holdId: true },
      });
      if (order?.holdId) await markHoldVerifying(order.holdId);
      throw new AppError("AMOUNT_MISMATCH", 409, "Divergência de valor: encaminhado para revisão.");
    }
    await writeAudit({
      organizationId: payment.organizationId,
      actorUserId: null,
      action: "payment.webhook_amount_mismatch_after_state_change",
      after: sanitizeForAudit({ paymentId: payment.id, providerRef: payload.providerRef }),
    });
    return { processed: true };
  }

  if (payload.status === "CONFIRMED") {
    await confirmPayment(payload.providerRef, payload.rawPayload, providerCode);
  } else if (["DECLINED", "CANCELLED", "EXPIRED"].includes(payload.status)) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${payment.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
      const changed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] },
        },
        data: { status: PROVIDER_STATUS_MAP[payload.status] as never },
      });
      if (changed.count !== 1) return;
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: "ACTIVE" },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { status: true, holdId: true },
      });
      if (order?.holdId && ["RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
        await tx.inventoryHold.updateMany({
          where: {
            id: order.holdId,
            status: { in: ["RESERVED", "PENDING_PAYMENT", "VERIFYING"] },
          },
          data: {
            status: "PENDING_PAYMENT",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
      }
    });
  } else if (payload.status === "UNKNOWN") {
    // Sem resultado definitivo: protege inventário e marca revisão sem
    // rebaixar um pagamento que outro webhook já confirmou.
    const changed = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] },
      },
      data: { status: "UNDER_REVIEW", providerRawPayload: payload.rawPayload as never },
    });
    if (changed.count === 1) {
      const order = await prisma.order.findUnique({
        where: { id: payment.orderId },
        select: { holdId: true },
      });
      if (order?.holdId) await markHoldVerifying(order.holdId);
    }
  }

  return { processed: true };
}

/** Opção C: revisão manual por operador autorizado — exige evidência escrita. */
export async function manualReview(ctx: AuthContext, input: ManualReviewInput): Promise<void> {
  const organizationId = ctx.organizationId;
  if (!organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("payment:review")) throw new ForbiddenError("payment:review");

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
  });
  if (!payment || payment.organizationId !== organizationId) {
    throw new NotFoundError("Pagamento");
  }
  if (payment.status !== "UNDER_REVIEW" && payment.status !== "AWAITING_AUTHORIZATION") {
    throw new BusinessRuleError("Pagamento não está pendente de análise.");
  }

  if (input.decision === "CONFIRM") {
    // A confirmação manual percorre o mesmo fluxo transacional da confirmação
    // do prestador: pagamento, encomenda, inventário e bilhetes.
    const provider = await prisma.paymentProvider.findUnique({
      where: { id: payment.providerId },
      select: { code: true },
    });
    if (!provider) throw new NotFoundError("Prestador");

    const manualProviderRef = payment.providerRef ?? `manual_${payment.id}`;
    if (!payment.providerRef) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef: manualProviderRef },
      });
    }
    await confirmPayment(
      manualProviderRef,
      { source: "manual-review", evidenceNotes: input.evidenceNotes },
      provider.code
    );
    const confirmedPayment = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (confirmedPayment?.status !== "CONFIRMED") {
      await writeAudit({
        organizationId: organizationId,
        actorUserId: ctx.userId,
        action: "payment.reviewed_late_confirmation",
        after: sanitizeForAudit({
          paymentId: payment.id,
          decision: "CONFIRM",
          outcome: confirmedPayment?.status ?? "UNKNOWN",
          evidence: input.evidenceNotes,
        }),
      });
      throw new BusinessRuleError(
        "A encomenda já não pode ser confirmada automaticamente; o pagamento permanece em revisão financeira."
      );
    }
    await writeAudit({
      organizationId: organizationId,
      actorUserId: ctx.userId,
      action: "payment.reviewed",
      after: sanitizeForAudit({
        paymentId: payment.id,
        decision: "CONFIRM",
        evidence: input.evidenceNotes,
      }),
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${payment.orderId}::uuid FOR UPDATE`;
      const changed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          organizationId: organizationId,
          status: { in: ["UNDER_REVIEW", "AWAITING_AUTHORIZATION"] },
        },
        data: { status: "DECLINED" },
      });
      if (changed.count !== 1) throw new ConflictError("Pagamento já foi processado.");

      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: "ACTIVE" },
        data: { status: "FAILED", finishedAt: new Date() },
      });

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { status: true, holdId: true },
      });
      if (order?.status === "PENDING_PAYMENT") {
        await tx.order.updateMany({
          where: { id: payment.orderId, status: "PENDING_PAYMENT" },
          data: { status: "RESERVED" },
        });
      }
      if (order?.holdId && ["RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
        await tx.inventoryHold.updateMany({
          where: {
            id: order.holdId,
            status: { in: ["PENDING_PAYMENT", "VERIFYING"] },
          },
          data: {
            status: "RESERVED",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            releasedAt: null,
          },
        });
      }
    });
    await writeAudit({
      organizationId: organizationId,
      actorUserId: ctx.userId,
      action: "payment.reviewed",
      after: sanitizeForAudit({
        paymentId: payment.id,
        decision: "DECLINE",
        evidence: input.evidenceNotes,
      }),
    });
  }
}
