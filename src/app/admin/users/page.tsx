import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import AdminUsersTable, { type AdminUserRow } from "./users-table";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; status?: string };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login?next=%2Fadmin%2Fusers");
  if (auth.platformRole !== "PLATFORM_ADMIN") redirect("/painel");
  if (!auth.panelVerifiedUntil || auth.panelVerifiedUntil.getTime() <= Date.now()) {
    redirect("/acesso-painel?next=%2Fadmin%2Fusers");
  }

  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const status = ["ACTIVE", "SUSPENDED", "CLOSED"].includes(params.status ?? "")
    ? params.status as "ACTIVE" | "SUSPENDED" | "CLOSED"
    : undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { fullName: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        platformRole: true,
        createdAt: true,
        memberships: {
          select: {
            id: true,
            acceptedAt: true,
            organization: { select: { name: true } },
            role: { select: { name: true } },
          },
          orderBy: { invitedAt: "asc" },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const rows: AdminUserRow[] = users.map((user) => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    platformRole: user.platformRole,
    createdAt: user.createdAt.toISOString(),
    memberships: user.memberships.map((membership) => ({
      id: membership.id,
      organization: membership.organization.name,
      role: membership.role.name,
      acceptedAt: membership.acceptedAt?.toISOString() ?? null,
    })),
  }));

  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">BINF EVENTOS · ADMINISTRAÇÃO CENTRAL</span>
          <h1>Gestão de utilizadores</h1>
          <p>Administre contas, veja pedidos de vendedores e controle os acessos de bilheteira em todas as organizações.</p>
        </div>
        <Link className="button button-secondary" href="/admin">Voltar ao painel</Link>
      </div>

      <form className="admin-user-filters" method="get">
        <label className="form-field">
          <span>Pesquisar</span>
          <input name="q" defaultValue={query} placeholder="Nome, email ou telefone" maxLength={120} />
        </label>
        <label className="form-field">
          <span>Estado</span>
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="SUSPENDED">Suspensos</option>
            <option value="CLOSED">Encerrados</option>
          </select>
        </label>
        <button className="button button-primary" type="submit">Filtrar</button>
        <Link className="button button-secondary" href="/admin/users">Limpar</Link>
      </form>

      <div className="dashboard-list-heading">
        <h2>Contas registadas</h2>
        <span>{total} resultado(s){total > 100 ? " · a mostrar os 100 mais recentes" : ""}</span>
      </div>
      <AdminUsersTable users={rows} />
    </main>
  );
}
