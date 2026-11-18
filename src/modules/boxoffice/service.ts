import { prisma } from "@/shared/lib/prisma";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit, assertOrgActive } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import { assertEventOrganizer, hasApprovedEventStaffRole } from "@/modules/event-staff/service";
import type { BoxOfficeSaleInput, CloseShiftInput, OpenShiftInput } from "./schemas";
import type { CreateOrderInput } from "@/modules/sales/schemas";

// ============================================================
// Módulo boxoffice — bilheteira física (Domínio 6).
//
// Regras (documento mestre, secção 7):
// 1. Venda presencial usa o MESMO motor de encomendas — o
//    inventário central é atualizado imediatamente (Order.channel
//    = BOX_OFFICE, Order.shiftId liga a venda ao turno).
// 2. Pagamento a dinheiro segue o MESMO fluxo de confirmação
//    do módulo payments (INITIATED → confirmPayment) para que a
//    encomenda seja confirmada, o hold consumido e os bilhetes
//    emitidos de forma idempotente.
// 3. Turno regista operador, fundo inicial, vendas, movimentos
//    autorizados, esperado, contado, diferença e responsável.
// 4. Fecho com diferença é PERMITIDO: divergência registada
//    (differenceCents + notes), lançamento CASH_DIFFERENCE no
//    livro-razão e depósito em COUNTED — nunca ignorada.
// ============================================================

/** Escopo: posto da organização do contexto. */
async function scopedStation(ctx: AuthContext, stationCode: string) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  await assertOrgActive(ctx.organizationId);
  const station = await prisma.boxOfficeStation.findUnique({
    where: { organizationId_code: { organizationId: ctx.organizationId, code: stationCode } },
  });
  if (!station) throw new NotFoundError("Posto");
  if (station.status !== "ACTIVE") throw new BusinessRuleError("Posto suspenso ou encerrado.");
  return station;
}

