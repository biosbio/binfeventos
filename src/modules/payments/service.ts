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
import { getAdapter, type ProviderResultStatus } from "./adapter";
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

  const provider = await prisma.paymentProvider.findUnique({
    where: { code: input.providerCode },
  });
  if (!provider || !provider.isActive) throw new NotFoundError("Prestador");
  const adapter = getAdapter(provider.code);
  if (!adapter) throw new AppError("ADAPTER_MISSING", 500, "Adaptador do prestador não instalado.");
  if (provider.code === "multicaixa-express" && order.currency !== "AOA") {
    throw new BusinessRuleError("Multicaixa Express só aceita encomendas em AOA.");
  }

  // Idempotência da tentativa
  const attemptKey = input.idempotencyKey ?? generateIdempotencyKey();
  const existingAttempt = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: attemptKey },
    include: { payment: { select: { id: true, orderId: true, organizationId: true } } },
  });
  if (existingAttempt) {
    if (
      existingAttempt.payment.orderId !== order.id ||
      existingAttempt.payment.organizationId !== order.organizationId
    ) {
      throw new ConflictError("Chave de idempotência de pagamento já utilizada.");
    }
    return { paymentId: existingAttempt.paymentId, alreadyStarted: true };
  }

  // Payment da encomenda (um por prestador; tentativas dentro dele)
  let payment = await prisma.payment.findFirst({
    where: { orderId: order.id, providerId: provider.id },
  });
  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        organizationId: order.organizationId,
        orderId: order.id,
        providerId: provider.id,
        method: input.method,
        status: "CREATED",
        // Valor SEMPRE da encomenda (server-side); cliente não envia montante
        amountCents: order.totalCents,
        currency: order.currency,
      },
    });
  }

  const nextAttemptNumber =
    (await prisma.paymentAttempt.count({ where: { paymentId: payment.id } })) + 1;

  // Chama o adaptador (configuração resolvida no backend)
  const result = await adapter.initiate({
    paymentId: payment.id,
    amountCents: order.totalCents,
    currency: order.currency,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/checkout/return?order=${order.id}`,
    idempotencyKey: attemptKey,
    adapterConfig: (provider.adapterConfig ?? {}) as Record<string, unknown>,
  });

  const paymentId = payment.id;
  await prisma.$transaction(async (tx) => {
    // Opção B: nova tentativa bloqueia as anteriores ativas
    await tx.paymentAttempt.updateMany({
      where: { paymentId, status: "ACTIVE" },
      data: { status: "BLOCKED" },
    });

    await tx.paymentAttempt.create({
      data: {
        paymentId,
        attemptNumber: nextAttemptNumber,
        status: "ACTIVE",
        idempotencyKey: attemptKey,
        providerRef: result.providerRef,
      },
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: PROVIDER_STATUS_MAP[result.status] as never,
        providerRef: result.providerRef,
        providerRawPayload: result.rawPayload as never,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: "PENDING_PAYMENT" },
    });

    if (order.holdId) {
      // Enquanto não há resultado definitivo, inventário protegido
      await tx.inventoryHold.update({
        where: { id: order.holdId },
        data: { status: "PENDING_PAYMENT" },
      });
    }
  });

  await writeAudit({
    organizationId: order.organizationId,
    actorUserId: ctx.userId,
    action: "payment.initiated",
    after: sanitizeForAudit({
      paymentId,
      attempt: nextAttemptNumber,
      provider: provider.code,
      amountCents: order.totalCents,
    }),
  });

  return {
    paymentId,
    attemptId: attemptKey,
    redirectUrl: result.redirectUrl,
    providerRef: result.providerRef,
  };
}

/** Confirmação idempotente: atualiza Payment, encomenda, hold e emite bilhetes. */
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
  if (payment.status === "CONFIRMED") return;

  const didConfirm = await prisma.$transaction(async (tx) => {
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
        await tx.payment.updateMany({
          where: { id: payment.id, status: fresh.status },
          data: { status: "UNDER_REVIEW", providerRawPayload: rawPayload as never },
        });
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
    select: { id: true, amountCents: true, orderId: true, status: true },
  });
  if (!payment) return { processed: false }; // ignora transações desconhecidas
  // Um webhook atrasado não pode rebaixar um pagamento já confirmado.
  if (payment.status === "CONFIRMED") return { processed: true };

  // Montante tem de bater com o registado (conciliação server-side)
  if (payload.amountCents !== payment.amountCents) {
    // Divergência → resultado indefinido: inventário protegido + revisão manual
    const order = await prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { holdId: true },
    });
    if (order?.holdId) {
      await markHoldVerifying(order.holdId);
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "UNDER_REVIEW", providerRawPayload: payload.rawPayload as never },
    });
    throw new AppError("AMOUNT_MISMATCH", 409, "Divergência de valor: encaminhado para revisão.");
  }

  if (payload.status === "CONFIRMED") {
    await confirmPayment(payload.providerRef, payload.rawPayload, providerCode);
  } else if (["DECLINED", "CANCELLED", "EXPIRED"].includes(payload.status)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PROVIDER_STATUS_MAP[payload.status] as never },
    });
  } else if (payload.status === "UNKNOWN") {
    // Sem resultado definitivo: protege inventário e marca revisão
    const order = await prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { holdId: true },
    });
    if (order?.holdId) {
      await markHoldVerifying(order.holdId);
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "UNDER_REVIEW" },
    });
  }

  return { processed: true };
}

/** Opção C: revisão manual por operador autorizado — exige evidência escrita. */
export async function manualReview(ctx: AuthContext, input: ManualReviewInput): Promise<void> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("payment:review")) throw new ForbiddenError("payment:review");

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
  });
  if (!payment || payment.organizationId !== ctx.organizationId) {
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
        organizationId: ctx.organizationId,
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
      organizationId: ctx.organizationId,
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
          organizationId: ctx.organizationId,
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
        if (order.holdId) {
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
      }
    });
    await writeAudit({
      organizationId: ctx.organizationId,
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
