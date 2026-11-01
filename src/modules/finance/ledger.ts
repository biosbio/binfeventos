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
  if (periodStart >= periodEnd) throw new BusinessRuleError("Período de liquidação inválido.");

  // Serializa a preparação para a mesma organização/período e impede
  // liquidações duplicadas quando dois operadores atuam em simultâneo.
  const result = await prisma.$transaction(async (tx) => {
    const lockKey = `settlement:${ctx.organizationId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const existingSettlement = await tx.settlement.findFirst({
      where: {
        organizationId: ctx.organizationId!,
        periodStart: { lt: periodEnd },
        periodEnd: { gt: periodStart },
        status: { not: "CANCELLED" },
      },
      select: { id: true },
    });
    if (existingSettlement) throw new ConflictError("Já existe uma liquidação para este período.");

    const [orders, refunds, chargebacks, commission, payments, activeReserves] = await Promise.all([
      tx.order.aggregate({
        where: {
          organizationId: ctx.organizationId!,
          confirmedAt: { gte: periodStart, lte: periodEnd },
          status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        },
        _sum: { totalCents: true },
      }),
      tx.refund.aggregate({
        where: {
          organizationId: ctx.organizationId!,
          createdAt: { gte: periodStart, lte: periodEnd },
          status: { in: ["APPROVED", "COMPLETED", "PROCESSING"] },
        },
        _sum: { amountCents: true },
      }),
      tx.chargeback.aggregate({
        where: {
          organizationId: ctx.organizationId!,
          createdAt: { gte: periodStart, lte: periodEnd },
          status: { in: ["NOTIFIED", "EVIDENCE_GATHERING", "SUBMITTED", "LOST"] },
        },
        _sum: { amountCents: true },
      }),
      tx.order.aggregate({
        where: {
          organizationId: ctx.organizationId!,
          confirmedAt: { gte: periodStart, lte: periodEnd },
          status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        },
        _sum: { commissionCents: true },
      }),
      tx.payment.aggregate({
        where: {
          organizationId: ctx.organizationId!,
          confirmedAt: { gte: periodStart, lte: periodEnd },
        },
        _sum: { amountCents: true },
      }),
      tx.financialReserve.aggregate({
        where: { organizationId: ctx.organizationId!, status: { in: ["ACTIVE", "PARTIALLY_RELEASED"] } },
        _sum: { amountCents: true },
      }),
    ]);

    const grossCents = orders._sum.totalCents ?? 0;
    const refundedCents = refunds._sum.amountCents ?? 0;
    const chargebackCents = chargebacks._sum.amountCents ?? 0;
    const commissionCents = commission._sum.commissionCents ?? 0;
    // Taxa provisória de 1,5% até o prestador fornecer a taxa efetiva.
    const providerFeeCents = Math.round((grossCents * 150) / 10_000);
    const netCents = grossCents - commissionCents - providerFeeCents - refundedCents - chargebackCents;
    const reservedCents = activeReserves._sum.amountCents ?? 0;
    const payableCents = Math.max(0, netCents - reservedCents);

    const settlement = await tx.settlement.create({
      data: {
        organizationId: ctx.organizationId!,
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
    return { settlement, payableCents, paymentVolumeCents: payments._sum.amountCents ?? 0 };
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "settlement.prepared",
    after: sanitizeForAudit({
      settlementId: result.settlement.id,
      payableCents: result.payableCents,
      paymentVolumeCents: result.paymentVolumeCents,
    }),
  });
  return result.settlement;
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
  if (
    settlement.preparedByUserId === ctx.userId ||
    settlement.approvedByUserId === ctx.userId
  ) {
    throw new BusinessRuleError("Segregação de funções: quem prepara ou aprova não pode marcar o pagamento como executado.");
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
 * Exige ledger:adjust, compensação integral e operador diferente do aprovador original.
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
  if (original.approvedByUserId === ctx.userId) {
    throw new BusinessRuleError("Segregação de funções: não pode compensar um lançamento que aprovou.");
  }
  if (input.amountCents !== -original.amountCents) {
    throw new BusinessRuleError("A compensação deve anular exatamente o valor do lançamento original.");
  }

  let entry: { id: string };
  try {
    entry = await prisma.financialLedgerEntry.create({
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
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new ConflictError("Este lançamento já tem uma compensação registada.");
    }
    throw error;
  }

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
