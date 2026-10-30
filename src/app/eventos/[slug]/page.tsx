import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../_components/site-shell";
import { getPublicEventBySlug } from "../../_lib/public-queries";

export const dynamic = "force-dynamic";

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "AOA" }).format(cents / 100);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getPublicEventBySlug(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader />

      <section className="detail-hero">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">← Todos os eventos</Link>
          </div>
        </div>
      </section>

      <main className="container detail-layout">
        <div className="detail-main">
          <h1>{event.name}</h1>
          <p>{event.description}</p>

          <div className="detail-image">
            {event.coverImageUrl ? (
              <img src={event.coverImageUrl} alt="" />
            ) : (
              <span className="placeholder-title">{event.name}</span>
            )}
          </div>

          {event.entryRules ? (
            <div className="notice">
              <strong>Regras de entrada:</strong> {event.entryRules}
            </div>
          ) : null}
        </div>

        <aside className="panel" aria-label="Sessões e bilhetes">
          <h2>Sessões</h2>
          {event.sessions.length === 0 ? (
            <p className="form-help">Sem sessões futuras.</p>
          ) : (
            event.sessions.map((s) => (
              <div key={s.id} className="session-row">
                <strong>{formatDateTime(s.startsAt)}</strong>
                <span>{s.city ?? "Local a confirmar"}</span>
              </div>
            ))
          )}

          <h2 style={{ marginTop: 26 }}>Bilhetes</h2>
          {event.ticketTypes.length === 0 ? (
            <p className="form-help">Venda de bilhetes ainda não aberta.</p>
          ) : (
            event.ticketTypes.map((t) => (
              <div key={t.id} className="ticket-row">
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    {t.requiresIdentity
                      ? "Identificação obrigatória na entrada"
                      : "Sem exigência de identificação"}
                  </small>
                </div>
                <strong>{formatPrice(t.basePriceCents)}</strong>
              </div>
            ))
          )}

          <p className="notice" style={{ marginTop: 18 }}>
            A compra é feita na sua conta: reserve o lugar, identifique os
            titulares e pague com segurança. Os bilhetes são emitidos apenas
            após confirmação do pagamento.
          </p>
          <Link
            className="button button-primary"
            style={{ width: "100%", marginTop: 14 }}
            href="/login"
          >
            Entrar para comprar
          </Link>
        </aside>
      </main>

      <SiteFooter />
    </>
  );
}
