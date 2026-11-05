import Link from "next/link";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import { getAuthContext } from "@/shared/auth";

export default async function OrganizerLandingPage() {
  const auth = await getAuthContext();
  const isAdmin = auth?.platformRole === "PLATFORM_ADMIN";
  const canInviteSellers = Boolean(auth?.organizationId && auth.permissions.has("org:invite"));
  const destination = isAdmin ? "/admin/events/new" : "/painel/eventos/novo";
  const next = encodeURIComponent("/painel/eventos/novo");
  const primaryHref = auth ? destination : `/register?next=${next}`;
  const secondaryHref = auth ? (isAdmin ? "/admin" : "/painel") : `/login?next=${next}`;

  return (
    <>
      <SiteHeader />
      <main className="organizer-landing">
        <section className="organizer-hero">
          <div className="container organizer-hero-grid">
            <div>
              <span className="eyebrow">BINF EVENTOS · ORGANIZADORES</span>
              <h1>O seu evento merece chegar mais longe.</h1>
              <p>{isAdmin
                ? "Crie um evento da organização central BINF EVENTOS e acompanhe a proposta até à publicação."
                : "Crie a sua conta, prepare a proposta do evento e acompanhe o processo de análise para publicação na plataforma."}</p>
              <div className="hero-actions">
                <Link className="button button-lime" href={primaryHref}>
                  {isAdmin ? "Criar evento" : auth ? "Propor um evento" : "Criar conta"}
                </Link>
                <Link className="button button-secondary" href={secondaryHref}>
                  {auth ? (isAdmin ? "Voltar à administração" : "Abrir painel") : "Já tenho conta"}
                </Link>
                {canInviteSellers ? (
                  <Link className="button button-secondary" href="/painel/vendedores">
                    Convidar vendedores
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="organizer-journey-card">
              <span>COMO FUNCIONA</span>
              {isAdmin ? (
                <ol>
                  <li><strong>Crie o evento</strong><small>O evento ficará associado à organização central.</small></li>
                  <li><strong>Adicione a sessão</strong><small>A primeira sessão é incluída na criação.</small></li>
                  <li><strong>Revise a proposta</strong><small>O evento permanece em rascunho até à aprovação.</small></li>
                  <li><strong>Publique</strong><small>Depois de aprovado, ficará visível ao público.</small></li>
                </ol>
              ) : (
                <ol>
                  <li><strong>Registe-se</strong><small>Crie a sua conta pessoal.</small></li>
                  <li><strong>Prepare o evento</strong><small>Preencha as informações e os detalhes.</small></li>
                  <li><strong>Aguarde a análise</strong><small>A administração verifica a proposta.</small></li>
                  <li><strong>Publique e acompanhe</strong><small>Após aprovação, avance com a configuração e divulgação.</small></li>
                </ol>
              )}
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
