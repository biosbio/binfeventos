import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import { getMyContext, listMyOrders } from "../_lib/my-queries";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  RESERVED: "Reservada",
  PENDING_PAYMENT: "Pagamento pendente",
  UNDER_REVIEW: "Em análise",
  CONFIRMED: "Confirmada",
  PARTIALLY_REFUNDED: "Parcialmente reembolsada",
  REFUNDED: "Reembolsada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
  DISPUTED: "Em disputa",
};

const TICKET_LABELS: Record<string, string> = {
  ISSUED: "Válido",
  USED: "Utilizado",
  TRANSFERRED: "Transferido",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
  REVOKED: "Revogado",
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

export default async function MyAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { aviso } = await searchParams;
  let user;
  let orders;
  let isAdmin = false;
  try {
    const context = await getMyContext();
    user = context.user;
    isAdmin = context.ctx.platformRole === "PLATFORM_ADMIN";
    orders = await listMyOrders(context.ctx.userId);
  } catch {
    redirect("/login");
  }

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "45px 0 70px" }}>
        <span className="section-kicker">A MINHA CONTA</span>
        <h1 style={{ margin: "9px 0 6px", fontSize: "clamp(34px,4vw,48px)", letterSpacing: "-.05em" }}>
          Olá, {user.fullName.split(" ")[0]}
        </h1>
        <p className="section-copy" style={{ maxWidth: "none" }}>
          As suas encomendas e bilhetes digitais.
        </p>

        {!isAdmin ? (
          <div className="panel" role="status" style={{ marginTop: 22 }}>
            <strong>{aviso === "criar-evento" ? "Ainda não tem uma organização? Pode começar por aqui." : "Também pode organizar eventos com esta conta."}</strong>
            <p className="form-help">Crie o perfil da sua organização e submeta uma proposta. O evento só fica público após aprovação da equipa BINF EVENTOS.</p>
            <Link className="button button-primary" href="/painel/eventos/novo">Propor um evento</Link>
          </div>
        ) : null}

        {orders.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 30 }}>
            Ainda não tem encomendas.{" "}
            <Link className="text-link" href="/#eventos">
              Explorar eventos →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20, marginTop: 32 }}>
            {orders.map((order) => (
              <article key={order.id} className="panel">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: 17 }}>{order.orderNumber}</strong>
                    <div className="form-help" style={{ marginTop: 3 }}>
                      {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" }).format(order.createdAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--green)" }}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                    <div style={{ fontWeight: 900, marginTop: 3 }}>
                      {formatPrice(order.totalCents, order.currency)}
                    </div>
                  </div>
                </div>

                {order.tickets.length > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    {order.tickets.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 14,
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "12px 0",
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 14 }}>{t.orderAttendee?.fullName}</strong>
                          <div className="form-help" style={{ marginTop: 3 }}>
                            {t.ticketNumber} · {TICKET_LABELS[t.status] ?? t.status}
                          </div>
                        </div>
                        {t.status === "ISSUED" ? (
                          <Link className="text-link" href={`/bilhetes/${t.id}`}>
                            Ver bilhete e QR →
                          </Link>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="form-help" style={{ marginTop: 12 }}>
                    {order.status === "PENDING_PAYMENT"
                      ? "Bilhetes são emitidos após confirmação do pagamento."
                      : "Sem bilhetes emitidos nesta encomenda."}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
