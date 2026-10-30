import { prisma } from "@/shared/lib/prisma";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import type {
  ApproveRefundInput,
  RequestRefundInput,
} from "./schemas";

// ============================================================
// Módulo finance — reembolsos (Domínio 5).
//
// Regras (documento mestre, secção 11 + SEC-17):
// 1. Segregação de funções: quem solicita ≠ quem aprova.
//    requestRefund exige refund:request; approveRefund exige
//    refund:approve E utilizador diferente do solicitante.
// 2. Reembolsos totais e parciais, sempre associados à venda
//    original, sem duplicações, com motivo e responsáveis.
// 3. Tudo registado no livro-razão (REFUND) — imutável.
// 4. Bilhetes da encomenda são cancelados em reembolso total.
// ============================================================

/** Solicitar reembolso (parcial ou total). */
export async function requestRefund(ctx: AuthContext, input: RequestRefundInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("refund:request")) throw new ForbiddenError("refund:request");

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: { where: { status: "CONFIRMED" } }, tickets: true },
  });
  if (!order || order.organizationId !== ctx.organizationId) throw new NotFoundError("Encomenda");
  if (order.status !== "CONFIRMED" && order.status !== "PARTIALLY_REFUNDED") {
    throw new BusinessRuleError("Apenas encomendas confirmadas podem ser reembolsadas.");
  }
  const payment = order.payments[0];
  if (!payment) throw new BusinessRuleError("Sem pagamento confirmado para reembolsar.");

  // Não reembolsa mais do que foi pago menos reembolsos anteriores
  const previousRefunds = await prisma.refund.aggregate({
    where: { orderId: order.id, status: { in: ["REQUESTED", "UNDER_ANALYSIS", "APPROVED", "PROCESSING", "COMPLETED"] } },
    _sum: { amountCents: true },
  });
  const alreadyRefunded = previousRefunds._sum.amountCents ?? 0;
  const refundable = payment.amountCents - alreadyRefunded;

  if (input.amountCents > refundable) {
    throw new BusinessRuleError(
      `Valor máximo reembolsável: ${refundable} cêntimos (já reembolsado: ${alreadyRefunded}).`
    );
  }

  const isTotal = input.amountCents === refundable;

  const refund = await prisma.refund.create({
    data: {
      organizationId: ctx.organizationId,
      orderId: order.id,
      paymentId: payment.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: "REQUESTED",
      requestedByUserId: ctx.userId,
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "refund.requested",
    after: sanitizeForAudit({
      refundId: refund.id,
      orderId: order.id,
      amountCents: input.amountCents,
      isTotal,
    }),
  });

  return { refundId: refund.id, isTotal };
}

/** Aprovar/rejeitar reembolso (segregação: aprovador ≠ solicitante). */
export async function decideRefund(ctx: AuthContext, input: ApproveRefundInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("refund:approve")) throw new ForbiddenError("refund:approve");

  const refund = await prisma.refund.findUnique({ where: { id: input.refundId } });
  if (!refund || refund.organizationId !== ctx.organizationId) throw new NotFoundError("Reembolso");

  // SEGREGAÇÃO: quem pediu não aprova (documento mestre, secção 11)
  if (refund.requestedByUserId === ctx.userId) {
    throw new BusinessRuleError("Segregação de funções: quem solicita não pode aprovar.");
  }
  if (refund.status !== "REQUESTED" && refund.status !== "UNDER_ANALYSIS") {
    throw new ConflictError(`Reembolso em estado ${refund.status}.`);
  }

  if (input.decision === "REJECT") {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "REJECTED", approvedByUserId: ctx.userId },
    });
    await writeAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "refund.rejected",
      after: sanitizeForAudit({ refundId: refund.id }),
    });
    return { approved: false };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "PROCESSING", approvedByUserId: ctx.userId },
    });

    // Lançamento no livro-razão (imutável)
    await tx.financialLedgerEntry.create({
      data: {
        organizationId: refund.organizationId,
        type: "REFUND",
        amountCents: -refund.amountCents, // crédito
        orderId: refund.orderId,
        refundId: refund.id,
        description: `Reembolso aprovado por operador autorizado`,
        approvedByUserId: ctx.userId,
      },
    });

    // Reembolso TOTAL: cancela bilhetes e ajusta encomenda
    const order = await tx.order.findUnique({
      where: { id: refund.orderId },
      select: { totalCents: true },
    });
    const totalRefunded = await tx.refund.aggregate({
      where: { orderId: refund.orderId, status: { in: ["COMPLETED", "PROCESSING"] } },
      _sum: { amountCents: true },
    });
    void order;
    const fully = (totalRefunded._sum.amountCents ?? 0) >= order!.totalCents;

    await tx.order.update({
      where: { id: refund.orderId },
      data: fully ? { status: "REFUNDED" } : { status: "PARTIALLY_REFUNDED" },
    });

    if (fully) {
      await tx.ticket.updateMany({
        where: { orderId: refund.orderId, status: { in: ["ISSUED", "USED", "TRANSFERRED"] } },
        data: { status: "CANCELLED" },
      });
      // Inventário não é reposto automaticamente: decisão comercial
      // (repor = novo lote/quantidade). Registado para revisão.
    }

    return tx.refund.update({
      where: { id: refund.id },
      data: { status: "COMPLETED" },
      select: { id: true },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "refund.completed",
    after: sanitizeForAudit({ refundId: result.id, amountCents: refund.amountCents }),
  });

  return { approved: true };
}
