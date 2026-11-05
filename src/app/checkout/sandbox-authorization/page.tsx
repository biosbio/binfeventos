import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "@/app/_components/site-shell";
import SandboxAuthorization from "./sandbox-authorization";

export const dynamic = "force-dynamic";

export default async function SandboxAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { ref } = await searchParams;
  if (!ref || !/^sbx_[A-Za-z0-9_-]{20,150}$/.test(ref)) notFound();
  const auth = await getAuthContext();
  if (!auth) redirect(`/login?next=${encodeURIComponent(`/checkout/sandbox-authorization?ref=${ref}`)}`);

  return (
    <>
      <SiteHeader />
      <main className="container checkout-page">
        <span className="section-kicker">PAGAMENTO SANDBOX</span>
        <h1>Prestador de teste</h1>
        <SandboxAuthorization providerRef={ref} />
      </main>
      <SiteFooter />
    </>
  );
}
