import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "../../../_components/site-shell";
import EditEventForm from "./edit-form";

export const dynamic = "force-dynamic";

export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  if (ctx.platformRole === "PLATFORM_ADMIN") redirect("/admin");
  if (!ctx.organizationId || !ctx.permissions.has("event:update")) {
    redirect("/minha-conta?aviso=criar-evento");
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const event = await prisma.event.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      responsibleUserId: ctx.userId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      category: true,
      coverImageUrl: true,
      status: true,
      sessions: {
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "48px 0 72px", maxWidth: 760 }}>
        <span className="section-kicker">ÁREA DE ORGANIZAÇÃO · EVENTO</span>
        <h1>Gerir evento</h1>
        <p className="section-copy">
          Estado atual: <strong>{event.status}</strong>. Um evento novo só fica público após aprovação da equipa BINF EVENTOS.
        </p>
        <EditEventForm event={event} />
        <p className="auth-switch"><Link href="/painel">Voltar aos meus eventos</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
