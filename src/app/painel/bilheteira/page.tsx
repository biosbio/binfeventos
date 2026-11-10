import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "../../_components/site-shell";
import StationManager from "./station-manager";

export const dynamic = "force-dynamic";

export default async function BoxOfficeStationsPage() {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    redirect("/login?next=%2Fpainel%2Fbilheteira");
  }
  if (!auth.organizationId) redirect("/organizador");
  if (!auth.permissions.has("venue:manage")) redirect("/painel");

  const [events, stations] = await Promise.all([
    prisma.event.findMany({
      where: { organizationId: auth.organizationId },
      select: { id: true, name: true, sessions: { select: { id: true, venueId: true, venue: { select: { name: true, city: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.boxOfficeStation.findMany({
      where: { organizationId: auth.organizationId, status: "ACTIVE" },
      select: { code: true, name: true, location: true, status: true, venueId: true, venue: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="container dashboard-page">
        <span className="section-kicker">OPERAÇÕES</span>
        <h1>Postos de bilheteira</h1>
        <p>Selecione o evento e indique o local físico do posto, como a entrada principal ou o portão norte. Os vendedores aprovados para esse evento poderão abrir o turno e registar vendas.</p>
        <StationManager events={events} initialStations={stations} />
      </main>
      <SiteFooter />
    </>
  );
}
