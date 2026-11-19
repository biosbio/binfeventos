import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "../../../_components/site-shell";
import TicketInventoryManager from "./ticket-inventory-manager";
import StationManager from "../../bilheteira/station-manager";

export const dynamic = "force-dynamic";

export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  if (ctx.platformRole === "PLATFORM_ADMIN") redirect("/admin");
  if (!ctx.organizationId) {
    redirect("/organizador");
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const event = await prisma.event.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      OR: [
        { responsibleUserId: ctx.userId },
        { staffMembers: { some: { userId: ctx.userId, role: "ORGANIZER", approvedAt: { not: null } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      category: true,
      coverImageUrl: true,
      status: true,
      organization: { select: { currency: true } },
      sessions: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          venueId: true,
          venue: { select: { name: true, address: true, city: true, country: true } },
        },
        orderBy: { startsAt: "asc" },
      },
      ticketTypes: {
        select: {
          id: true,
          name: true,
          category: true,
          description: true,
          basePriceCents: true,
          currency: true,
          requiresIdentity: true,
          status: true,
          batches: {
            select: {
              id: true,
              name: true,
              quantity: true,
              status: true,
              inventory: {
                select: {
                  sessionId: true,
                  totalQuantity: true,
                  soldQuantity: true,
                  reservedQuantity: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!event) notFound();

  const venueIds = [...new Set(event.sessions.map((session) => session.venueId).filter((venueId): venueId is string => Boolean(venueId)))];
  const stations = venueIds.length && ctx.permissions.has("venue:manage")
    ? await prisma.boxOfficeStation.findMany({
        where: { organizationId: ctx.organizationId, venueId: { in: venueIds }, status: "ACTIVE" },
        select: { code: true, name: true, location: true, status: true, venueId: true, venue: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <>
      <SiteHeader />
      <main className="container event-manage-page">
        <span className="section-kicker">ÁREA DE ORGANIZAÇÃO · BILHETES</span>
        <h1>Gerir evento</h1>
        <p className="section-copy">Configure os tipos de bilhete, lotes, quantidades e sessões deste evento.</p>
        <TicketInventoryManager
          eventId={event.id}
          sessions={event.sessions}
          ticketTypes={event.ticketTypes}
          currency={event.organization.currency}
        />
        {ctx.permissions.has("venue:manage") ? (
          <section className="event-stations-section">
            <span className="section-kicker">OPERAÇÃO PRESENCIAL</span>
            <h2>Postos de venda</h2>
            <p className="section-copy">Configure os postos de bilheteira associados aos locais das sessões deste evento.</p>
            <StationManager
              events={[{ id: event.id, name: event.name, sessions: event.sessions.map((session) => ({ id: session.id, venueId: session.venueId, venue: session.venue ? { name: session.venue.name, city: session.venue.city } : null })) }]}
              initialStations={stations}
            />
          </section>
        ) : null}
        <p className="auth-switch"><Link href={`/painel/eventos/${event.id}/comissao`}>Gerir comissão e equipa</Link> · <Link href="/painel">Voltar aos meus eventos</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
