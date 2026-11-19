import { randomBytes } from "node:crypto";
import { prisma } from "@/shared/lib/prisma";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import { assertEventOrganizer, hasApprovedEventStaffRole } from "@/modules/event-staff/service";
import { verifyPassword, rateLimit } from "@/shared/lib/security";
import { sha256 } from "@/shared/lib/security";
import type { AuthContext } from "@/shared/auth";

const activeRefundStatuses = ["SELLER_REVIEW", "ORGANIZER_REVIEW", "PLATFORM_REVIEW", "PROCESSING", "REFUND_AWAITING_PLATFORM_CONFIRMATION", "APPROVED"] as const;

export async function requestTicketCancellation(ctx: AuthContext, input: { ticketId: string; password: string; reason: string }) {
  if (await rateLimit(`ticket-cancel:${ctx.userId}`, 4, 60 * 60 * 1000)) throw new BusinessRuleError("Muitos pedidos de cancelamento. Tente novamente mais tarde.");
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) throw new ForbiddenError("invalid-password");
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    include: {
      session: { select: { id: true, eventId: true, startsAt: true } },
      order: { include: { payments: { where: { status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED"] } }, take: 1 }, lines: true } },
    },
  });
  if (!ticket || ticket.order.buyerUserId !== ctx.userId) throw new NotFoundError("Bilhete");
  if (ticket.status !== "ISSUED") throw new BusinessRuleError("Este bilhete não pode ser cancelado neste estado.");
  if (!["CONFIRMED", "PARTIALLY_REFUNDED"].includes(ticket.order.status)) throw new BusinessRuleError("A compra não permite pedir um reembolso.");
  if (Date.now() >= ticket.session.startsAt.getTime() - 3 * 60 * 60 * 1000) throw new BusinessRuleError("O prazo para pedir cancelamento terminou três horas antes do espetáculo.");
  const payment = ticket.order.payments[0];
  if (!payment) throw new BusinessRuleError("Não foi encontrado um pagamento confirmado para este bilhete.");
  const line = ticket.order.lines.find((item) => item.ticketTypeId === ticket.ticketTypeId);
  if (!line) throw new BusinessRuleError("Não foi possível calcular o valor associado a este bilhete.");
  const existing = await prisma.refund.findFirst({ where: { ticketId: ticket.id, status: { in: [...activeRefundStatuses] } }, select: { id: true } });
  if (existing) throw new ConflictError("Já existe um pedido de cancelamento para este bilhete.");

  const refund = await prisma.$transaction(async (tx) => {
    const created = await tx.refund.create({
      data: { organizationId: ticket.organizationId, orderId: ticket.orderId, paymentId: payment.id, ticketId: ticket.id, amountCents: line.unitPriceCents, reason: input.reason, status: "SELLER_REVIEW", requestedByUserId: ctx.userId },
      select: { id: true },
    });
    const changed = await tx.ticket.updateMany({ where: { id: ticket.id, status: "ISSUED" }, data: { status: "REVOKED" } });
    if (changed.count !== 1) throw new ConflictError("O estado do bilhete foi alterado. Atualize a página.");
    return created;
  });
  await writeAudit({ organizationId: ticket.organizationId, actorUserId: ctx.userId, action: "refund.requested", after: sanitizeForAudit({ refundId: refund.id, ticketId: ticket.id, orderId: ticket.orderId, amountCents: line.unitPriceCents, reason: input.reason, qrRevokedImmediately: true }) });
  return { refundId: refund.id, status: "SELLER_REVIEW", amountCents: line.unitPriceCents };
}

async function getTicketRefund(ctx: AuthContext, refundId: string) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { ticket: { include: { session: { select: { eventId: true } }, order: { select: { cashShift: { select: { operatorUserId: true } } } } } } },
  });
  if (!refund || !refund.ticket || !ctx.organizationId || refund.organizationId !== ctx.organizationId) throw new NotFoundError("Pedido de cancelamento");
  return refund;
}

async function rejectAndRestoreTicket(refundId: string, ticketId: string, expectedStatus: "SELLER_REVIEW" | "ORGANIZER_REVIEW" | "PLATFORM_REVIEW") {
  const newSecret = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    const rejected = await tx.refund.updateMany({ where: { id: refundId, status: expectedStatus }, data: { status: "REJECTED" } });
    if (rejected.count !== 1) throw new ConflictError("Este pedido já foi atualizado.");
    const restored = await tx.ticket.updateMany({ where: { id: ticketId, status: "REVOKED" }, data: { status: "ISSUED", qrSecretHash: sha256(newSecret), qrRotatedAt: new Date() } });
    if (restored.count !== 1) throw new ConflictError("O bilhete não pôde ser reativado. Contacte o suporte.");
  });
}

