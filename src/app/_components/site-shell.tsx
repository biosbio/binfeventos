import Link from "next/link";
import { getAuthContext } from "@/shared/auth";

export async function SiteHeader() {
  const auth = await getAuthContext();
  const isAdmin = Boolean(auth?.permissions.has("admin:platform") || auth?.permissions.has("org:manage"));

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="BINF EVENTOS — início">
        <span className="brand-mark">B</span>
        <span>BINF EVENTOS</span>
      </Link>
      <nav className="nav" aria-label="Navegação principal">
        <Link href="/#eventos">Eventos</Link>
        <Link href="/#como-funciona">Como funciona</Link>
        <Link href="/organizador">Para organizadores</Link>
        {auth ? <Link href="/painel">{isAdmin ? "Administração" : "Meu painel"}</Link> : null}
      </nav>
      <div className="nav-actions">
        {auth ? (
          <>
            <Link className="button button-secondary" href="/minha-conta">A minha conta</Link>
            <Link className="button button-primary" href="/painel">Abrir painel</Link>
          </>
        ) : (
          <>
            <Link className="button button-secondary" href="/register">Criar conta</Link>
            <Link className="button button-primary" href="/login">Entrar</Link>
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span>© {new Date().getFullYear()} BINF EVENTOS</span>
        <span>Eventos que aproximam pessoas.</span>
      </div>
    </footer>
  );
}
