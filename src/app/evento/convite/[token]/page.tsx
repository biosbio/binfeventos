import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { getEventStaffInvite } from "@/modules/event-staff/service";
import { NotFoundError } from "@/shared/errors";
import { SiteFooter, SiteHeader } from "../../../_components/site-shell";
import EventStaffInviteClaim from "./event-staff-invite-claim";

export const dynamic = "force-dynamic";

export default async function EventStaffInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let invite;
  try {
    invite = await getEventStaffInvite(token);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const auth = await getAuthContext();
  const nextPath = `/evento/convite/${token}`;
  const roleName = invite.role === "ORGANIZER"
    ? "co-organizador(a)"
    : invite.role === "SELLER" ? "vendedor(a)" : "membro da portaria";
  const assignment = invite.role === "ORGANIZER"
    ? "gerir este evento, incluindo vendas e validação de entradas"
    : invite.role === "SELLER"
      ? "registar vendas presenciais e receber pagamentos pelos meios disponíveis"
      : "validar entradas deste evento. Este convite não dá acesso às vendas";

  return (
    <>
      <SiteHeader />
      <main className="container seller-invite-page">
        <section className="panel seller-invite-card">
          <span className="section-kicker">CONVITE PARA A EQUIPA DO EVENTO</span>
          <h1>Participar em {invite.eventName}</h1>
          <p>
            Foi convidado(a) como {roleName} para {assignment}. O acesso fica limitado
            a este evento e só será ativado depois da aprovação do organizador principal.
          </p>
          {auth ? (
            <EventStaffInviteClaim token={token} />
          ) : (
            <div className="hero-actions">
              <Link className="button button-primary" href={`/register?next=${encodeURIComponent(nextPath)}`}>Criar conta e pedir acesso</Link>
              <Link className="button button-secondary" href={`/login?next=${encodeURIComponent(nextPath)}`}>Já tenho conta</Link>
            </div>
          )}
          <p className="form-help">
            Este convite expira em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(invite.expiresAt)}.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
