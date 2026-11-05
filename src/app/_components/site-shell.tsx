import Link from "next/link";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import LogoutButton from "./logout-button";
import BrandLogo from "./brand-logo";

export async function SiteHeader() {
  const auth = await getAuthContext();
  const isAdmin = auth?.platformRole === "PLATFORM_ADMIN";
  const canAccessOrganizerPanel = Boolean(auth && (isAdmin || auth.permissions.has("event:create")));
  const eventStaffRoles = auth?.organizationId
    ? await prisma.eventStaffMembership.findMany({
        where: {
          userId: auth.userId,
          approvedAt: { not: null },
          event: { organizationId: auth.organizationId, organization: { status: "ACTIVE" } },
        },
        select: { role: true },
        distinct: ["role"],
      })
    : [];
  const canAccessEventSales = eventStaffRoles.some((membership) => membership.role === "SELLER");
  const canAccessEventGate = eventStaffRoles.some((membership) => membership.role === "GATE");

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="BINF EVENTOS — início">
        <BrandLogo />
      </Link>
      <nav className="nav" aria-label="Navegação principal">
        <Link href="/#eventos">Eventos</Link>
        <Link href="/#como-funciona">Como funciona</Link>
        <Link href="/organizador">Para organizadores</Link>
      </nav>
      <div className="nav-actions">
        {auth ? (
          <>
            <Link className="button button-secondary" href="/minha-conta">A minha conta</Link>
            {auth.permissions.has("boxoffice:sell") || canAccessEventSales ? (
              <Link className="button button-secondary" href="/bilheteira">Bilheteira</Link>
            ) : null}
            {canAccessEventGate ? (
              <Link className="button button-secondary" href="/portaria">Portaria</Link>
            ) : null}
            {auth.permissions.has("org:invite") ? (
              <Link className="button button-secondary" href="/painel/vendedores">Vendedores</Link>
            ) : null}
            {canAccessOrganizerPanel ? (
              <Link className="button button-primary" href={isAdmin ? "/admin" : "/painel"}>
                {isAdmin ? "Abrir administração" : "Painel do organizador"}
              </Link>
            ) : null}
            <LogoutButton />
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
