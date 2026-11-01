import { prisma } from "@/shared/lib/prisma";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InsufficientInventoryError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit, assertOrgActive } from "@/shared/audit";
import { generateIdempotencyKey } from "@/shared/lib/security";
import type { AuthContext } from "@/shared/auth";
import type { CreateBatchInput, CreateTicketTypeInput, HoldRequestInput } from "./schemas";

// ============================================================
// Módulo inventory — núcleo transacional (Domínio 3).
//
// Regras críticas (documento mestre + SEC):
// 1. Disponibilidade = total − reservado − vendido, calculada
//    DENTRO de transação com bloqueio pessimista (FOR UPDATE).
// 2. Prazo de expiração definido pelo SERVIDOR — o cliente
//    nunca controla prazos ou valores.
// 3. Idempotência: mesma chave nunca cria duas reservas.
// 4. Estado VERIFYING protege o inventário enquanto o pagamento
//    não tem resultado definitivo (nunca expira automaticamente).
// 5. Expiração de reservas por job periódico (releaseExpiredHolds).
// 6. Estados do lote geridos por rota auditada (SCHEDULED/OPEN/
//    PAUSED/CLOSED) — sem isso os lotes nunca ficavam à venda.
// ============================================================

/** Duração padrão da reserva temporária (10 minutos). */
const HOLD_TTL_MS = 10 * 60 * 1000;

/** Escopo multiempresa: tipo de bilhete da organização do contexto. */
async function scopedTicketType(ctx: AuthContext, ticketTypeId: string) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const tt = await prisma.ticketType.findUnique({
    where: { id: ticketTypeId },
    include: { event: { select: { id: true, status: true, organizationId: true } } },
  });
  if (!tt || tt.organizationId !== ctx.organizationId) throw new NotFoundError("Tipo de bilhete");
  return tt;
}

/** Criar tipo de bilhete (preço base validado no servidor). */
export async function createTicketType(ctx: AuthContext, input: CreateTicketTypeInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

  const event = await prisma.event.findUnique({ where: { id: input.eventId } });
  if (!event || event.organizationId !== ctx.organizationId) throw new NotFoundError("Evento");
  if (["CANCELLED", "COMPLETED", "CLOSED"].includes(event.status)) {
    throw new BusinessRuleError("Evento em estado terminal.");
  }

  const ticketType = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      organizationId: ctx.organizationId,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
      basePriceCents: input.basePriceCents,
      requiresIdentity: input.requiresIdentity,
      status: "ACTIVE",
    },
    select: { id: true, name: true, category: true, basePriceCents: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ticket_type.created",
    after: sanitizeForAudit(input),
  });

  return ticketType;
}

/** Criar lote + inventário da sessão em transação atômica. */
export async function createBatch(ctx: AuthContext, input: CreateBatchInput) {
  const tt = await scopedTicketType(ctx, input.ticketTypeId);

  // Sessão tem de pertencer ao MESMO evento do tipo de bilhete
  const session = await prisma.eventSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.eventId !== tt.eventId) {
    throw new BusinessRuleError("Sessão não pertence ao evento deste tipo de bilhete.");
  }

  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.ticketBatch.create({
      data: {
        ticketTypeId: tt.id,
        name: input.name,
        quantity: input.quantity,
        priceCents: input.priceCents ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        maxPerBuyer: input.maxPerBuyer,
        status: "SCHEDULED",
      },
      select: { id: true, name: true },
    });

    // Inventário inicial do lote nesta sessão (upsert: soma se já existir)
    await tx.ticketInventory.upsert({
      where: {
        sessionId_ticketTypeId_batchId: {
          sessionId: session.id,
          ticketTypeId: tt.id,
          batchId: b.id,
        },
      },
      update: { totalQuantity: { increment: input.quantity } },
      create: {
        sessionId: session.id,
        ticketTypeId: tt.id,
        batchId: b.id,
        totalQuantity: input.quantity,
      },
    });

    return b;
  });

  await writeAudit({
    organizationId: tt.organizationId,
    actorUserId: ctx.userId,
    action: "batch.created",
    after: sanitizeForAudit({ batchId: batch.id, quantity: input.quantity }),
  });

  return batch;
}

/**
 * Transição de estado do lote (SCHEDULED → OPEN → PAUSED → OPEN → CLOSED).
 * Sem isto os lotes nunca ficavam à venda (bug corrigido na Parte 19).
 * SOLD_OUT é automático: só o job/sistema o define; manualmente apenas
 * OPEN/PAUSED/CLOSED.
 */