/** Abrir turno: um turno aberto por operador por posto. */
export async function openShift(ctx: AuthContext, input: OpenShiftInput) {
  const station = await scopedStation(ctx, input.stationCode);
  const isEventStaff = !ctx.permissions.has("shift:open");
  let eventId: string | null = null;
  if (isEventStaff) {
    if (!input.eventId || !(await hasApprovedEventStaffRole(ctx, input.eventId, "SELLER"))) {
      throw new ForbiddenError("shift:open");
    }
    if (
      !station.venueId ||
      !(await prisma.eventSession.findFirst({
        where: { eventId: input.eventId, venueId: station.venueId },
        select: { id: true },
      }))
    ) {
      throw new ForbiddenError("event-staff-station-scope");
    }
    eventId = input.eventId;
  }

  const open = await prisma.cashShift.findFirst({
    where: {
      stationId: station.id,
      operatorUserId: ctx.userId,
      status: { in: ["OPEN", "CLOSING"] },
    },
    select: { id: true },
  });
  if (open) throw new ConflictError("Já existe um turno aberto neste posto para si.");

  const shift = await prisma.cashShift.create({
    data: {
      organizationId: ctx.organizationId!,
      eventId,
      stationId: station.id,
      operatorUserId: ctx.userId,
      status: "OPEN",
      openedAtLocal: new Date(), // fuso do posto — simplificação MVP
      openingFloatCents: input.openingFloatCents,
      expectedCents: input.openingFloatCents,
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId!,
    actorUserId: ctx.userId,
    action: "shift.opened",
    after: sanitizeForAudit({ shiftId: shift.id, station: station.code }),
  });

  return shift;
}

/**
 * Venda presencial: cria encomenda no motor central com canal
 * BOX_OFFICE e confirma pagamento a dinheiro pelo fluxo normal
 * (INITIATED → confirmPayment), emitindo os bilhetes.
 */
export async function boxOfficeSale(ctx: AuthContext, input: BoxOfficeSaleInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const station = await scopedStation(ctx, input.stationCode);

  const hold = await prisma.inventoryHold.findUnique({
    where: { id: input.holdId },
    select: { organizationId: true, userId: true, session: { select: { eventId: true } } },
  });
  if (
    !hold ||
    hold.organizationId !== ctx.organizationId ||
    hold.userId !== ctx.userId
  ) {
    throw new ForbiddenError("boxoffice-hold-not-owned");
  }
  const isEventSeller = !ctx.permissions.has("boxoffice:sell");
  if (
    isEventSeller &&
    !(await hasApprovedEventStaffRole(ctx, hold.session.eventId, "SELLER"))
  ) {
    throw new ForbiddenError("boxoffice:sell");
  }

  const shift = await prisma.cashShift.findFirst({
    where: {
      stationId: station.id,
      operatorUserId: ctx.userId,
      status: "OPEN",
      ...(isEventSeller ? { eventId: hold.session.eventId } : {}),
    },
    select: { id: true },
  });
  if (!shift) throw new BusinessRuleError("Abra um turno antes de vender.");

  // Reutiliza o motor de vendas (mesmas regras, cálculo server-side)
  const { createOrder } = await import("@/modules/sales/service");
  const checkoutInput: CreateOrderInput = {
    holdId: input.holdId,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    attendees: input.attendees,
  };
  const order = await createOrder(
    {
      ...ctx,
      permissions: new Set([...ctx.permissions, "boxoffice:sell", "order:create"]),
    },
    checkoutInput
  );

  // Marca canal BOX_OFFICE e liga ao turno
  await prisma.order.update({
    where: { id: order.orderId },
    data: { channel: "BOX_OFFICE", shiftId: shift.id },
  });

  if (input.method !== "CASH") {
    if (!input.providerCode) throw new BusinessRuleError("Selecione um prestador de pagamento.");
    const { initiatePayment } = await import("@/modules/payments/service");
    const payment = await initiatePayment(
      { ...ctx, permissions: new Set([...ctx.permissions, "boxoffice:sell"]) },
      {
        orderId: order.orderId,
        providerCode: input.providerCode,
        method: input.method,
      },
    );
    return { ...order, payment };
  }

  // Pagamento a dinheiro: prestador CASH (seed), mesmo fluxo de confirmação
  const provider = await prisma.paymentProvider.findFirst({
    where: { code: "cash", isActive: true },
  });
  if (!provider) throw new NotFoundError("Prestador CASH (executar seed).");

  // Cria em INITIATED com providerRef próprio; confirmPayment emite bilhetes
  const payment = await prisma.payment.create({
    data: {
      organizationId: ctx.organizationId!,
      orderId: order.orderId,
      providerId: provider.id,
      method: "CASH",
      status: "INITIATED",
      amountCents: order.totalCents,
      currency: order.currency,
    },
    select: { id: true },
  });
  const providerRef = `cash-${payment.id}`;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerRef },
  });

  // Confirmação idempotente: encomenda CONFIRMED + hold consumido
  // + inventário vendido + bilhetes emitidos
  const { confirmPayment } = await import("@/modules/payments/service");
  await confirmPayment(providerRef, { source: "box_office_cash", shiftId: shift.id });

  await writeAudit({
    organizationId: ctx.organizationId!,
    actorUserId: ctx.userId,
    action: "payment.confirmed",
    after: sanitizeForAudit({
      paymentId: payment.id,
      orderId: order.orderId,
      method: "CASH",
      shiftId: shift.id,
    }),
  });

  return order;
}

/** Registar movimento de caixa autorizado (não-venda). */
export async function registerCashMovement(
  ctx: AuthContext,
  input: { shiftId: string; type: "CASH_IN" | "CASH_OUT" | "REFUND_PAID"; amountCents: number; reason: string }
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const shift = await prisma.cashShift.findUnique({ where: { id: input.shiftId } });
  if (!shift || shift.organizationId !== ctx.organizationId) throw new NotFoundError("Turno");
  if (
    !ctx.permissions.has("cash:movement") &&
    (!shift.eventId || !(await hasApprovedEventStaffRole(ctx, shift.eventId, "ORGANIZER")))
  ) {
    throw new ForbiddenError("cash:movement");
  }
  if (shift.status !== "OPEN" && shift.status !== "CLOSING") {
    throw new ConflictError("Turno fechado não aceita movimentos.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.cashMovement.create({
      data: {
        shiftId: shift.id,
        type: input.type,
        amountCents: input.amountCents,
        reason: input.reason,
        authorizedByUserId: ctx.userId,
      },
    });
    // Esperado do turno acompanha entradas/saídas autorizadas
    const delta = input.type === "CASH_IN" ? input.amountCents : -input.amountCents;
    await tx.cashShift.update({
      where: { id: shift.id },
      data: { expectedCents: { increment: delta } },
    });
  });
}

