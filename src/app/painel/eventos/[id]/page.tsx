import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "../../../_components/site-shell";
import TicketInventoryManager from "./ticket-inventory-manager";

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
        <p className="auth-switch"><Link href={`/painel/eventos/${event.id}/comissao`}>Gerir comissão e equipa</Link> · <Link href="/painel">Voltar aos meus eventos</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