export async function transitionBatch(
  ctx: AuthContext,
  batchId: string,
  to: "OPEN" | "PAUSED" | "CLOSED"
) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

  const tt = await prisma.ticketType.findFirst({
    where: { batches: { some: { id: batchId } } },
    select: { organizationId: true },
  });
  if (!tt || tt.organizationId !== ctx.organizationId) throw new NotFoundError("Lote");

  const batch = await prisma.ticketBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError("Lote");
  if (batch.status === to) throw new ConflictError(`Lote já está ${to}.`);
  if (batch.status === "SOLD_OUT" && to !== "CLOSED") {
    throw new BusinessRuleError("Lote esgotado: apenas pode ser encerrado.");
  }

  // Abrir exige janela de comercialização válida (datas validadas no servidor)
  if (to === "OPEN" && (batch.endsAt.getTime() <= Date.now())) {
    throw new BusinessRuleError("Janela de comercialização já terminou.");
  }

  await prisma.ticketBatch.update({ where: { id: batchId }, data: { status: to } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "batch.status_changed",
    before: { status: batch.status },
    after: { status: to },
  });

  return { batchId, status: to };
}

/** Consultar disponibilidade (sem valores sensíveis; leitura pública do marketplace). */
export async function getAvailability(sessionId: string) {
  const session = await prisma.eventSession.findUnique({
    where: { id: sessionId },
    include: {
      event: { select: { status: true, organization: { select: { status: true } } } },
    },
  });
  if (
    !session ||
    session.event.status !== "PUBLISHED" ||
    session.event.organization.status !== "ACTIVE"
  ) {
    throw new NotFoundError("Sessão");
  }

  const rows = await prisma.ticketInventory.findMany({
    where: { sessionId },
    include: {
      ticketType: { select: { id: true, name: true, category: true, basePriceCents: true, currency: true, requiresIdentity: true } },
      batch: { select: { id: true, name: true, priceCents: true, startsAt: true, endsAt: true, maxPerBuyer: true, status: true } },
    },
  });

  const now = Date.now();
  return rows.map((r) => {
    const batchOpen =
      r.batch.status === "OPEN" &&
      r.batch.startsAt.getTime() <= now &&
      r.batch.endsAt.getTime() > now;
    const unitPriceCents = r.batch.priceCents ?? r.ticketType.basePriceCents;
    return {
      ticketTypeId: r.ticketType.id,
      batchId: r.batch.id,
      name: r.ticketType.name,
      category: r.ticketType.category,
      unitPriceCents,
      currency: r.ticketType.currency,
      requiresIdentity: r.ticketType.requiresIdentity,
      onSale: batchOpen,
      available: batchOpen
        ? Math.max(0, r.totalQuantity - r.reservedQuantity - r.soldQuantity)
        : 0,
    };
  });
}

/**
 * Criar reserva temporária de inventário (hold).
 * Bloqueio pessimista: evita venda duplicada sob concorrência.
 */
