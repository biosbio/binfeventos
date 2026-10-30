import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteHeader, SiteFooter } from "../_components/site-shell";

export const dynamic = "force-dynamic";

// ============================================================
// Painel do organizador — Server Component com agregações
// mínimas server-side (nada de dados de titulares/pagamentos
// sensíveis; apenas contadores e somas).
// ============================================================

export default async function OrganizerPanelPage() {
  let ctx;
  try {
    ctx = await requireAuth();
    if (!ctx.permissions.has("event:read") || !ctx.organizationId) {
      redirect("/login");
    }
  } catch {
    redirect("/login");
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
    prisma.fraudAlert.count({
      where: { organizationId: orgId, status: "OPEN" },
    }),
  ]);

  const currency = "AOA";
  const fmt = (cents: number) =>
    new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "45px 0 70px" }}>
        <span className="section-kicker">PAINEL DO ORGANIZADOR</span>
        <h1 style={{ margin: "9px 0 26px", fontSize: "clamp(32px,4vw,46px)", letterSpacing: "-.05em" }}>
          Visão geral
        </h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 18 }}>
          <div className="panel">
            <div className="price-label">Vendas confirmadas (24h)</div>
            <div className="price">{fmt(todaySales._sum.totalCents ?? 0)}</div>
            <div className="form-help">{todaySales._count} encomendas</div>
          </div>
          <div className="panel">
            <div className="price-label">Pagamentos a analisar</div>
            <div className="price">{pendingPayments}</div>
            <div className="form-help">Opção C — exigem evidência</div>
          </div>
          <div className="panel">
            <div className="price-label">Alertas de fraude abertos</div>
            <div className="price">{openAlerts}</div>
            <div className="form-help">Regras explicáveis</div>
          </div>
          <div className="panel">
            <div className="price-label">Eventos</div>
            <div className="price">{events.length}</div>
            <div className="form-help">Na sua organização</div>
          </div>
        </div>

        <h2 style={{ margin: "34px 0 14px", fontSize: 24, letterSpacing: "-.04em" }}>Os seus eventos</h2>
        {events.length === 0 ? (
          <div className="empty-state">
            Sem eventos. Crie o primeiro evento via API (`POST /api/events/create`).
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {events.map((e) => (
              <article key={e.id} className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{e.name}</strong>
                  <div className="form-help" style={{ marginTop: 3 }}>
                    {e.sessions[0]
                      ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(e.sessions[0].startsAt)
                      : "Sem sessões"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: e.status === "PUBLISHED" ? "var(--green)" : "var(--muted)" }}>
                    {e.status}
                  </span>
                  {e.status === "PUBLISHED" ? (
                    <Link className="text-link" href={`/eventos/${e.slug}`}>
                      Ver no site →
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}