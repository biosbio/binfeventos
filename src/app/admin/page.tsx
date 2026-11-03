import Link from "next/link";
import { prisma } from "@/shared/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [users, organizations, events, pendingEvents] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.event.count(),
    prisma.event.count({ where: { status: "DRAFT" } }),
  ]);
  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading"><div><span className="section-kicker">BINF EVENTOS · ADMINISTRAÇÃO CENTRAL</span><h1>Painel administrativo</h1><p>Visão global da plataforma. A gestão de cada organização permanece isolada.</p></div><Link className="button button-secondary" href="/">Área pública</Link></div>
      <div className="dashboard-stats">
        <div className="panel"><div className="price-label">Utilizadores</div><div className="price">{users}</div></div>
        <div className="panel"><div className="price-label">Organizações</div><div className="price">{organizations}</div></div>
        <div className="panel"><div className="price-label">Eventos</div><div className="price">{events}</div></div>
        <div className="panel"><div className="price-label">Rascunhos</div><div className="price">{pendingEvents}</div></div>
      </div>
      <div className="admin-dashboard-actions"><Link className="button button-primary" href="/admin/users">Gerir utilizadores</Link><Link className="button button-secondary" href="/minha-conta/seguranca">Segurança da conta</Link></div>
    </main>
  );
}
