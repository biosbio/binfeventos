import { randomBytes } from "crypto";
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
import type { CreateOrderInput } from "./schemas";

// ============================================================
// Módulo sales — motor de checkout (Domínio 4).
//
// Regras críticas (documento mestre, secções 1, 4, 12 + SEC):
// 1. TODOS os valores monetários são calculados NO SERVIDOR:
//    preço unitário vem do lote/tipo (base), nunca do cliente.
// 2. subtotal, taxas, impostos, comissão e total derivam do
//    servidor; o cliente apenas recebe o resumo para conferir.
// 3. Encomenda mono-sessão (hold define a sessão).
// 4. Identificação obrigatória de cada titular (comprador ≠ titular;
//    não é obrigatório criar conta para cada titular).
// 5. checkoutIdempotencyKey: uma intenção de compra gera uma
//    encomenda; repetições devolvem a mesma.
// 6. Registo da origem (SalesChannel) em cada venda.
// ============================================================

/** Taxa de serviço da plataforma (%) — config por organização no futuro. */
const SERVICE_FEE_BPS = 500; // 5,00%
/** Comissão da plataforma (%) — modelo combinado aprovado. */
const COMMISSION_BPS = 800; // 8,00%

/** Gera número de encomenda legível e resistente a concorrência. */
function nextOrderNumber(): string {
  const year = new Date().getFullYear();
  return `BINF-${year}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * Cria a encomenda a partir de um hold ativo.
 * Valores 100% server-side; cliente não envia nenhum valor monetário.
 */
export async function createOrder(
  ctx: AuthContext,
  input: CreateOrderInput
): Promise<{
  orderId: string;
  orderNumber: string;
  totalCents: number;
  currency: string;
  subtotalCents: number;
  serviceFeeCents: number;
  taxCents: number;
  commissionCents: number;
  status: string;
}> {
  const idempotencyKey = input.checkoutIdempotencyKey ?? generateIdempotencyKey();

  // Idempotência: devolve a encomenda existente se a chave já foi usada
  const existing = await prisma.order.findUnique({
    where: { checkoutIdempotencyKey: idempotencyKey },
    select: {
      id: true, organizationId: true, buyerUserId: true, orderNumber: true, totalCents: true, currency: true,
      subtotalCents: true, serviceFeeCents: true, taxCents: true,
      commissionCents: true, status: true,
    },
  });
  if (existing) {
    const isBuyer = existing.buyerUserId === ctx.userId;
    const isOrgOperator =
      ctx.organizationId === existing.organizationId && ctx.permissions.has("order:read");
    if (!isBuyer && !isOrgOperator) throw new ForbiddenError("checkout-idempotency-key-not-owned");
    if (
      isOrgOperator &&
      (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
    ) {
      throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
    }
    return { orderId: existing.id, orderNumber: existing.orderNumber, totalCents: existing.totalCents, currency: existing.currency, subtotalCents: existing.subtotalCents, serviceFeeCents: existing.serviceFeeCents, taxCents: existing.taxCents, commissionCents: existing.commissionCents, status: existing.status };
  }

  // Hold pertencente ao comprador ou operado pela bilheteira da mesma organização.
  const hold = await prisma.inventoryHold.findUnique({ where: { id: input.holdId } });
  if (!hold) throw new NotFoundError("Reserva");
  const isBuyer = hold.userId === ctx.userId;
  const isOrgOperator =
    ctx.organizationId === hold.organizationId && ctx.permissions.has("boxoffice:sell");
  if (!isBuyer && !isOrgOperator) throw new ForbiddenError("hold-not-owned");
  if (
    isOrgOperator &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  const organizationId = hold.organizationId;
  await assertOrgActive(organizationId);
  if (hold.status !== "RESERVED") {
    throw new ConflictError(`Reserva em estado ${hold.status}.`);
  }
  if (hold.expiresAt <= new Date()) {
    throw new ConflictError("Reserva expirada. Recomece a compra.");
  }

  // Dados de catálogo (fonte única de valores: base de dados)
  const batch = await prisma.ticketBatch.findUnique({
    where: { id: hold.batchId },
    select: { priceCents: true, ticketTypeId: true },
  });
  const ticketType = await prisma.ticketType.findUnique({
    where: { id: hold.ticketTypeId },
    select: { basePriceCents: true, currency: true },
  });
  if (!batch || !ticketType) throw new NotFoundError("Catálogo do lote/tipo");

  // Titulares: quantidade tem de cobrir exatamente os bilhetes reservados
  const attendeesForType = input.attendees.filter(
    (a) => a.ticketTypeId === hold.ticketTypeId
  );
  if (input.attendees.length !== hold.quantity || attendeesForType.length !== hold.quantity) {
    throw new BusinessRuleError(
      `São necessários ${hold.quantity} titulares identificados para este tipo de bilhete.`
    );
  }

  // === CÁLCULO FINANCEIRO (exclusivamente server-side) ===
  const unitPriceCents = batch.priceCents ?? ticketType.basePriceCents;
  const lineSubtotalCents = unitPriceCents * hold.quantity;
  const subtotalCents = lineSubtotalCents;
  const serviceFeeCents = Math.round((subtotalCents * SERVICE_FEE_BPS) / 10_000);
  const commissionCents = Math.round((subtotalCents * COMMISSION_BPS) / 10_000);
  const taxCents = 0; // regra fiscal por mercado — Domínio 5 (Parte 14)
  const totalCents = subtotalCents + serviceFeeCents + taxCents;

  const order = await prisma.$transaction(async (tx) => {
    // Revalida o hold dentro da transação (ninguém o confirmou entretanto)
    const fresh = await tx.inventoryHold.findUnique({
      where: { id: hold.id },
      select: { status: true },
    });
    if (!fresh || fresh.status !== "RESERVED") {
      throw new ConflictError("Reserva já consumida. Recomece a compra.");
    }

    const created = await tx.order.create({
      data: {
        organizationId,
        orderNumber: nextOrderNumber(),
        buyerUserId: ctx.userId,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        buyerPhone: input.buyerPhone ?? null,
        status: "RESERVED",
        channel: "MARKETPLACE",
        subtotalCents,
        serviceFeeCents,
        taxCents,
        commissionCents,
        totalCents,
        currency: ticketType.currency,
        checkoutIdempotencyKey: idempotencyKey,
        holdId: hold.id,
        sessionId: hold.sessionId,
        expiresAt: hold.expiresAt,
      },
      select: { id: true, orderNumber: true },
    });

    await tx.orderLine.create({
      data: {
        orderId: created.id,
        ticketTypeId: hold.ticketTypeId,
        batchId: hold.batchId,
        quantity: hold.quantity,
        unitPriceCents,
        lineSubtotalCents,
      },
    });

    // Titulares identificados (comprador ≠ titular; sem conta obrigatória)
    for (const a of attendeesForType) {
      await tx.orderAttendee.create({
        data: {
          orderId: created.id,
          ticketTypeId: hold.ticketTypeId,
          fullName: a.fullName,
          email: a.email ?? null,
          phone: a.phone ?? null,
          documentType: a.documentType ?? null,
          documentNumber: a.documentNumber ?? null,
        },
      });
    }

    // Claim atómico do hold: duas compras concorrentes não podem
    // converter a mesma reserva em duas encomendas.
    const consumedHold = await tx.inventoryHold.updateMany({
      where: {
        id: hold.id,
        organizationId,
        status: "RESERVED",
        expiresAt: { gt: new Date() },
      },
      data: { status: "PENDING_PAYMENT" },
    });
    if (consumedHold.count !== 1) {
      throw new ConflictError("Reserva já consumida ou expirada. Recomece a compra.");
    }

    return created;
  });

  await writeAudit({
    organizationId,
    actorUserId: ctx.userId,
    action: "order.created",
    after: sanitizeForAudit({
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents,
      channel: "MARKETPLACE",
    }),
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents,
    currency: ticketType.currency,
    subtotalCents,
    serviceFeeCents,
    taxCents,
    commissionCents,
    status: "RESERVED",
  };
}

/** Cancelar encomenda antes do pagamento (liberta o hold). */
export async function cancelOrder(ctx: AuthContext, orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Encomenda");
  const isBuyer = order.buyerUserId === ctx.userId;
  const isOrgOperator =
    ctx.organizationId === order.organizationId && ctx.permissions.has("order:cancel");
  if (!isBuyer && !isOrgOperator) throw new ForbiddenError("order:cancel");
  if (
    isOrgOperator &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  if (!["DRAFT", "RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
    throw new ConflictError(`Encomenda em estado ${order.status} não pode ser cancelada aqui.`);
  }

  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.order.updateMany({
      where: {
        id: order.id,
        organizationId: order.organizationId,
        status: { in: ["DRAFT", "RESERVED", "PENDING_PAYMENT"] },
      },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (cancelled.count !== 1) {
      throw new ConflictError("A encomenda mudou de estado e já não pode ser cancelada.");
    }

    if (order.holdId) {
      const hold = await tx.inventoryHold.findUnique({
        where: { id: order.holdId },
        select: { status: true, quantity: true, sessionId: true, ticketTypeId: true, batchId: true },
      });
      if (hold && hold.status === "PENDING_PAYMENT") {
        await tx.inventoryHold.updateMany({
          where: { id: order.holdId, status: "PENDING_PAYMENT" },
          data: { status: "CANCELLED", releasedAt: new Date() },
        });
        await tx.ticketInventory.update({
          where: {
            sessionId_ticketTypeId_batchId: {
              sessionId: hold.sessionId,
              ticketTypeId: hold.ticketTypeId,
              batchId: hold.batchId,
            },
          },
          data: { reservedQuantity: { decrement: hold.quantity } },
        });
      }
    }
  });

  await writeAudit({
    organizationId: order.organizationId,
    actorUserId: ctx.userId,
    action: "order.cancelled",
    before: { status: order.status },
    after: { status: "CANCELLED" },
  });
}

/** Consulta de encomenda do próprio comprador (isolamento). */
export async function getOrder(ctx: AuthContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { ticketType: { select: { name: true, category: true } } } },
      attendees: { select: { fullName: true, ticketTypeId: true } },
    },
  });
  if (!order) throw new NotFoundError("Encomenda");
  const isBuyer = order.buyerUserId === ctx.userId;
  const isOrgOperator =
    ctx.organizationId === order.organizationId && ctx.permissions.has("order:read");
  if (!isBuyer && !isOrgOperator) throw new ForbiddenError("order:read");
  if (
    isOrgOperator &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  return order;
}
