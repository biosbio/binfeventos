import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/shared/auth";
import { SiteHeader, SiteFooter } from "../../_components/site-shell";
import ChangePasswordForm from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    redirect("/login?next=%2Fminha-conta%2Fseguranca");
  }

  return (
    <>
      <SiteHeader />
      <main className="container account-security-page">
        <span className="section-kicker">A MINHA CONTA · SEGURANÇA</span>
        <h1>Segurança da conta</h1>
        <p className="section-copy">Altere a sua password. Por segurança, todas as sessões serão terminadas após a atualização.</p>
        <ChangePasswordForm isAdmin={auth.platformRole === "PLATFORM_ADMIN"} />
        <p className="auth-switch"><Link href="/minha-conta">Voltar à minha conta</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
