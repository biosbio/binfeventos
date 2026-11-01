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

  // Serializa pedidos de reembolso por encomenda para impedir que
  // pedidos concorrentes ultrapassem o montante efetivamente pago.
  const refund = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id}::uuid FOR UPDATE`;

    const freshOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { organizationId: true, status: true },
    });
    const freshPayment = await tx.payment.findUnique({
      where: { id: payment.id },
      select: { amountCents: true, status: true },
    });
    if (
      !freshOrder ||
      freshOrder.organizationId !== ctx.organizationId ||
      !["CONFIRMED", "PARTIALLY_REFUNDED"].includes(freshOrder.status) ||
      !freshPayment ||
      freshPayment.status !== "CONFIRMED"
    ) {
      throw new BusinessRuleError("A encomenda ou o pagamento já não é elegível para reembolso.");
    }

    const previousRefunds = await tx.refund.aggregate({
      where: {
        orderId: order.id,
        status: { in: ["REQUESTED", "UNDER_ANALYSIS", "APPROVED", "PROCESSING", "COMPLETED"] },
      },
      _sum: { amountCents: true },
    });
    const alreadyRefunded = previousRefunds._sum.amountCents ?? 0;
    const refundable = freshPayment.amountCents - alreadyRefunded;

    if (input.amountCents > refundable || refundable <= 0) {
      throw new BusinessRuleError(
        `Valor máximo reembolsável: ${Math.max(0, refundable)} cêntimos (já comprometido: ${alreadyRefunded}).`
      );
    }

    const created = await tx.refund.create({
      data: {
        organizationId: ctx.organizationId!,
        orderId: order.id,
        paymentId: payment.id,
        amountCents: input.amountCents,
        reason: input.reason,
        status: "REQUESTED",
        requestedByUserId: ctx.userId,
      },
      select: { id: true },
    });
    return { ...created, isTotal: input.amountCents === refundable };
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "refund.requested",
    after: sanitizeForAudit({
      refundId: refund.id,
      orderId: order.id,
      amountCents: input.amountCents,
      isTotal: refund.isTotal,
    }),
  });

  return { refundId: refund.id, isTotal: refund.isTotal };
}

/** Aprovar/rejeitar reembolso. Aprovação não significa que o dinheiro já foi devolvido. */
export async function decideRefund(ctx: AuthContext, input: ApproveRefundInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("refund:approve")) throw new ForbiddenError("refund:approve");

  const refund = await prisma.refund.findUnique({ where: { id: input.refundId } });
  if (!refund || refund.organizationId !== ctx.organizationId) throw new NotFoundError("Reembolso");
  if (refund.requestedByUserId === ctx.userId) {
    throw new BusinessRuleError("Segregação de funções: quem solicita não pode aprovar.");
  }
  if (refund.status !== "REQUESTED" && refund.status !== "UNDER_ANALYSIS") {
    throw new ConflictError(`Reembolso em estado ${refund.status}.`);
  }

  const nextStatus = input.decision === "REJECT" ? "REJECTED" : "APPROVED";
  const changed = await prisma.refund.updateMany({
    where: {
      id: refund.id,
      organizationId: ctx.organizationId,
      status: { in: ["REQUESTED", "UNDER_ANALYSIS"] },
    },
    data: { status: nextStatus, approvedByUserId: ctx.userId },
  });
  if (changed.count !== 1) throw new ConflictError("Reembolso já foi processado.");

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: input.decision === "REJECT" ? "refund.rejected" : "refund.approved",
    after: sanitizeForAudit({ refundId: refund.id, notes: input.notes ?? null }),
  });

  return { approved: input.decision === "APPROVE", refundId: refund.id };
}

/** Regista a devolução efetiva após execução no prestador/banco. */
export async function completeRefund(
  ctx: AuthContext,
  input: { refundId: string; providerRef: string; evidenceNotes: string },
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("refund:approve")) throw new ForbiddenError("refund:approve");

  const refund = await prisma.refund.findUnique({ where: { id: input.refundId } });
  if (!refund || refund.organizationId !== ctx.organizationId) throw new NotFoundError("Reembolso");
  if (refund.status !== "APPROVED" && refund.status !== "PROCESSING") {
    throw new ConflictError("Apenas reembolsos aprovados podem ser concluídos.");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${refund.orderId}::uuid FOR UPDATE`;
    const claimed = await tx.refund.updateMany({
      where: {
        id: refund.id,
        organizationId: ctx.organizationId,
        status: { in: ["APPROVED", "PROCESSING"] },
      },
      data: { status: "COMPLETED", providerRef: input.providerRef },
    });
    if (claimed.count !== 1) throw new ConflictError("Reembolso já foi concluído.");

    const order = await tx.order.findUnique({
      where: { id: refund.orderId },
      select: { totalCents: true, status: true },
    });
    if (!order || !["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.status)) {
      throw new BusinessRuleError("A encomenda já não permite concluir este reembolso.");
    }

    const completed = await tx.refund.aggregate({
      where: { orderId: refund.orderId, status: "COMPLETED" },
      _sum: { amountCents: true },
    });
    const fully = (completed._sum.amountCents ?? 0) >= order.totalCents;
    const updatedOrder = await tx.order.updateMany({
      where: {
        id: refund.orderId,
        organizationId: ctx.organizationId,
        status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    if (updatedOrder.count !== 1) throw new ConflictError("Estado da encomenda foi alterado.");

    await tx.financialLedgerEntry.create({
      data: {
        organizationId: refund.organizationId,
        type: "REFUND",
        amountCents: -refund.amountCents,
        orderId: refund.orderId,
        refundId: refund.id,
        description: "Devolução financeira concluída e comprovada.",
        approvedByUserId: ctx.userId,
      },
    });

    if (fully) {
      await tx.ticket.updateMany({
        where: { orderId: refund.orderId, status: { in: ["ISSUED", "USED", "TRANSFERRED"] } },
        data: { status: "CANCELLED" },
      });
    }
    return { refundId: refund.id, fully };
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "refund.completed",
    after: sanitizeForAudit({
      refundId: result.refundId,
      amountCents: refund.amountCents,
      providerRef: input.providerRef,
      evidence: input.evidenceNotes,
      fully: result.fully,
    }),
  });
  return { completed: true, fullyRefunded: result.fully };
}

