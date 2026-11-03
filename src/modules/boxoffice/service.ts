import { prisma } from "@/shared/lib/prisma";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
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

  const open = await prisma.cashShift.findFirst({
    where: { stationId: station.id, operatorUserId: ctx.userId, status: { in: ["OPEN", "CLOSING"] } },
    select: { id: true },
  });
  if (open) throw new ConflictError("Já existe um turno aberto neste posto para si.");

  const shift = await prisma.cashShift.create({
    data: {
      organizationId: ctx.organizationId!,
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
  if (!ctx.permissions.has("boxoffice:sell")) throw new ForbiddenError("boxoffice:sell");
  const station = await scopedStation(ctx, input.stationCode);

  const shift = await prisma.cashShift.findFirst({
    where: {
      stationId: station.id,
      operatorUserId: ctx.userId,
      status: "OPEN",
    },
    select: { id: true },
  });
  if (!shift) throw new BusinessRuleError("Abra um turno antes de vender.");

  const hold = await prisma.inventoryHold.findUnique({
    where: { id: input.holdId },
    select: { organizationId: true, userId: true },
  });
  if (
    !hold ||
    hold.organizationId !== ctx.organizationId ||
    hold.userId !== ctx.userId
  ) {
    throw new ForbiddenError("boxoffice-hold-not-owned");
  }

  // Reutiliza o motor de vendas (mesmas regras, cálculo server-side)
  const { createOrder } = await import("@/modules/sales/service");
  const checkoutInput: CreateOrderInput = {
    holdId: input.holdId,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    attendees: input.attendees,
  };
  const order = await createOrder(
    { ...ctx, permissions: new Set([...ctx.permissions, "order:create"]) },
    checkoutInput
  );

  // Marca canal BOX_OFFICE e liga ao turno
  await prisma.order.update({
    where: { id: order.orderId },
    data: { channel: "BOX_OFFICE", shiftId: shift.id },
  });

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

  // Atualiza caixa esperado do turno
  await prisma.cashShift.update({
    where: { id: shift.id },
    data: { totalSalesCents: { increment: order.totalCents } },
  });

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
  const shift = await prisma.cashShift.findUnique({ where: { id: input.shiftId } });
  if (!shift || shift.organizationId !== ctx.organizationId) throw new NotFoundError("Turno");
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
          currency: "AOA",
          description: `Turno ${shift.id}: diferença de caixa`,
          approvedByUserId: ctx.userId,
        },
      });
    }

    // Depósito inicial: valor contado fica em COUNTED
    await tx.cashDeposit.create({
      data: { shiftId: shift.id, amountCents: input.countedCents, status: "COUNTED" },
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