export async function reviewCancellationAsSeller(ctx: AuthContext, input: { refundId: string; decision: "APPROVE" | "REJECT"; notes: string }) {
  const refund = await getTicketRefund(ctx, input.refundId);
  if (!refund.ticket || !(await hasApprovedEventStaffRole(ctx, refund.ticket.session.eventId, "SELLER"))) throw new ForbiddenError("event-seller-only");
  if (refund.status !== "SELLER_REVIEW") throw new ConflictError("Este pedido já passou da análise do vendedor.");
  if (refund.ticket.order.cashShift?.operatorUserId === ctx.userId) throw new BusinessRuleError("O vendedor que registou a venda não pode analisar o próprio pedido.");
  const status = input.decision === "APPROVE" ? "ORGANIZER_REVIEW" : "REJECTED";
  if (input.decision === "REJECT") {
    await rejectAndRestoreTicket(refund.id, refund.ticket.id, "SELLER_REVIEW");
    await prisma.refund.update({ where: { id: refund.id }, data: { sellerReviewedByUserId: ctx.userId, sellerReviewedAt: new Date(), sellerNotes: input.notes } });
  } else {
    const changed = await prisma.refund.updateMany({ where: { id: refund.id, status: "SELLER_REVIEW" }, data: { status, sellerReviewedByUserId: ctx.userId, sellerReviewedAt: new Date(), sellerNotes: input.notes } });
    if (changed.count !== 1) throw new ConflictError("Este pedido já foi atualizado.");
  }
  await writeAudit({ organizationId: refund.organizationId, actorUserId: ctx.userId, action: input.decision === "APPROVE" ? "refund.approved" : "refund.rejected", after: sanitizeForAudit({ refundId: refund.id, stage: "seller", decision: input.decision, notes: input.notes }) });
  return { status };
}

export async function reviewCancellationAsOrganizer(ctx: AuthContext, input: { refundId: string; decision: "APPROVE" | "REJECT"; notes: string }) {
  const refund = await getTicketRefund(ctx, input.refundId);
  if (!refund.ticket) throw new NotFoundError("Bilhete");
  await assertEventOrganizer(ctx, refund.ticket.session.eventId);
  if (refund.status !== "ORGANIZER_REVIEW") throw new ConflictError("Este pedido não está à espera da decisão do organizador.");
  const approved = input.decision === "APPROVE";
  if (!approved) {
    await rejectAndRestoreTicket(refund.id, refund.ticket.id, "ORGANIZER_REVIEW");
    await prisma.refund.update({ where: { id: refund.id }, data: { organizerNotes: input.notes } });
  } else {
    const changed = await prisma.refund.updateMany({ where: { id: refund.id, status: "ORGANIZER_REVIEW" }, data: { status: "PLATFORM_REVIEW", organizerApprovedByUserId: ctx.userId, organizerApprovedAt: new Date(), organizerAssumesRefund: true, organizerNotes: input.notes } });
    if (changed.count !== 1) throw new ConflictError("Este pedido já foi atualizado.");
  }
  await writeAudit({ organizationId: refund.organizationId, actorUserId: ctx.userId, action: approved ? "refund.approved" : "refund.rejected", after: sanitizeForAudit({ refundId: refund.id, stage: "organizer", decision: input.decision, assumesRefund: approved, notes: input.notes }) });
  return { status: approved ? "PLATFORM_REVIEW" : "REJECTED" };
}

