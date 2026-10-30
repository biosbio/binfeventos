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
import { markHoldVerifying } from "@/modules/inventory/service";
import { notifyPaymentConfirmed } from "./notify";

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
// - Parte 21b (Domínio 10): confirmação notifica o comprador
//   (PAYMENT_CONFIRMED + TICKETS_ISSUED) via ./notify (best-effort).
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
    organizationId: ctx.organizationId,
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
export async function confirmPayment(providerRef: string, rawPayload: unknown): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { providerRef },
    include: { order: { include: { lines: true } } },
  });
  if (!payment) {
    console.error("[webhook] payment-not-found", { providerRef });
    return;
  }
  if (payment.status === "CONFIRMED") return; // idempotente

  await prisma.$transaction(async (tx) => {
    // Revalida estado dentro da transação (webhook pode repetir)
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
      where: { paymentId: payment.id, status: "BLOCKED" },
      data: { finishedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    // Consome o hold: reservado → vendido (transacional)
    const hold = await tx.inventoryHold.findUnique({
      where: { id: payment.order.holdId ?? "" },
      select: { id: true, status: true, sessionId: true, ticketTypeId: true, batchId: true, quantity: true },
    });
    if (hold) {
      if (hold.status === "CONFIRMED") return; // já consumido
      await tx.inventoryHold.update({
        where: { id: hold.id },
        data: { status: "CONFIRMED", releasedAt: new Date() },
      });
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
        if (inv) {
          await tx.ticketInventory.update({
            where: { id: inv.id },
            data: {
              reservedQuantity: { decrement: line.quantity },
              soldQuantity: { increment: line.quantity },
            },
          });
        }
      }
    }
  });

  // Emissão de bilhetes (idempotente) — módulo de acesso
  const { issueTicketsForOrder } = await import("@/modules/access/service");
  await issueTicketsForOrder(payment.orderId);

  // Parte 21b: notificar comprador (best-effort, após emissão)
  await notifyPaymentConfirmed(payment.orderId, payment.id);

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
  if (!provider) throw new NotFoundError("Prestador");
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

  const payment = await prisma.payment.findUnique({
    where: { providerRef: payload.providerRef },
    select: { id: true, amountCents: true, orderId: true },
  });
  if (!payment) return { processed: false }; // ignora transações desconhecidas

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
    await confirmPayment(payload.providerRef, payload.rawPayload);
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
    // Opção C: ninguém marca como paga sem evidência (notas obrigatórias)
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

    // Parte 21b: notificar comprador (best-effort)
    await notifyPaymentConfirmed(payment.orderId, payment.id);
  } else {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "DECLINED" },
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
