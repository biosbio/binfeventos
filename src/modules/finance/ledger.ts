import { prisma } from "@/shared/lib/prisma";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import type { AdjustLedgerInput } from "./schemas";

// ============================================================
// Módulo finance — liquidações, reservas e livro-razão (Domínio 5).
//
// Regras (documento mestre, secções 9 e 11 + SEC-17):
// 1. Livro-razão IMUTÁVEL: lançamentos confirmados nunca são
//    apagados/sobrescritos; correções = lançamentos compensatórios
//    (compensatesEntryId) com dupla aprovação.
// 2. Liquidação: bruto − comissão − taxas prestador − reembolsos −
//    contestações = líquido; líquido − reservas = a liquidar.
// 3. Dupla aprovação em liquidações (preparer ≠ approver).
// 4. Reservas financeiras baseadas no risco, com condições de
//    libertação explícitas.
// ============================================================

/** Preparar liquidação do período (cálculo server-side agregado). */
export async function prepareSettlement(
  ctx: AuthContext,
  input: { periodStart: Date; periodEnd: Date }
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("settlement:prepare")) throw new ForbiddenError("settlement:prepare");

  const { periodStart, periodEnd } = input;

  // Agregações do período (fonte: base de dados, nunca cliente)
  const [orders, refunds, chargebacks, commission, providerFees] = await Promise.all([
    prisma.order.aggregate({
      where: {
        organizationId: ctx.organizationId,
        confirmedAt: { gte: periodStart, lte: periodEnd },
        status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      _sum: { totalCents: true },
    }),
    prisma.refund.aggregate({
      where: {
        organizationId: ctx.organizationId,
        createdAt: { gte: periodStart, lte: periodEnd },
        status: { in: ["COMPLETED", "PROCESSING"] },
      },
      _sum: { amountCents: true },
    }),
    prisma.chargeback.aggregate({
      where: {
        organizationId: ctx.organizationId,
        createdAt: { gte: periodStart, lte: periodEnd },
        status: { in: ["NOTIFIED", "EVIDENCE_GATHERING", "SUBMITTED", "LOST"] },
      },
      _sum: { amountCents: true },
    }),
    prisma.order.aggregate({
      where: {
        organizationId: ctx.organizationId,
        confirmedAt: { gte: periodStart, lte: periodEnd },
        status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      _sum: { commissionCents: true },
    }),
    // Taxas do prestador: no MVP derivadas de 1,5% do bruto (config futura)
    prisma.payment.aggregate({
      where: {
        organizationId: ctx.organizationId,
        confirmedAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { amountCents: true },
    }),
  ]);

  const grossCents = orders._sum.totalCents ?? 0;
  const refundedCents = refunds._sum.amountCents ?? 0;
  const chargebackCents = chargebacks._sum.amountCents ?? 0;
  const commissionCents = commission._sum.commissionCents ?? 0;
  const providerFeeCents = Math.round((grossCents * 150) / 10_000); // 1,5%

  const netCents =
    grossCents - commissionCents - providerFeeCents - refundedCents - chargebackCents;

  // Reservas ativas reduzem o a liquidar
  const activeReserves = await prisma.financialReserve.aggregate({
    where: { organizationId: ctx.organizationId, status: { in: ["ACTIVE", "PARTIALLY_RELEASED"] } },
    _sum: { amountCents: true },
  });
  const reservedCents = activeReserves._sum.amountCents ?? 0;
  const payableCents = Math.max(0, netCents - reservedCents);

  const settlement = await prisma.settlement.create({
    data: {
      organizationId: ctx.organizationId,
      periodStart,
      periodEnd,
      grossCents,
      commissionCents,
      providerFeeCents,
      refundedCents,
      chargebackCents,
      netCents,
      reservedCents,
      payableCents,
      status: "PENDING",
      preparedByUserId: ctx.userId,
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "settlement.prepared",
    after: sanitizeForAudit({ settlementId: settlement.id, payableCents }),
  });

  return settlement;
}

/** Aprovar/rejeitar liquidação (dupla aprovação: preparer ≠ approver). */
export async function decideSettlement(
  ctx: AuthContext,
  input: { settlementId: string; decision: "APPROVE" | "REJECT" }
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("settlement:approve")) throw new ForbiddenError("settlement:approve");

  const settlement = await prisma.settlement.findUnique({ where: { id: input.settlementId } });
  if (!settlement || settlement.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Liquidação");
  }
  // DUPLA APROVAÇÃO
  if (settlement.preparedByUserId === ctx.userId) {
    throw new BusinessRuleError("Dupla aprovação: quem prepara não pode aprovar.");
  }
  if (settlement.status !== "PENDING") {
    throw new ConflictError(`Liquidação em estado ${settlement.status}.`);
  }

  if (input.decision === "REJECT") {
    const changed = await prisma.settlement.updateMany({
      where: { id: settlement.id, organizationId: ctx.organizationId, status: "PENDING" },
      data: { status: "CANCELLED", approvedByUserId: ctx.userId },
    });
    if (changed.count !== 1) throw new ConflictError("Liquidação já foi processada.");
    return { approved: false };
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.settlement.updateMany({
      where: { id: settlement.id, organizationId: ctx.organizationId, status: "PENDING" },
      data: { status: "APPROVED", approvedByUserId: ctx.userId },
    });
    if (changed.count !== 1) throw new ConflictError("Liquidação já foi processada.");

    // Lançamento no livro-razão (imutável)
    await tx.financialLedgerEntry.create({
      data: {
        organizationId: settlement.organizationId,
        type: "SETTLEMENT",
        amountCents: -settlement.payableCents, // saída para o organizador
        settlementId: settlement.id,
        description: "Liquidação aprovada (dupla aprovação)",
        approvedByUserId: ctx.userId,
      },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "settlement.approved",
    after: sanitizeForAudit({ settlementId: settlement.id, payableCents: settlement.payableCents }),
  });

  return { approved: true };
}

/** Marcar liquidação como paga (após transferência bancária). */
export async function markSettlementPaid(ctx: AuthContext, settlementId: string) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("settlement:approve")) throw new ForbiddenError("settlement:approve");
  const settlement = await prisma.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement || settlement.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Liquidação");
  }
  const changed = await prisma.settlement.updateMany({
    where: { id: settlement.id, organizationId: ctx.organizationId, status: "APPROVED" },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (changed.count !== 1) {
    throw new ConflictError("Apenas liquidações aprovadas e ainda não pagas podem ser marcadas como pagas.");
  }
  await writeAudit({
    organizationId: settlement.organizationId,
    actorUserId: ctx.userId,
    action: "settlement.paid",
    after: sanitizeForAudit({ settlementId, payableCents: settlement.payableCents }),
  });
}

/** Constituir reserva financeira baseada no risco. */
export async function createReserve(
  ctx: AuthContext,
  input: { amountCents: number; reason: string; releaseConditions?: string; settlementId?: string }
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("reserve:manage")) throw new ForbiddenError("reserve:manage");

  if (input.settlementId) {
    const linkedSettlement = await prisma.settlement.findFirst({
      where: { id: input.settlementId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!linkedSettlement) throw new NotFoundError("Liquidação");
  }

  const reserve = await prisma.$transaction(async (tx) => {
    const created = await tx.financialReserve.create({
      data: {
        organizationId: ctx.organizationId!,
        amountCents: input.amountCents,
        reason: input.reason,
        releaseConditions: input.releaseConditions ?? null,
        settlementId: input.settlementId ?? null,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    await tx.financialLedgerEntry.create({
      data: {
        organizationId: ctx.organizationId!,
        type: "RESERVE",
        amountCents: input.amountCents,
        settlementId: input.settlementId ?? null,
        description: input.reason,
        approvedByUserId: ctx.userId,
      },
    });
    return created;
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "reserve.constituted",
    after: sanitizeForAudit({ reserveId: reserve.id, amountCents: input.amountCents }),
  });

  return reserve;
}

/** Libertar reserva (com lançamento compensatório no razão). */
export async function releaseReserve(ctx: AuthContext, reserveId: string, notes: string) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("reserve:manage")) throw new ForbiddenError("reserve:manage");

  const reserve = await prisma.financialReserve.findUnique({ where: { id: reserveId } });
  if (!reserve || reserve.organizationId !== ctx.organizationId) throw new NotFoundError("Reserva");
  if (reserve.status === "RELEASED") throw new ConflictError("Reserva já libertada.");

  await prisma.$transaction(async (tx) => {
    const changed = await tx.financialReserve.updateMany({
      where: {
        id: reserve.id,
        organizationId: ctx.organizationId,
        status: { in: ["ACTIVE", "PARTIALLY_RELEASED"] },
      },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (changed.count !== 1) throw new ConflictError("Reserva já foi libertada.");

    await tx.financialLedgerEntry.create({
      data: {
        organizationId: reserve.organizationId,
        type: "RESERVE_RELEASE",
        amountCents: -reserve.amountCents,
        settlementId: reserve.settlementId,
        description: notes,
        approvedByUserId: ctx.userId,
      },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "reserve.released",
    after: sanitizeForAudit({ reserveId: reserve.id, notes }),
  });
}

/**
 * Lançamento compensatório (correção) — livro-razão imutável:
 * nunca apaga; cria entrada que compensa a original.
 * Exige ledger:adjust (dupla aprovação em produção via fluxo de aprovação).
 */
export async function adjustLedger(ctx: AuthContext, input: AdjustLedgerInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("ledger:adjust")) throw new ForbiddenError("ledger:adjust");

  const original = await prisma.financialLedgerEntry.findUnique({
    where: { id: input.compensatesEntryId },
  });
  if (!original || original.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Lançamento original");
  }
  if (original.compensatesEntryId) {
    throw new BusinessRuleError("Não se compensa um lançamento compensatório.");
  }

  const entry = await prisma.financialLedgerEntry.create({
    data: {
      organizationId: ctx.organizationId,
      type: "ADJUSTMENT",
      amountCents: input.amountCents,
      orderId: original.orderId,
      paymentId: original.paymentId,
      settlementId: original.settlementId,
      refundId: original.refundId,
      description: input.description,
      compensatesEntryId: original.id,
      approvedByUserId: ctx.userId,
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ledger.adjustment",
    after: sanitizeForAudit({
      adjustmentId: entry.id,
      compensates: original.id,
      amountCents: input.amountCents,
    }),
  });

  return entry;
}

/** Consultar livro-razão (somente leitura; imutável por definição). */
export async function readLedger(ctx: AuthContext, limit = 200) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("ledger:read")) throw new ForbiddenError("ledger:read");
  return prisma.financialLedgerEntry.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
    select: {
      id: true, type: true, amountCents: true, currency: true,
      description: true, compensatesEntryId: true,
      approvedByUserId: true, createdAt: true,
    },
  });
}
