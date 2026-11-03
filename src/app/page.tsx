import Link from "next/link";
import { SiteHeader, SiteFooter } from "./_components/site-shell";
import { listPublicEvents } from "./_lib/public-queries";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  CONCERT: "Concerto",
  CONFERENCE: "Conferência",
  SPORT: "Desporto",
  THEATER: "Teatro",
  FESTIVAL: "Festival",
  WORKSHOP: "Workshop",
  OTHER: "Experiência",
};

function formatPrice(cents: number | null): string {
  if (cents === null) return "Gratuito";
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "AOA" }).format(cents / 100);
}

export default async function HomePage() {
  const events = await listPublicEvents();

  return (
    <>
      <SiteHeader />

      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">✦ BILHETICA DIGITAL SEGURA</span>
            <h1>Viva os grandes momentos, ao vivo.</h1>
            <p>
              Descubra concertos, conferências e experiências únicas. Reserve
              o seu lugar em segundos e receba o bilhete digital com QR Code
              diretamente no seu telemóvel.
            </p>
            <div className="hero-actions">
              <Link className="button button-lime" href="#eventos">
                Ver eventos
              </Link>
              <Link className="button button-secondary" href="/register">
                Criar conta grátis
              </Link>
              <Link className="button button-lime" href="/organizador">
                Organizar um evento
              </Link>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-card">
              <div className="art-card-inner">
                <span className="art-top">Bilhete digital</span>
                <span className="art-title">
                  Noite
                  <br />
                  BINF
                </span>
                <div className="art-bottom">
                  <span>30 NOV · 20H00</span>
                  <span>QR ✓</span>
                </div>
              </div>
            </div>
            <span className="art-spark">✦</span>
          </div>
        </div>
      </section>

      <section className="section" id="eventos">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">EM DESTAQUE</span>
              <h2>Eventos a acontecer</h2>
            </div>
            <p className="section-copy">
              Entradas oficiais, validadas na portaria com QR Code único e
              intransferível sem autorização.
            </p>
          </div>

          {events.length === 0 ? (
            <div className="empty-state">
              Ainda não há eventos publicados. Volte em breve — novos
              espetáculos chegam a qualquer momento.
            </div>
          ) : (
            <div className="event-grid">
              {events.map((e) => (
                <article key={e.id} className="event-card">
                  <div className="event-cover">
                    {e.coverImageUrl ? (
                      <img src={e.coverImageUrl} alt="" />
                    ) : null}
                    <span>{CATEGORY_LABELS[e.category] ?? "Evento"}</span>
                  </div>
                  <div className="event-content">
                    <div className="event-meta">
                      <span>
                        {new Intl.DateTimeFormat("pt-PT", {
                          dateStyle: "medium",
                          timeZone: "UTC",
                        }).format(e.startsAt)}
                      </span>
                      {e.city ? <span>{e.city}</span> : null}
                    </div>
                    <h3>{e.name}</h3>
                    <p>{e.description}</p>
                    <div className="event-card-bottom">
                      <div>
                        <div className="price-label">Desde</div>
                        <div className="price">{formatPrice(e.minPriceCents)}</div>
                      </div>
                      <Link className="text-link" href={`/eventos/${e.slug}`}>
                        Ver detalhes →
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="feature-band" id="como-funciona">
        <div className="container">
          <div className="feature-grid">
            <div className="feature">
              <div className="feature-icon">🎟</div>
              <h3>Compra em segundos</h3>
              <p>
                Reserve o seu lugar com validação automática de inventário —
                sem duplicações nem sobre-venda.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">📱</div>
              <h3>Bilhete digital com QR</h3>
              <p>
                Cada bilhete tem um QR Code único, validado na portaria com
                conferência de identidade quando exigida.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">🛡</div>
              <h3>Pagamento protegido</h3>
              <p>
                Valores calculados no servidor, pagamentos auditados e
                emissão apenas após confirmação real.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
