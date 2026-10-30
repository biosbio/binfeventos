import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteHeader, SiteFooter } from "../_components/site-shell";

export const dynamic = "force-dynamic";

// ============================================================
// Painel financeiro (FINANCE_MANAGER) — Server Component.
// Agregados mínimos server-side; sem dados sensíveis de
// titulares/pagamentos individuais. Ações (preparar/aprovar
// liquidações, ajustes) ficam na página cliente dedicada.
// ============================================================

const TYPE_LABELS: Record<string, string> = {
  SALES: "Vendas",
  SERVICE_FEE: "Taxa de serviço",
  COMMISSION: "Comissão",
  REFUND: "Reembolso",
  CHARGEBACK: "Contestação",
  SETTLEMENT: "Liquidação",
  RESERVE: "Reserva constituída",
  RESERVE_RELEASE: "Reserva libertada",
  ADJUSTMENT: "Ajuste compensatório",
  CASH_DIFFERENCE: "Diferença de caixa",
  PAYOUT: "Repasse",
  MANUAL_ADJUSTMENT: "Ajuste manual",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovada",
  PAID: "Paga",
  CANCELLED: "Cancelada",
};

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

export default async function FinancePanelPage() {
  let ctx;
  try {
    ctx = await requireAuth();
    if (!ctx.organizationId || !ctx.permissions.has("ledger:read")) {
      redirect("/login");
    }
  } catch {
    redirect("/login");
  }

  const orgId = ctx.organizationId;
  const currency = (
    await prisma.organization.findUnique({ where: { id: orgId }, select: { currency: true } })
  )?.currency ?? "AOA";

  // KPIs agregados (server-side, sem dados sensíveis)
  const [sales30d, refundsOpen, pendingSettlements, reservesActive, ledger, settlements] =
    await Promise.all([
      prisma.order.aggregate({
        where: {
          organizationId: orgId,
          status: "CONFIRMED",
          confirmedAt: { gte: new Date(Date.now() - 30 * 86400_000) },
        },
        _sum: { totalCents: true },
      }),
      prisma.refund.count({
        where: { organizationId: orgId, status: { in: ["REQUESTED", "UNDER_ANALYSIS"] } },
      }),
      prisma.settlement.count({
        where: { organizationId: orgId, status: "PENDING" },
      }),
      prisma.financialReserve.aggregate({
        where: { organizationId: orgId, status: { in: ["ACTIVE", "PARTIALLY_RELEASED"] } },
        _sum: { amountCents: true },
      }),
      prisma.financialLedgerEntry.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true, type: true, amountCents: true, currency: true,
          description: true, compensatesEntryId: true, createdAt: true,
        },
      }),
      prisma.settlement.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true, periodStart: true, periodEnd: true,
          grossCents: true, payableCents: true, status: true, createdAt: true,
        },
      }),
    ]);

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "45px 0 70px" }}>
        <span className="section-kicker">FINANÇAS</span>
        <h1 style={{ margin: "9px 0 26px", fontSize: "clamp(32px,4vw,46px)", letterSpacing: "-.05em" }}>
          Liquidações e livro-razão
        </h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 18 }}>
          <div className="panel">
            <div className="price-label">Vendas confirmadas (30 dias)</div>
            <div className="price">{fmt(sales30d._sum.totalCents ?? 0, currency)}</div>
          </div>
          <div className="panel">
            <div className="price-label">Reembolsos a analisar</div>
            <div className="price">{refundsOpen}</div>
            <div className="form-help">Segregação solicitante/aprovador</div>
          </div>
          <div className="panel">
            <div className="price-label">Liquidações pendentes</div>
            <div className="price">{pendingSettlements}</div>
            <div className="form-help">Dupla aprovação obrigatória</div>
          </div>
          <div className="panel">
            <div className="price-label">Reservas ativas</div>
            <div className="price">{fmt(reservesActive._sum.amountCents ?? 0, currency)}</div>
            <div className="form-help">Baseadas no risco</div>
          </div>
        </div>

        {ctx.permissions.has("settlement:prepare") || ctx.permissions.has("settlement:approve") ? (
          <p style={{ margin: "26px 0 0" }}>
            <Link className="button button-primary" href="/financas/acoes">
              Ações financeiras (preparar/aprovar liquidações)
            </Link>
          </p>
        ) : null}

        <h2 style={{ margin: "34px 0 14px", fontSize: 24, letterSpacing: "-.04em" }}>Liquidações recentes</h2>
        {settlements.length === 0 ? (
          <div className="empty-state">Ainda sem liquidações neste período.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {settlements.map((s) => (
              <article key={s.id} className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                <div>
                  <strong style={{ fontSize: 15 }}>
                    {new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" }).format(s.periodStart)} →{" "}
                    {new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" }).format(s.periodEnd)}
                  </strong>
                  <div className="form-help" style={{ marginTop: 3 }}>
                    Bruto {fmt(s.grossCents, currency)} · A liquidar {fmt(s.payableCents, currency)}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: s.status === "PAID" ? "var(--green)" : "var(--muted)" }}>
                  {STATUS_LABELS[s.status] ?? s.status}
                </span>
              </article>
            ))}
          </div>
        )}

        <h2 style={{ margin: "34px 0 14px", fontSize: 24, letterSpacing: "-.04em" }}>Livro-razão (últimos 30 lançamentos)</h2>
        <div className="panel" style={{ padding: 0 }}>
          {ledger.length === 0 ? (
            <p className="form-help" style={{ padding: 20 }}>Sem lançamentos registados.</p>
          ) : (
            ledger.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "flex", flexWrap: "wrap", gap: 10,
                  justifyContent: "space-between", alignItems: "center",
                  padding: "12px 20px", borderTop: "1px solid var(--line)",
                }}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>{TYPE_LABELS[e.type] ?? e.type}</strong>
                  <div className="form-help" style={{ marginTop: 3 }}>
                    {e.description}
                    {e.compensatesEntryId ? " · compensatório" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong style={{ color: e.amountCents >= 0 ? "var(--green)" : "#8c281b" }}>
                    {e.amountCents >= 0 ? "+" : ""}{fmt(e.amountCents, e.currency)}
                  </strong>
                  <div className="form-help" style={{ marginTop: 3 }}>
                    {new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(e.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <p className="form-help" style={{ marginTop: 10 }}>
          O livro-razão é imutável: correções são lançamentos compensatórios, nunca edições.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
