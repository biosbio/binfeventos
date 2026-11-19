import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import EventCloseConfirmation from "./event-close-confirmation";

export const dynamic = "force-dynamic";

export default async function CloseEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, organization: { select: { name: true } } },
  });
  if (!event || event.status !== "PUBLISHED") notFound();

  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">ADMINISTRAÇÃO CENTRAL · CONFIRMAÇÃO</span>
          <h1>Encerrar evento</h1>
          <p>Está a encerrar “{event.name}” da organização {event.organization.name}. O evento passará para realizado e não poderá ser reaberto.</p>
        </div>
        <Link className="button button-secondary" href="/admin/events?estado=upcoming">Cancelar</Link>
      </div>
      <EventCloseConfirmation eventId={event.id} />
    </main>
  );
}