export async function createHold(ctx: AuthContext, input: HoldRequestInput) {
  // Compradores não precisam pertencer à organização do evento.
  // A organização é derivada do tipo de bilhete publicado.
  // Idempotência: chave do cliente ou gerada pelo servidor
  const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey();

  const tt = await prisma.ticketType.findUnique({
    where: { id: input.ticketTypeId },
    include: { event: { select: { status: true } } },
  });
  if (!tt || tt.event.status !== "PUBLISHED") {
    throw new NotFoundError("Tipo de bilhete disponível");
  }
  const organizationId = tt.organizationId;
  await assertOrgActive(organizationId);

  // Operadores internos continuam sujeitos à autenticação reforçada.
  if (
    ctx.organizationId === organizationId &&
    ctx.permissions.has("boxoffice:sell") &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }

  const existing = await prisma.inventoryHold.findUnique({
    where: { idempotencyKey },
  });
  if (
    existing &&
    existing.userId === ctx.userId &&
    existing.organizationId === organizationId &&
    existing.status === "RESERVED" &&
    existing.expiresAt > new Date()
  ) {
    return { holdId: existing.id, expiresAt: existing.expiresAt, idempotencyKey };
  }
  if (existing) {
    throw new ConflictError("Chave de idempotência já utilizada ou pertencente a outra conta.");
  }

  // Validação da sessão antes da transação
  const session = await prisma.eventSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.eventId !== tt.eventId) {
    throw new BusinessRuleError("Sessão não pertence ao evento deste tipo de bilhete.");
  }
  const expiresAt = new Date(Date.now() + HOLD_TTL_MS);

  const hold = await prisma.$transaction(async (tx) => {
    // Serializa reservas simultâneas do mesmo comprador na mesma sessão,
    // inclusive quando tentam lotes diferentes ao mesmo tempo.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.userId}), hashtext(${input.sessionId}))`;

    // BLOQUEIO PESSIMISTA na linha de inventário (SEC: exclusividade de venda)
    const [inv] = await tx.$queryRaw<
      { id: string; available: number }[]
    >`
      SELECT id, ("totalQuantity" - "reservedQuantity" - "soldQuantity") AS available
      FROM "ticket_inventory"
      WHERE "sessionId" = ${input.sessionId}
        AND "ticketTypeId" = ${input.ticketTypeId}
        AND "batchId" = ${input.batchId}
      FOR UPDATE
    `;
    if (!inv) throw new NotFoundError("Inventário do lote nesta sessão");

    // Revalida idempotência dentro da transação: duas requisições com a
    // mesma chave não podem reservar duas vezes o mesmo inventário.
    const concurrentExisting = await tx.inventoryHold.findUnique({
      where: { idempotencyKey },
    });
    if (concurrentExisting) {
      if (
        concurrentExisting.userId === ctx.userId &&
        concurrentExisting.organizationId === organizationId &&
        concurrentExisting.status === "RESERVED" &&
        concurrentExisting.expiresAt > new Date()
      ) {
        return { id: concurrentExisting.id, expiresAt: concurrentExisting.expiresAt };
      }
      throw new ConflictError("Chave de idempotência já utilizada.");
    }

    if (inv.available < input.quantity) throw new InsufficientInventoryError();

    // Limite por comprador: cada titular conta apenas as suas reservas.
    const userHolds = await tx.inventoryHold.aggregate({
      where: {
        userId: ctx.userId,
        sessionId: input.sessionId,
        status: { in: ["RESERVED", "PENDING_PAYMENT", "VERIFYING"] },
      },
      _sum: { quantity: true },
    });
    const batch = await tx.ticketBatch.findUnique({
      where: { id: input.batchId },
      select: { maxPerBuyer: true, status: true, startsAt: true, endsAt: true },
    });
    if (!batch) throw new NotFoundError("Lote");
    const now = Date.now();
    if (batch.status !== "OPEN" || batch.startsAt.getTime() > now || batch.endsAt.getTime() <= now) {
      throw new BusinessRuleError("Lote não está em comercialização.");
    }
    if ((userHolds._sum.quantity ?? 0) + input.quantity > batch.maxPerBuyer) {
      throw new BusinessRuleError(`Limite de ${batch.maxPerBuyer} bilhetes por compra.`);
    }

    // Reserva o inventário
    await tx.ticketInventory.update({
      where: { id: inv.id },
      data: { reservedQuantity: { increment: input.quantity } },
    });

    return tx.inventoryHold.create({
      data: {
        organizationId,
        userId: ctx.userId,
        sessionId: input.sessionId,
        ticketTypeId: input.ticketTypeId,
        batchId: input.batchId,
        status: "RESERVED",
        quantity: input.quantity,
        idempotencyKey,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
  });

  return { holdId: hold.id, expiresAt: hold.expiresAt, idempotencyKey };
}

/** Confirmar hold (venda): move quantidade de reservado para vendido. */
export async function confirmHold(holdId: string): Promise<{
  sessionId: string;
  ticketTypeId: string;
  batchId: string;
  quantity: number;
}> {
  const hold = await prisma.$transaction(async (tx) => {
    const h = await tx.inventoryHold.findUnique({ where: { id: holdId } });
    if (!h) throw new NotFoundError("Reserva");
    const claimed = await tx.inventoryHold.updateMany({
      where: { id: h.id, status: "RESERVED", expiresAt: { gt: new Date() } },
      data: { status: "CONFIRMED", releasedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictError("Reserva já tratada ou expirada.");
    }

    await tx.ticketInventory.update({
      where: {
        sessionId_ticketTypeId_batchId: {
          sessionId: h.sessionId,
          ticketTypeId: h.ticketTypeId,
          batchId: h.batchId,
        },
      },
      data: {
        reservedQuantity: { decrement: h.quantity },
        soldQuantity: { increment: h.quantity },
      },
    });

    return {
      sessionId: h.sessionId,
      ticketTypeId: h.ticketTypeId,
      batchId: h.batchId,
      quantity: h.quantity,
    };
  });

  return hold;
}

/** Libertar hold manualmente (cancelamento do comprador). */
export async function releaseHold(ctx: AuthContext, holdId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const h = await tx.inventoryHold.findUnique({ where: { id: holdId } });
    if (!h) throw new NotFoundError("Reserva");
    const linkedOrder = await tx.order.findFirst({
      where: { holdId: h.id, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (linkedOrder) {
      throw new BusinessRuleError("A reserva já pertence a uma encomenda. Cancele a encomenda para libertar o inventário.");
    }
    const isBuyer = h.userId === ctx.userId;
    const isOrgOperator =
      ctx.organizationId === h.organizationId && ctx.permissions.has("order:cancel");
    if (!isBuyer && !isOrgOperator) throw new ForbiddenError("hold-not-owned");
    if (
      isOrgOperator &&
      (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
    ) {
      throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
    }
    const claimed = await tx.inventoryHold.updateMany({
      where: {
        id: h.id,
        organizationId: h.organizationId,
        status: "RESERVED",
        expiresAt: { gt: new Date() },
      },
      data: { status: "CANCELLED", releasedAt: new Date() },
    });
    if (claimed.count !== 1) return; // idempotente: já tratada/expirada

    await tx.ticketInventory.update({
      where: {
        sessionId_ticketTypeId_batchId: {
          sessionId: h.sessionId,
          ticketTypeId: h.ticketTypeId,
          batchId: h.batchId,
        },
      },
      data: { reservedQuantity: { decrement: h.quantity } },
    });
  });
}

/**
 * Job: expirar reservas vencidas.
 * Apenas estado RESERVED expira; PENDING_PAYMENT e VERIFYING permanecem
 * protegidos até o pagamento ter resultado definitivo (doc. mestre).
 * Chamar periodicamente (cron/worker) — idempotente.
 */
export async function releaseExpiredHolds(): Promise<{ released: number }> {
  const now = new Date();
  const expired = await prisma.inventoryHold.findMany({
    where: { status: { in: ["RESERVED", "PENDING_PAYMENT"] }, expiresAt: { lte: now } },
    select: { id: true, sessionId: true, ticketTypeId: true, batchId: true, quantity: true },
    take: 500,
  });

  let released = 0;
  for (const hold of expired) {
    const expiredOrderId = await prisma.$transaction(async (tx) => {
      // O lock do hold serializa a limpeza com a iniciação do pagamento.
      await tx.$queryRaw`SELECT "id" FROM "inventory_holds" WHERE "id" = ${hold.id}::uuid FOR UPDATE`;
      const freshHold = await tx.inventoryHold.findUnique({
        where: { id: hold.id },
        select: { status: true, expiresAt: true },
      });
      if (
        !freshHold ||
        !["RESERVED", "PENDING_PAYMENT"].includes(freshHold.status) ||
        freshHold.expiresAt > new Date()
      ) return null;

      const linkedOrder = await tx.order.findFirst({
        where: { holdId: hold.id },
        select: { id: true, status: true },
      });
      if (linkedOrder) {
        const activePayment = await tx.payment.findFirst({
          where: {
            orderId: linkedOrder.id,
            status: { in: ["CREATED", "INITIATED", "AWAITING_AUTHORIZATION", "PROCESSING", "UNDER_REVIEW"] },
          },
          select: { id: true },
        });
        if (activePayment) return null;
      }

      const claimed = await tx.inventoryHold.updateMany({
        where: {
          id: hold.id,
          status: { in: ["RESERVED", "PENDING_PAYMENT"] },
          expiresAt: { lte: new Date() },
        },
        data: { status: "EXPIRED", releasedAt: new Date() },
      });
      if (claimed.count !== 1) return null;

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
      return linkedOrder && ["RESERVED", "PENDING_PAYMENT"].includes(linkedOrder.status)
        ? linkedOrder.id
        : null;
    });

    if (expiredOrderId) {
      await prisma.order.updateMany({
        where: { id: expiredOrderId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
        data: { status: "EXPIRED" },
      });
    }
    // Contabiliza apenas quando o hold já ficou EXPIRED.
    const current = await prisma.inventoryHold.findUnique({
      where: { id: hold.id },
      select: { status: true },
    });
    if (current?.status === "EXPIRED") released += 1;
  }

  return { released };
}

/** Marcar hold como em verificação (pagamento pendente indefinido). */
export async function markHoldVerifying(holdId: string): Promise<void> {
  const current = await prisma.inventoryHold.findUnique({
    where: { id: holdId },
    select: { status: true },
  });
  if (!current) throw new NotFoundError("Reserva");
  if (current.status === "VERIFYING") return;
  if (!["RESERVED", "PENDING_PAYMENT"].includes(current.status)) {
    throw new AppError("HOLD_NOT_UPDATABLE", 409, "Reserva não pode entrar em verificação.");
  }
  const result = await prisma.inventoryHold.updateMany({
    where: { id: holdId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } },
    data: { status: "VERIFYING" },
  });
  if (result.count === 0) {
    const fresh = await prisma.inventoryHold.findUnique({
      where: { id: holdId },
      select: { status: true },
    });
    if (fresh?.status === "VERIFYING") return;
    throw new AppError("HOLD_NOT_UPDATABLE", 409, "Reserva não pode entrar em verificação.");
  }
}
