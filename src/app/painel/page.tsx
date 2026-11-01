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

  if (!ctx.permissions.has("event:read") || !ctx.organizationId) {
    redirect("/organizador");
  }

  const orgId = ctx.organizationId;
  const [events, pendingPayments, todaySales, openAlerts] = await Promise.all([
    prisma.event.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, slug: true, status: true, publishedAt: true,
        sessions: { select: { startsAt: true }, orderBy: { startsAt: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.payment.count({
      where: { organizationId: orgId, status: { in: ["UNDER_REVIEW", "AWAITING_AUTHORIZATION"] } },
    }),
    prisma.order.aggregate({
      where: {
        organizationId: orgId,
        status: "CONFIRMED",
        confirmedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.fraudAlert.count({ where: { organizationId: orgId, status: "OPEN" } }),
  ]);

  const currency = "XOF";
  const fmt = (cents: number) =>
    new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);

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
          <Link className="button button-primary" href="/painel/eventos/novo">＋ Criar evento</Link>
        </div>

        <div className="dashboard-stats">
          <div className="panel"><div className="price-label">Vendas confirmadas (24h)</div><div className="price">{fmt(todaySales._sum.totalCents ?? 0)}</div><div className="form-help">{todaySales._count} encomendas</div></div>
          <div className="panel"><div className="price-label">Pagamentos a analisar</div><div className="price">{pendingPayments}</div><div className="form-help">Exigem análise</div></div>
          <div className="panel"><div className="price-label">Alertas abertos</div><div className="price">{openAlerts}</div><div className="form-help">Segurança e antifraude</div></div>
          <div className="panel"><div className="price-label">Eventos</div><div className="price">{events.length}</div><div className="form-help">Na sua organização</div></div>
        </div>

        <div className="dashboard-list-heading">
          <h2>Os seus eventos</h2>
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
                  <div className="form-help">{event.sessions[0] ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(event.sessions[0].startsAt) : "Sessão ainda não definida"}</div>
                </div>
                <span className={`status-pill status-${event.status.toLowerCase()}`}>{event.status}</span>
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
