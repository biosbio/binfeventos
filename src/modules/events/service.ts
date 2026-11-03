import type { EventStatus } from "@prisma/client";
import { prisma } from "@/shared/lib/prisma";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import { type AuthContext } from "@/shared/auth";
import { canTransition, transitionLabel } from "./state-machine";
import type { CreateEventInput, SessionInput, VenueInput } from "./schemas";

// ============================================================
// Módulo events — lógica de negócio.
// Regras:
// - Isolamento multiempresa: TODO o acesso passa por
//   `scopedEvent()` que exige organizationId do contexto.
// - Transições de estado validadas pela máquina (state-machine.ts).
// - Cancelar/postergar NÃO apaga obrigações financeiras (Partes 13+).
// - Toda alteração de estado gera AuditLog.
// ============================================================

/** Busca evento FORÇANDO o escopo da organização (SEC-02 ABAC). */
async function scopedEvent(ctx: AuthContext, eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { sessions: true },
  });
  // Administrador da plataforma pode aprovar publicação globalmente.
  // Todos os restantes continuam estritamente limitados à organização da sessão.
  if (
    !event ||
    (ctx.platformRole !== "PLATFORM_ADMIN" &&
      (!ctx.organizationId || event.organizationId !== ctx.organizationId))
  ) {
    throw new NotFoundError("Evento"); // neutro: não revela existência em outra org
  }
  return event;
}