/** Fechar turno: contagem, diferença registada (nunca ignorada). */
export async function closeShift(ctx: AuthContext, input: CloseShiftInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const shift = await prisma.cashShift.findUnique({
    where: { id: input.shiftId },
    include: { organization: { select: { currency: true } } },
  });
  if (!shift || shift.organizationId !== ctx.organizationId) throw new NotFoundError("Turno");
  if (!ctx.permissions.has("shift:close")) {
    if (
      shift.operatorUserId !== ctx.userId ||
      !shift.eventId ||
      !(await hasApprovedEventStaffRole(ctx, shift.eventId, "SELLER"))
    ) {
      throw new ForbiddenError("shift:close");
    }
  }
  if (shift.status !== "OPEN" && shift.status !== "CLOSING") {
    throw new ConflictError("Turno já fechado.");
  }

  const differenceCents = input.countedCents - shift.expectedCents;

  await prisma.$transaction(async (tx) => {
    await tx.cashShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        countedCents: input.countedCents,
        differenceCents,
        differenceNotes:
          input.differenceNotes ??
          (differenceCents !== 0 ? "Diferença sem notas adicionais." : null),
        closedAt: new Date(),
        closedByUserId: ctx.userId,
      },
    });

    // Diferença é sempre registada no livro-razão (CASH_DIFFERENCE)
    if (differenceCents !== 0) {
      await tx.financialLedgerEntry.create({
        data: {
          organizationId: shift.organizationId,
          type: "CASH_DIFFERENCE",
          amountCents: differenceCents,
          currency: shift.organization.currency,
          description: `Turno ${shift.id}: diferença de caixa`,
          approvedByUserId: ctx.userId,
        },
      });
    }

    // Depósito inicial: valor contado fica em COUNTED
    await tx.cashDeposit.create({
      // A dívida pendente conserva o valor esperado da caixa, mesmo quando
      // o vendedor entrega menos dinheiro. O organizador lança o recebido
      // real e decide se mantém ou encerra a diferença.
      data: {
        shiftId: shift.id,
        amountCents: Math.max(input.countedCents, shift.expectedCents),
        outstandingCents: Math.max(input.countedCents, shift.expectedCents),
        status: "COUNTED",
      },
    });
  });

  await writeAudit({
    organizationId: shift.organizationId,
    actorUserId: ctx.userId,
    action: "shift.difference_recorded",
    before: sanitizeForAudit({ expectedCents: shift.expectedCents }),
    after: sanitizeForAudit({
      countedCents: input.countedCents,
      differenceCents,
    }),
  });

  return { shiftId: shift.id, differenceCents, status: "CLOSED" };
}

/** Organização confirma que recebeu o dinheiro contado no fecho do turno. */
export async function confirmCashDeposit(ctx: AuthContext, input: { depositId: string; receivedCents: number; clearDifference: boolean; differenceNotes?: string }) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const deposit = await prisma.cashDeposit.findUnique({
    where: { id: input.depositId },
    include: {
      shift: {
        select: {
          id: true,
          organizationId: true,
          eventId: true,
          status: true,
        },
      },
    },
  });
  if (!deposit || deposit.shift.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Entrega de caixa");
  }
  if (!ctx.permissions.has("cash:deposit") && !ctx.permissions.has("shift:reconcile")) {
    if (!deposit.shift.eventId) throw new ForbiddenError("cash:deposit");
    await assertEventOrganizer(ctx, deposit.shift.eventId);
  }
  if (deposit.status === "CONFIRMED") throw new ConflictError("Esta entrega já foi confirmada.");
  if (!["COUNTED", "HANDED_OVER", "DEPOSITED"].includes(deposit.status)) {
    throw new BusinessRuleError("Esta entrega não pode ser confirmada neste estado.");
  }
  const outstandingCents = deposit.outstandingCents || deposit.amountCents;
  if (input.receivedCents > outstandingCents) throw new BusinessRuleError("O valor recebido não pode exceder o valor pendente.");
  const remainingCents = outstandingCents - input.receivedCents;
  if (remainingCents > 0 && input.clearDifference && !input.differenceNotes?.trim()) {
    throw new BusinessRuleError("Justifique a diferença após conversar pessoalmente com o vendedor.");
  }
  const cleared = remainingCents === 0 || input.clearDifference;

  await prisma.$transaction(async (tx) => {
    const changed = await tx.cashDeposit.updateMany({
      where: {
        id: deposit.id,
        status: { in: ["COUNTED", "HANDED_OVER", "DEPOSITED"] },
      },
      data: {
        status: cleared ? "CONFIRMED" : "COUNTED",
        outstandingCents: cleared ? 0 : remainingCents,
        receivedCents: { increment: input.receivedCents },
        ...(input.differenceNotes?.trim() ? { differenceNotes: input.differenceNotes.trim() } : {}),
        handedToUserId: ctx.userId,
        ...(cleared ? { confirmedAt: new Date() } : {}),
      },
    });
    if (changed.count !== 1) throw new ConflictError("Esta entrega já foi confirmada.");
    if (cleared) await tx.cashShift.update({ where: { id: deposit.shift.id }, data: { status: "RECONCILED" } });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "cash.deposit_received",
    after: sanitizeForAudit({ depositId: deposit.id, shiftId: deposit.shift.id, receivedCents: input.receivedCents, remainingCents: cleared ? 0 : remainingCents, clearDifference: input.clearDifference, differenceNotes: input.differenceNotes }),
  });
  return { depositId: deposit.id, status: cleared ? "CONFIRMED" : "COUNTED", receivedCents: input.receivedCents, outstandingCents: cleared ? 0 : remainingCents };
}

