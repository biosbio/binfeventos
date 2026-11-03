import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../_components/site-shell";
import { getPublicEventBySlug } from "../../_lib/public-queries";
import { getAuthContext } from "@/shared/auth";

export const dynamic = "force-dynamic";

const TICKET_CATEGORY_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  VIP: "VIP",
  PREMIUM: "Premium",
  STUDENT: "Estudante",
  CHILD: "Criança",
  FREE: "Gratuito",
  INVITE: "Convite",
  SPECIAL_ACCESS: "Acesso especial",
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [event, auth] = await Promise.all([
    getPublicEventBySlug(slug),
    getAuthContext(),
  ]);
  if (!event) notFound();

  const firstSession = event.sessions[0];
  const lastSession = firstSession
    ? event.sessions.reduce(
        (last, session) => session.endsAt > last.endsAt ? session : last,
        firstSession,
      )
    : undefined;
  const spansMultipleDays = Boolean(
    firstSession &&
    lastSession &&
    firstSession.startsAt.toISOString().slice(0, 10) !== lastSession.endsAt.toISOString().slice(0, 10),
  );
  const availableSession = event.sessions.find((session) => session.ticketsAvailable);

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

        <aside className="panel" aria-label="Data e bilhetes">
          <h2>Data do evento</h2>
          {!firstSession ? (
            <p className="form-help">Sem data futura definida.</p>
          ) : (
            <div className="session-row">
              {event.sessions.length > 1 ? (
                <>
                  <strong>Data do evento a confirmar</strong>
                  <span className="form-help">
                    O organizador deve atualizar a duração do evento no painel.
                  </span>
                </>
              ) : (
                <strong>{formatDateTime(firstSession.startsAt)}</strong>
              )}
              {event.sessions.length === 1 && lastSession && spansMultipleDays ? (
                <span>Até {formatDateTime(lastSession.endsAt)}</span>
              ) : null}
              {event.sessions.length === 1 && firstSession.city ? (
                <span>{firstSession.city}</span>
              ) : event.sessions.length === 1 ? (
                <span>Local a confirmar</span>
              ) : null}
            </div>
          )}

          <h2 style={{ marginTop: 26 }}>Bilhetes</h2>
          {event.ticketTypes.length === 0 ? (
            <p className="form-help">Venda de bilhetes ainda não aberta.</p>
          ) : (
            event.ticketTypes.map((t) => (
              <div key={t.id} className="ticket-row">
                <div>
                  <strong>{t.name}</strong>
                  <small>{TICKET_CATEGORY_LABELS[t.category] ?? t.category}</small>
                  {t.description ? <small>{t.description}</small> : null}
                  <small>
                    {t.requiresIdentity
                      ? "Identificação obrigatória na entrada"
                      : "Sem exigência de identificação"}
                  </small>
                </div>
                <strong>{formatPrice(t.basePriceCents, t.currency)}</strong>
              </div>
            ))
          )}

          <p className="notice" style={{ marginTop: 18 }}>
            A compra é feita na sua conta: reserve o lugar, identifique os
            titulares e pague com segurança. Os bilhetes são emitidos apenas
            após confirmação do pagamento. O preço final do lote aparece antes
            da reserva.
          </p>
          {availableSession ? (
            <div style={{ marginTop: 14 }}>
              <Link
                className="button button-primary"
                style={{ width: "100%" }}
                href={auth
                  ? `/checkout?eventId=${encodeURIComponent(event.id)}&sessionId=${encodeURIComponent(availableSession.id)}`
                  : `/login?next=${encodeURIComponent(`/checkout?eventId=${encodeURIComponent(event.id)}&sessionId=${encodeURIComponent(availableSession.id)}`)}`}
              >
                {auth ? "Comprar bilhetes" : "Entrar para comprar"}
              </Link>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <button
                className="button button-primary"
                style={{ width: "100%" }}
                type="button"
                disabled
              >
                Bilhetes indisponíveis
              </button>
              <p className="form-help" style={{ marginTop: 8 }} role="status">
                {!firstSession
                  ? "Este evento não tem uma data futura."
                  : event.ticketTypes.length === 0
                    ? "O organizador ainda não configurou os tipos de bilhete."
                    : event.sessions.every((session) => !session.hasOpenInventory)
                      ? "O organizador precisa definir a quantidade dos bilhetes no painel."
                      : "As vendas foram encerradas ou os bilhetes esgotaram."}
              </p>
            </div>
          )}
        </aside>
      </main>

      <SiteFooter />
    </>
  );
}
