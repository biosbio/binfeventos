import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "../../../../_components/site-shell";
import EventStaffManager from "../event-staff-manager";

export const dynamic = "force-dynamic";

export default async function EventCommissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  if (ctx.platformRole === "PLATFORM_ADMIN") redirect("/admin");
  if (!ctx.organizationId) redirect("/organizador");

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
      status: true,
      responsibleUserId: true,
      staffMembers: {
        select: {
          id: true,
          userId: true,
          role: true,
          invitedAt: true,
          approvedAt: true,
          invite: { select: { createdByUserId: true } },
          user: { select: { fullName: true, email: true, status: true } },
        },
        orderBy: { invitedAt: "desc" },
      },
      staffInvites: {
        where: { revokedAt: null, expiresAt: { gt: new Date() }, members: { none: {} } },
        select: { id: true, role: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <main className="container event-manage-page">
        <span className="section-kicker">ÁREA DE ORGANIZAÇÃO · EQUIPA</span>
        <h1>Comissão</h1>
        <p className="section-copy">
          {event.name} · convide co-organizadores, vendedores e equipa de portaria, partilhe os links e acompanhe os pedidos de acesso.
        </p>
        <EventStaffManager
          eventId={event.id}
          members={event.staffMembers}
          invites={event.staffInvites}
          primaryOrganizerId={event.responsibleUserId}
          protectedOrganizerId={event.staffMembers.find((member) => member.userId === ctx.userId && member.role === "ORGANIZER" && member.approvedAt)?.invite?.createdByUserId ?? null}
        />
        <p className="auth-switch">
          <Link href={`/painel/eventos/${event.id}`}>Gerir bilhetes</Link> · <Link href="/painel">Voltar aos meus eventos</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