/** Confirma, numa operação, os depósitos pendentes do mesmo evento/vendedor. */
export async function confirmCashDeposits(ctx: AuthContext, input: { depositIds: string[]; receivedCents: number; clearDifference: boolean; differenceNotes?: string }) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("cash:deposit") && !ctx.permissions.has("shift:reconcile")) throw new ForbiddenError("cash:deposit");
  const deposits = await prisma.cashDeposit.findMany({
    where: { id: { in: input.depositIds }, status: { in: ["COUNTED", "HANDED_OVER", "DEPOSITED"] }, shift: { organizationId: ctx.organizationId } },
    include: { shift: { select: { id: true, organizationId: true, operatorUserId: true, eventId: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!deposits.length || deposits.length !== new Set(input.depositIds).size) throw new NotFoundError("Valores pendentes de recebimento");
  const first = deposits[0];
  if (!first) throw new NotFoundError("Valores pendentes de recebimento");
  if (deposits.some((deposit) => deposit.shift.operatorUserId !== first.shift.operatorUserId || deposit.shift.eventId !== first.shift.eventId)) {
    throw new BusinessRuleError("Agrupe apenas valores do mesmo vendedor e evento.");
  }
  const totalOutstanding = deposits.reduce((sum, deposit) => sum + (deposit.outstandingCents || deposit.amountCents), 0);
  if (input.receivedCents > totalOutstanding) throw new BusinessRuleError("O valor recebido não pode exceder o total pendente do evento.");
  if (input.receivedCents < 0) throw new BusinessRuleError("O valor recebido não pode ser negativo.");
  const differenceCents = totalOutstanding - input.receivedCents;
  if (differenceCents > 0 && input.clearDifference && !input.differenceNotes?.trim()) throw new BusinessRuleError("Justifique a diferença após conversar pessoalmente com o vendedor.");

  let remainingReceived = input.receivedCents;
  const updates: { id: string; shiftId: string; received: number; outstanding: number; cleared: boolean }[] = [];
  for (const deposit of deposits) {
    const due = deposit.outstandingCents || deposit.amountCents;
    const received = Math.min(due, remainingReceived);
    remainingReceived -= received;
    const outstanding = due - received;
    const cleared = outstanding === 0 || input.clearDifference;
    updates.push({ id: deposit.id, shiftId: deposit.shiftId, received, outstanding: cleared ? 0 : outstanding, cleared });
  }

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const changed = await tx.cashDeposit.updateMany({
        where: { id: update.id, status: { in: ["COUNTED", "HANDED_OVER", "DEPOSITED"] } },
        data: {
          status: update.cleared ? "CONFIRMED" : "COUNTED",
          outstandingCents: update.outstanding,
          receivedCents: { increment: update.received },
          handedToUserId: ctx.userId,
          ...(input.differenceNotes?.trim() ? { differenceNotes: input.differenceNotes.trim() } : {}),
          ...(update.cleared ? { confirmedAt: new Date() } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictError("Um dos valores já foi atualizado. Recarregue a caixa.");
    }
    for (const shiftId of new Set(updates.filter((u) => u.cleared).map((u) => u.shiftId))) {
      const unsettled = await tx.cashDeposit.count({ where: { shiftId, status: { in: ["COUNTED", "HANDED_OVER", "DEPOSITED"] } } });
      if (!unsettled) await tx.cashShift.update({ where: { id: shiftId }, data: { status: "RECONCILED" } });
    }
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "cash.deposit_received",
    after: sanitizeForAudit({ depositIds: updates.map((u) => u.id), receivedCents: input.receivedCents, pendingDifferenceCents: input.clearDifference ? 0 : differenceCents, clearDifference: input.clearDifference, differenceNotes: input.differenceNotes }),
  });
  return { depositIds: updates.map((u) => u.id), receivedCents: input.receivedCents, outstandingCents: input.clearDifference ? 0 : differenceCents, status: input.clearDifference || differenceCents === 0 ? "CONFIRMED" : "COUNTED" };
}