export async function reviewCancellationAsPlatform(ctx: AuthContext, input: { refundId: string; decision: "APPROVE" | "REJECT"; notes: string }) {
  if (ctx.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("platform-admin-only");
  const refund = await prisma.refund.findUnique({ where: { id: input.refundId }, select: { id: true, organizationId: true, status: true } });
  if (!refund || refund.status !== "PLATFORM_REVIEW") throw new ConflictError("Este pedido não está à espera da validação da plataforma.");
  const approved = input.decision === "APPROVE";
  const full = await prisma.refund.findUnique({ where: { id: refund.id }, select: { organizerAssumesRefund: true } });
  const platformOverride = approved && !full?.organizerAssumesRefund;
  if (!approved) {
    const fullRefund = await prisma.refund.findUnique({ where: { id: refund.id }, select: { ticketId: true } });
    if (!fullRefund?.ticketId) throw new NotFoundError("Bilhete");
    await rejectAndRestoreTicket(refund.id, fullRefund.ticketId, "PLATFORM_REVIEW");
    await prisma.refund.update({ where: { id: refund.id }, data: { platformApprovedByUserId: ctx.userId, platformApprovedAt: new Date(), platformNotes: input.notes } });
  } else {
    const changed = await prisma.refund.updateMany({ where: { id: refund.id, status: "PLATFORM_REVIEW" }, data: { status: "PROCESSING", platformApprovedByUserId: ctx.userId, platformApprovedAt: new Date(), platformNotes: input.notes, platformOverride } });
    if (changed.count !== 1) throw new ConflictError("Este pedido já foi atualizado.");
  }
  await writeAudit({ organizationId: refund.organizationId, actorUserId: ctx.userId, action: approved ? "refund.approved" : "refund.rejected", after: sanitizeForAudit({ refundId: refund.id, stage: "platform", decision: input.decision, platformOverride, notes: input.notes }) });
  return { status: approved ? "PROCESSING" : "REJECTED" };
}

export async function recordRefundExecution(ctx: AuthContext, input: { refundId: string; recipient: string; method: string; paidAt: Date; evidenceRef?: string; evidenceNotes: string }) {
  const refund = await getTicketRefund(ctx, input.refundId);
  if (!refund.ticket) throw new NotFoundError("Bilhete");
  await assertEventOrganizer(ctx, refund.ticket.session.eventId);
  if (refund.status !== "PROCESSING" || (!refund.organizerAssumesRefund && !refund.platformOverride)) throw new ConflictError("A plataforma ainda não autorizou este reembolso.");
  const changed = await prisma.refund.updateMany({ where: { id: refund.id, status: "PROCESSING" }, data: { status: "REFUND_AWAITING_PLATFORM_CONFIRMATION", refundExecutedByUserId: ctx.userId, refundRecipient: input.recipient, refundMethod: input.method, refundPaidAt: input.paidAt, refundEvidenceRef: input.evidenceRef, refundEvidenceNotes: input.evidenceNotes } });
  if (changed.count !== 1) throw new ConflictError("Este pedido já foi atualizado.");
  await writeAudit({ organizationId: refund.organizationId, actorUserId: ctx.userId, action: "refund.approved", after: sanitizeForAudit({ refundId: refund.id, stage: "refund_execution_recorded", recipient: input.recipient, method: input.method, paidAt: input.paidAt, evidenceRef: input.evidenceRef, evidenceNotes: input.evidenceNotes }) });
  return { status: "REFUND_AWAITING_PLATFORM_CONFIRMATION" };
}

/** Promove análises sem resposta ao nível seguinte após 24 horas. */
export async function escalateStaleTicketCancellations() {
  const deadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.refund.findMany({ where: { ticketId: { not: null }, status: { in: ["SELLER_REVIEW", "ORGANIZER_REVIEW"] }, updatedAt: { lte: deadline } }, select: { id: true, organizationId: true, status: true } });
  for (const refund of stale) {
    const nextStatus = refund.status === "SELLER_REVIEW" ? "ORGANIZER_REVIEW" : "PLATFORM_REVIEW";
    const field = refund.status === "SELLER_REVIEW" ? "sellerNotes" : "organizerNotes";
    const changed = await prisma.refund.updateMany({ where: { id: refund.id, status: refund.status, updatedAt: { lte: deadline } }, data: { status: nextStatus, [field]: `Escalado automaticamente após 24 horas sem resposta (${new Date().toISOString()}).` } });
    if (changed.count) await writeAudit({ organizationId: refund.organizationId, action: "refund.escalated", after: sanitizeForAudit({ refundId: refund.id, from: refund.status, to: nextStatus, reason: "24h_without_response" }) });
  }
  return { escalated: stale.length };
}

export async function confirmRefundByPlatform(ctx: AuthContext, refundId: string) {
  if (ctx.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("platform-admin-only");
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund || refund.status !== "REFUND_AWAITING_PLATFORM_CONFIRMATION") throw new ConflictError("O organizador ainda não registou a execução do reembolso.");
  await prisma.$transaction(async (tx) => {
    const changed = await tx.refund.updateMany({ where: { id: refund.id, status: "REFUND_AWAITING_PLATFORM_CONFIRMATION" }, data: { status: "COMPLETED", platformConfirmedByUserId: ctx.userId, platformConfirmedAt: new Date() } });
    if (changed.count !== 1) throw new ConflictError("Este reembolso já foi confirmado.");
    const completed = await tx.refund.aggregate({ where: { orderId: refund.orderId, status: "COMPLETED" }, _sum: { amountCents: true } });
    const order = await tx.order.findUnique({ where: { id: refund.orderId }, select: { totalCents: true } });
    const fully = (completed._sum.amountCents ?? 0) >= (order?.totalCents ?? Number.MAX_SAFE_INTEGER);
    await tx.order.update({ where: { id: refund.orderId }, data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await tx.payment.update({ where: { id: refund.paymentId }, data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await tx.financialLedgerEntry.create({ data: { organizationId: refund.organizationId, type: "REFUND", amountCents: -refund.amountCents, orderId: refund.orderId, refundId: refund.id, description: `Reembolso de bilhete confirmado pela plataforma. ${refund.refundMethod ?? ""} · ${refund.refundRecipient ?? ""}`, approvedByUserId: ctx.userId } });
  });
  await writeAudit({ organizationId: refund.organizationId, actorUserId: ctx.userId, action: "refund.completed", after: sanitizeForAudit({ refundId, amountCents: refund.amountCents, recipient: refund.refundRecipient, method: refund.refundMethod, paidAt: refund.refundPaidAt, evidenceRef: refund.refundEvidenceRef, evidenceNotes: refund.refundEvidenceNotes }) });
  return { status: "COMPLETED" };
}
