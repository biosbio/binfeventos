import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="BINF EVENTOS — início">
        <span className="brand-mark">B</span>
        <span>BINF EVENTOS</span>
      </Link>
      <nav className="nav" aria-label="Navegação principal">
        <Link href="/#eventos">Eventos</Link>
        <Link href="/#como-funciona">Como funciona</Link>
        <Link href="/painel">Painel</Link>
        <Link href="/financas">Finanças</Link>
        <Link href="/portaria">Portaria</Link>
      </nav>
      <div className="nav-actions">
        <Link className="button button-secondary" href="/minha-conta">A minha conta</Link>
        <Link className="button button-primary" href="/login">Entrar</Link>
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
