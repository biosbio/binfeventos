import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { getBoxOfficeSellerInvite } from "@/modules/organizations/service";
import { NotFoundError } from "@/shared/errors";
import { SiteFooter, SiteHeader } from "../../../_components/site-shell";
import SellerInviteClaim from "./seller-invite-claim";

export const dynamic = "force-dynamic";

export default async function SellerInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let invite;
  try {
    invite = await getBoxOfficeSellerInvite(token);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const auth = await getAuthContext();
  const nextPath = `/vendedor/convite/${token}`;

  return (
    <>
      <SiteHeader />
      <main className="container seller-invite-page">
        <section className="panel seller-invite-card">
          <span className="section-kicker">CONVITE PARA A EQUIPA</span>
          <h1>Vender bilhetes para {invite.organizationName}</h1>
          <p>Crie uma conta ou entre na sua conta para pedir acesso como vendedor. O organizador terá de aprovar o pedido antes de poder usar a bilheteira.</p>
          {auth ? (
            <SellerInviteClaim token={token} />
          ) : (
            <div className="hero-actions">
              <Link className="button button-primary" href={`/register?next=${encodeURIComponent(nextPath)}`}>Criar conta e pedir acesso</Link>
              <Link className="button button-secondary" href={`/login?next=${encodeURIComponent(nextPath)}`}>Já tenho conta</Link>
            </div>
          )}
          <p className="form-help">Este link expira em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(invite.expiresAt)}.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
