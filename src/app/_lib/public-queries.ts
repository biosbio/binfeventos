// ============================================================
// Consultas públicas do marketplace (server-side).
// Lê APENAS campos públicos: eventos publicados, sessões futuras,
// preço mínimo por evento. Nunca expõe dados sensíveis
// (usado o select explícito; sem dados de compradores).
// ============================================================

import { prisma } from "@/shared/lib/prisma";

export interface PublicEventCard {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  coverImageUrl: string | null;
  city: string | null;
  startsAt: Date;
  minPriceCents: number | null;
}

/** Eventos publicados com sessão futura — cartões do catálogo. */
export async function listPublicEvents(limit = 12): Promise<PublicEventCard[]> {
  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      sessions: { some: { endsAt: { gt: new Date() } } },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      category: true,
      description: true,
      coverImageUrl: true,
      ticketTypes: { select: { basePriceCents: true } },
      sessions: {
        where: { endsAt: { gt: new Date() } },
        select: { startsAt: true, venue: { select: { city: true } } },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });

  return events.map((e) => {
    const session = e.sessions[0];
    const prices = e.ticketTypes.map((t) => t.basePriceCents).filter((p) => p > 0);
    return {
      id: e.id,
      name: e.name,
      slug: e.slug,
      category: e.category,
      description: e.description,
      coverImageUrl: e.coverImageUrl,
      city: session?.venue?.city ?? null,
      startsAt: session?.startsAt ?? new Date(0),
      minPriceCents: prices.length > 0 ? Math.min(...prices) : null,
    };
  });
}

export interface PublicEventDetail {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  coverImageUrl: string | null;
  entryRules: string | null;
  terms: string | null;
  sessions: { id: string; startsAt: Date; endsAt: Date; city: string | null }[];
  ticketTypes: { id: string; name: string; category: string; basePriceCents: number; requiresIdentity: boolean }[];
}

/** Detalhe público por slug (eventos publicados apenas). */
export async function getPublicEventBySlug(slug: string): Promise<PublicEventDetail | null> {
  const event = await prisma.event.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      name: true,
      slug: true,
      category: true,
      description: true,
      coverImageUrl: true,
      entryRules: true,
      terms: true,
      sessions: {
        where: { endsAt: { gt: new Date() } },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          venue: { select: { city: true, name: true } },
        },
        orderBy: { startsAt: "asc" },
      },
      ticketTypes: {
        where: { status: "ACTIVE" },
        select: { id: true, name: true, category: true, basePriceCents: true, requiresIdentity: true },
        orderBy: { basePriceCents: "asc" },
      },
    },
  });
  if (!event) return null;

  return {
    ...event,
    sessions: event.sessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      city: s.venue?.city ?? s.venue?.name ?? null,
    })),
    ticketTypes: event.ticketTypes,
  };
}
