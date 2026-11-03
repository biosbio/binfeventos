import Link from "next/link";
import { safeNextPath } from "@/app/_lib/safe-next-path";
import BrandLogo from "@/app/_components/brand-logo";

export default async function RegistrationConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <span className="brand">
          <BrandLogo />
        </span>
        <div className="form-success" role="status">Conta criada com sucesso.</div>
        <h1>Já pode entrar</h1>
        <p>A sua conta está pronta. Entre com o email e a password que acabou de criar.</p>
        <div className="hero-actions">
          <Link className="button button-primary" href={`/login?next=${encodeURIComponent(nextPath)}`}>
            Fazer login
          </Link>
          <Link className="button button-secondary" href="/">
            Voltar à página inicial
          </Link>
        </div>
      </section>
    </main>
  );
}