/** Criar evento (começa sempre em DRAFT). */
export async function createEvent(ctx: AuthContext, input: CreateEventInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

  const baseSlug = (input.slug || input.name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "") || "evento";
  let slug = baseSlug;
  for (let suffix = 2; await prisma.event.findFirst({
    where: { organizationId: ctx.organizationId, slug },
    select: { id: true },
  }); suffix += 1) {
    const suffixText = `-${suffix}`;
    slug = `${baseSlug.slice(0, 80 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
  }

  const event = await prisma.event.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      category: input.category,
      coverImageUrl: input.coverImageUrl ?? null,
      entryRules: input.entryRules ?? null,
      terms: input.terms ?? null,
      responsibleUserId: ctx.userId,
      status: "DRAFT",
    },
    select: { id: true, slug: true, status: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "event.created",
    after: sanitizeForAudit({ ...input, slug }),
  });

  return event;
}

/** Atualizar dados do evento (bloqueado em estados terminais). */
export async function updateEvent(
  ctx: AuthContext,
  eventId: string,
  input: Partial<CreateEventInput>
) {
  const event = await scopedEvent(ctx, eventId);
  if (["CANCELLED", "COMPLETED", "CLOSED"].includes(event.status)) {
    throw new BusinessRuleError("Evento em estado terminal; não pode ser editado.");
  }

  if (input.slug && input.slug !== event.slug) {
    const slugTaken = await prisma.event.findFirst({
      where: { organizationId: event.organizationId, slug: input.slug, NOT: { id: event.id } },
      select: { id: true },
    });
    if (slugTaken) throw new ConflictError("Slug já utilizado nesta organização.");
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.description !== undefined && { description: input.description ?? null }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl ?? null }),
      ...(input.entryRules !== undefined && { entryRules: input.entryRules ?? null }),
      ...(input.terms !== undefined && { terms: input.terms ?? null }),
    },
  });

  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "event.updated",
    before: sanitizeForAudit({
      name: event.name, slug: event.slug, category: event.category,
    }),
    after: sanitizeForAudit(input),
  });
}

/** Transição de estado — coração da máquina. Valida + audita. */
export async function transitionEvent(
  ctx: AuthContext,
  eventId: string,
  to: EventStatus
) {
  if (
    ctx.platformRole === "PLATFORM_ADMIN" &&
    (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  const event = await scopedEvent(ctx, eventId);
  const from = event.status;

  // Defesa em profundidade: mesmo que uma rota seja alterada por engano,
  // nenhum organizador consegue publicar diretamente um evento.
  if (to === "PUBLISHED") {
    if (ctx.platformRole !== "PLATFORM_ADMIN") {
      throw new ForbiddenError("admin-publication-approval-required");
    }
    if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) {
      throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
    }
  }

  if (from === to) throw new ConflictError(`Evento já está ${transitionLabel(to)}.`);
  if (!canTransition(from, to)) {
    throw new BusinessRuleError(
      `Transição inválida: ${transitionLabel(from)} → ${transitionLabel(to)}.`
    );
  }

  // Regras adicionais por destino:
  // PUBLICAR exige pelo menos uma sessão futura
  if (to === "PUBLISHED") {
    const hasFutureSession = event.sessions.some((s) => s.endsAt > new Date());
    if (!hasFutureSession) {
      throw new BusinessRuleError("Adicione pelo menos uma sessão futura antes de publicar.");
    }
  }
  // CANCELAR exige que não haja vendas confirmadas sem tratamento —
  // verificação completa de reembolsos fica no Domínio 5 (Partes 13+);
  // aqui registramos a intenção e o cancelamento operacional.
  if (to === "CANCELLED" || to === "POSTPONED") {
    const confirmedOrders = await prisma.order.count({
      where: {
        sessionId: { in: event.sessions.map((s) => s.id) },
        status: "CONFIRMED",
      },
    });
    if (confirmedOrders > 0) {
      // Cancelamento com vendas exige decisão financeira explícita.
      // Ação permitida, mas marcada para revisão — Domínio 5 tratará
      // reembolsos; o audit registra o número de encomendas afetadas.
      await writeAudit({
        organizationId: event.organizationId,
        actorUserId: ctx.userId,
        action: to === "CANCELLED" ? "event.cancelled" : "event.postponed",
        before: { status: from },
        after: { status: to, confirmedOrdersAffected: confirmedOrders },
      });
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      status: to,
      ...(to === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  const actionMap: Record<string, "event.published" | "event.suspended" | "event.cancelled" | "event.postponed" | "event.closed"> = {
    PUBLISHED: "event.published",
    SUSPENDED: "event.suspended",
    SOLD_OUT: "event.suspended", // esgotado: auditoria como suspensão automática de venda
    CANCELLED: "event.cancelled",
    POSTPONED: "event.postponed",
    CLOSED: "event.closed",
  };
  const auditAction = actionMap[to];
  if (auditAction) {
    await writeAudit({
      organizationId: event.organizationId,
      actorUserId: ctx.userId,
      action: auditAction,
      before: { status: from },
      after: { status: to },
    });
  }

  // TODO (Domínio 10): notificar compradores em CANCELLED/POSTPONED.
  return { id: event.id, status: to };
}

/** Adicionar sessão a um evento. */
export async function addSession(ctx: AuthContext, input: SessionInput) {
  const event = await scopedEvent(ctx, input.eventId);
  if (["CANCELLED", "COMPLETED", "CLOSED"].includes(event.status)) {
    throw new BusinessRuleError("Evento em estado terminal; sessões não podem ser alteradas.");
  }

  // Sessão não pode começar no passado (tolerância de 1h para criação)
  if (input.startsAt.getTime() < Date.now() - 3_600_000) {
    throw new BusinessRuleError("A sessão não pode começar no passado.");
  }

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      venueId: input.venueId ?? null,
      name: input.name ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      doorsOpenAt: input.doorsOpenAt ?? null,
    },
    select: { id: true, startsAt: true },
  });

  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "session.created",
    after: sanitizeForAudit({ sessionId: session.id, startsAt: input.startsAt.toISOString() }),
  });

  return session;
}

/** Criar recinto (reutilizável entre eventos da organização). */
export async function createVenue(ctx: AuthContext, input: VenueInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

  const venue = await prisma.venue.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country,
      capacity: input.capacity ?? null,
      mapUrl: input.mapUrl ?? null,
    },
    select: { id: true, name: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "venue.created",
    after: sanitizeForAudit(input),
  });

  return venue;
}

/** Listar eventos da organização (isolamento por contexto). */
export async function listEvents(ctx: AuthContext, status?: EventStatus) {
  if (!ctx.organizationId && ctx.platformRole !== "PLATFORM_ADMIN") {
    throw new ForbiddenError("no-active-organization");
  }
  return prisma.event.findMany({
    where: {
      ...(ctx.platformRole === "PLATFORM_ADMIN" ? {} : { organizationId: ctx.organizationId! }),
      ...(status && { status }),
    },
    select: {
      id: true, name: true, slug: true, category: true, status: true,
      publishedAt: true, createdAt: true,
      sessions: { select: { id: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Detalhe do evento (escopo da organização). */
export async function getEvent(ctx: AuthContext, eventId: string) {
  return scopedEvent(ctx, eventId);
}

/** Erro explícito para uso indevido (defensivo). */
export function ensureContext(ctx: AuthContext): void {
  if (!ctx.organizationId) throw new AppError("NO_CONTEXT", 412, "Selecione uma organização.");
}
