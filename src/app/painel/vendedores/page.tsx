import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "../../_components/site-shell";
import SellerManager from "./seller-manager";

export const dynamic = "force-dynamic";

export default async function SellersPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login?next=%2Fpainel%2Fvendedores");
  if (!auth.organizationId || !auth.permissions.has("org:invite")) redirect("/painel");
  const [organization, sellers, invites] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.organizationId },
      select: { name: true },
    }),
    prisma.orgMembership.findMany({
      where: {
        organizationId: auth.organizationId,
        role: { name: "BOX_OFFICE_OPERATOR", isSystem: true },
      },
      select: {
        id: true,
        invitedAt: true,
        acceptedAt: true,
        user: { select: { fullName: true, email: true, status: true } },
      },
      orderBy: { invitedAt: "desc" },
    }),
    prisma.boxOfficeSellerInvite.findMany({
      where: {
        organizationId: auth.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!organization) redirect("/painel");

  return (
    <>
      <SiteHeader />
      <main className="container dashboard-page">
        <div className="dashboard-heading">
          <div>
            <span className="section-kicker">EQUIPA · {organization.name}</span>
            <h1>Vendedores</h1>
            <p>Crie um link de inscrição. As pessoas registam-se e pedem acesso; só passam a vender depois da sua aprovação.</p>
          </div>
        </div>
        <SellerManager sellers={sellers} activeInvites={invites} />
      </main>
      <SiteFooter />
    </>
  );
}
