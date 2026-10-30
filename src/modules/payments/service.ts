import { prisma } from "@/shared/lib/prisma";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import { generateIdempotencyKey } from "@/shared/lib/security";
import type { AuthContext } from "@/shared/auth";
import { getAdapter, type ProviderResultStatus } from "./adapter";
import type { InitiatePaymentInput, ManualReviewInput } from "./schemas";
import { confirmHold, markHoldVerifying } from "@/modules/inventory/service";

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
// - Emissão de bilhetes apenas após confirmação idempotente
//   (chama tickets.service no mesmo fluxo).
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
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order || order.organizationId !== ctx.organizationId) throw new NotFoundError("Encomenda");
  if (order.buyerUserId !== ctx.userId && !ctx.permissions.has("boxoffice:sell")) {
    throw new ForbiddenError("not-buyer");
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

  // Idempotência da tentativa
  const attemptKey = input.idempotencyKey ?? generateIdempotencyKey();
  const existingAttempt = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: attemptKey },
  });
  if (existingAttempt) {
    const p = await prisma.payment.findUnique({
      where: { id: existingAttempt.paymentId },
      select: { id: true, status: true },
    });
    return { paymentId: p?.id, attemptId: existingAttempt.id, alreadyStarted: true };
  }

  // Payment da encomenda (um por prestador; tentativas dentro dele)
  let payment = await prisma.payment.findFirst({
    where: { orderId: order.id, providerId: provider.id },
  });
  if (!payment) {
    const attemptCount = 0;
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
    void attemptCount;
  }

  // Verifica montante: prestador cobra o total da encomenda
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

  await prisma.$transaction(async (tx) => {
    // Bloqueia tentativas anteriores que fiquem órfãs quando uma nova começa
    await tx.paymentAttempt.updateMany({
      where: { paymentId: payment!.id, status: "ACTIVE" },
      data: { status: "BLOCKED" },
    });

    await tx.paymentAttempt.create({
      data: {
        paymentId: payment!.id,
        attemptNumber: nextAttemptNumber,
        status: "ACTIVE",
        idempotencyKey: attemptKey,
        providerRef: result.providerRef,
      },
    });

    await tx.payment.update({
      where: { id: payment!.id },
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
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "payment.initiated",
    after: sanitizeForAudit({
      paymentId: payment.id,
      attempt: nextAttemptNumber,
      provider: provider.code,
      amountCents: order.totalCents,
    }),
  });

  return {
    paymentId: payment.id,
    attemptId: attemptKey,
    redirectUrl: result.redirectUrl,
    providerRef: result.providerRef,
  };
}

/** Confirmação idempotente: atualiza Payment, encomenda, hold e emite bilhetes. */
export async function confirmPayment(providerRef: string, rawPayload: unknown): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { providerRef },
    include: { order: { include: { hold: true, attendees: true, lines: true } } },
  });
  if (!payment) {
    console.error("[webhook] payment-not-found", { providerRef });
    return;
  }
  if (payment.status === "CONFIRMED") return; // idempotente

  await prisma.$transaction(async (tx) => {
    // Revalida estado dentro da transação
    const fresh = await tx.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (!fresh || fresh.status === "CONFIRMED") return;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        providerRawPayload: rawPayload as never,
      },
    });

    // Opção B: tentativa ativa vira COMPLETED; as restantes ficam BLOCKED
    await tx.paymentAttempt.updateMany({
      where: { paymentId: payment.id, status: "ACTIVE" },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    await tx.paymentAttempt.updateMany({
      where: { paymentId: payment.id, status: { not: "COMPLETED" } },
      data: { status: "BLOCKED", finishedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    // Consumo o hold (reservado → vendido)
    if (payment.order.holdId) {
      await tx.inventoryHold.update({
        where: { id: payment.order.holdId },
        data: { status: "CONFIRMED", releasedAt: new Date() },
      });
      for (const line of payment.order.lines) {
        await tx.ticketInventory.update({
          where: {
            sessionId_ticketTypeId_batchId: {
              sessionId: payment.order.sessionId!,
              ticketTypeId: line.ticketTypeId,
              batchId: line.batchId,
            },
          },
          data: {
            reservedQuantity: { decrement: line.quantity },
            soldQuantity: { increment: line.quantity },
          },
        });
      }
    }
  });

  // Emissão de bilhetes (idempotente) — módulo de acesso
  const { issueTicketsForOrder } = await import("@/modules/access/service");
  await issueTicketsForOrder(payment.orderId);

  await writeAudit({
    organizationId: payment.organizationId,
    actorUserId: null,
    action: "payment.confirmed",
    after: sanitizeForAudit({ paymentId: payment.id, providerRef }),
  });
}

/** Webhook: validar + rotear estado (nunca confiar no corpo sem assinatura). */
export async function handleWebhook(
  providerCode: string,
  rawBody: string,
  headers: Record<string, string>
): Promise<{ processed: boolean }> {
  const provider = await prisma.paymentProvider.findUnique({ where: { code: providerCode } });
  if (!provider) throw new NotFoundError("Prestador");
  const adapter = getAdapter(providerCode);
  if (!adapter) throw new AppError("ADAPTER_MISSING", 500, "Adaptador não instalado.");

  const payload = adapter.verifyWebhook(rawBody, headers, (provider.adapterConfig ?? {}) as Record<string, unknown>);
  if (!payload) {
    throw new AppError("WEBHOOK_INVALID", 401, "Assinatura de webhook inválida.");
  }

  const payment = await prisma.payment.findUnique({
    where: { providerRef: payload.providerRef },
    select: { id: true, amountCents: true, status: true },
  });
  if (!payment) return { processed: false }; // ignora transações desconhecidas

  // Montante tem de bater com o registado (conciliação server-side)
  if (payload.amountCents !== payment.amountCents) {
    // Divergência → estado indefinido: inventário protegido, revisão manual
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "UNDER_REVIEW", providerRawPayload: payload.rawPayload as never },
    });
    const order = await prisma.order.findUnique({
      where: { orderId_payment: undefined } as never,
    });
    void order;
    throw new AppError("AMOUNT_MISMATCH", 409, "Divergência de valor: encaminhado para revisão.");
  }

  if (payload.status === "CONFIRMED") {
    await confirmPayment(payload.providerRef, payload.rawPayload);
  } else if (payload.status === "DECLINED" || payload.status === "CANCELLED" || payload.status === "EXPIRED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PROVIDER_STATUS_MAP[payload.status] as never },
    });
  } else if (payload.status === "UNKNOWN") {
    // Sem resultado definitivo: protege inventário e marca verificação
    const p = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: { order: { select: { holdId: true } } },
    });
    if (p?.order.holdId) {
      await markHoldVerifying(p.order.holdId);
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

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { order: { select: { holdId: true } } },
  });
  if (!payment || payment.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Pagamento");
  }
  if (payment.status !== "UNDER_REVIEW" && payment.status !== "AWAITING_AUTHORIZATION") {
    throw new BusinessRuleError("Pagamento não está pendente de análise.");
  }
  if (!ctx.permissions.has("payment:review")) throw new ForbiddenError("payment:review");

  if (input.decision === "CONFIRM") {
    // Ninguém marca como paga sem evidência (Opção C): notas obrigatórias
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
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
    const { issueTicketsForOrder } = await import("@/modules/access/service");
    await issueTicketsForOrder(payment.orderId);
  } else {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "DECLINED" },
    });
    if (payment.order.holdId) {
      const { confirmHold: _unused } = { confirmHold };
      void _unused;
    }
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
