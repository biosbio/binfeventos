import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteHeader, SiteFooter } from "../_components/site-shell";

export const dynamic = "force-dynamic";

export default async function OrganizerPanelPage() {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch {
    redirect("/login?next=%2Fpainel");
  }

  if (ctx.platformRole === "PLATFORM_ADMIN") redirect("/admin");

  if (!ctx.organizationId) {
    redirect("/organizador");
  }

  const orgId = ctx.organizationId;
  const events = await prisma.event.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { responsibleUserId: ctx.userId },
          { staffMembers: { some: { userId: ctx.userId, role: "ORGANIZER", approvedAt: { not: null } } } },
        ],
      },
      select: {
        id: true, name: true, slug: true, status: true, publishedAt: true,
        sessions: { select: { startsAt: true }, orderBy: { startsAt: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
  const pendingApproval = events.filter((event) => event.status === "DRAFT").length;
  const publishedEvents = events.filter((event) => event.status === "PUBLISHED").length;
  const otherEvents = events.length - pendingApproval - publishedEvents;

  return (
    <>
      <SiteHeader />
      <main className="container dashboard-page">
        <div className="dashboard-heading">
          <div>
            <span className="section-kicker">ÁREA DE ORGANIZAÇÃO</span>
            <h1>O seu painel</h1>
            <p>Acompanhe os seus eventos, atividade e operações num só lugar.</p>
          </div>
          <div className="dashboard-heading-actions">
            {ctx.permissions.has("venue:manage") ? <Link className="button" href="/painel/bilheteira">Postos de bilheteira</Link> : null}
            {ctx.permissions.has("event:create") ? <Link className="button button-primary" href="/painel/eventos/novo">＋ Criar evento</Link> : null}
          </div>
        </div>

        <div className="dashboard-stats">
          <div className="panel"><div className="price-label">Eventos com acesso</div><div className="price">{events.length}</div><div className="form-help">Eventos sob a sua gestão</div></div>
          <div className="panel"><div className="price-label">Em análise</div><div className="price">{pendingApproval}</div><div className="form-help">Aguardam aprovação</div></div>
          <div className="panel"><div className="price-label">Visíveis ao público</div><div className="price">{publishedEvents}</div><div className="form-help">Aprovados pela equipa</div></div>
          <div className="panel"><div className="price-label">Outros estados</div><div className="price">{otherEvents}</div><div className="form-help">Cancelados ou suspensos</div></div>
        </div>

        <div className="dashboard-list-heading">
            <h2>Eventos a que tem acesso</h2>
          <span>{events.length} registo(s)</span>
        </div>
        {events.length === 0 ? (
          <div className="empty-state">Ainda não tem eventos. Crie o primeiro e acompanhe aqui o processo de análise e aprovação.</div>
        ) : (
          <div className="dashboard-event-list">
            {events.map((event) => (
              <article key={event.id} className="panel dashboard-event">
                <div>
                  <strong>{event.name}</strong>
                  <div className="form-help">{event.sessions[0] ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeZone: "UTC" }).format(event.sessions[0].startsAt) : "Sessão ainda não definida"}</div>
                </div>
                <Link className="text-link" href={`/painel/eventos/${event.id}/comissao`}>Comissão →</Link>
                <Link className="text-link" href={`/painel/eventos/${event.id}`}>Gerir evento →</Link>
                {event.status === "PUBLISHED" ? <Link className="text-link" href={`/eventos/${event.slug}`}>Ver evento →</Link> : null}
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
