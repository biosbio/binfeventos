import Link from "next/link";
import { SiteHeader, SiteFooter } from "../_components/site-shell";

export default function OrganizerLandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="organizer-landing">
        <section className="organizer-hero">
          <div className="container organizer-hero-grid">
            <div>
              <span className="eyebrow">BINF EVENTOS · ORGANIZADORES</span>
              <h1>O seu evento merece chegar mais longe.</h1>
              <p>Crie a sua conta, prepare a proposta do evento e acompanhe o processo de análise para publicação na plataforma.</p>
              <div className="hero-actions">
                <Link className="button button-lime" href="/register">Criar conta</Link>
                <Link className="button button-secondary" href="/login">Já tenho conta</Link>
              </div>
            </div>
            <div className="organizer-journey-card">
              <span>COMO FUNCIONA</span>
              <ol>
                <li><strong>Registe-se</strong><small>Crie a sua conta pessoal.</small></li>
                <li><strong>Prepare o evento</strong><small>Preencha as informações e os detalhes.</small></li>
                <li><strong>Aguarde a análise</strong><small>A administração verifica a proposta.</small></li>
                <li><strong>Publique e acompanhe</strong><small>Após aprovação, avance com a configuração e divulgação.</small></li>
              </ol>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container organizer-benefits">
            <div><span className="section-kicker">PARA QUEM ORGANIZA</span><h2>Mais controlo em cada etapa.</h2></div>
            <p>O organizador deverá ter acesso apenas aos seus eventos, participantes e operações autorizadas. A aprovação administrativa é uma etapa separada da gestão do evento.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
