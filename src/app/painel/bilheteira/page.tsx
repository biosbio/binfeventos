import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "../../_components/site-shell";
import StationManager from "./station-manager";
import CashDepositManager from "./cash-deposit-manager";

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

  const [organization, events, stations, deposits, sales] = await Promise.all([
    prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { currency: true } }),
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
    prisma.cashDeposit.findMany({
      where: {
        status: { in: ["COUNTED", "HANDED_OVER", "DEPOSITED"] },
        shift: { organizationId: auth.organizationId },
      },
      select: {
        id: true,
        amountCents: true,
        outstandingCents: true,
        receivedCents: true,
        createdAt: true,
        shift: {
          select: {
            closedAt: true,
            operator: { select: { id: true, fullName: true } },
            station: { select: { name: true, location: true } },
            event: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cashShift.aggregate({
      where: { organizationId: auth.organizationId },
      _sum: { totalSalesCents: true },
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
        <CashDepositManager
          currency={organization?.currency ?? "AOA"}
          deposits={deposits.map((deposit) => ({
            id: deposit.id,
            amountCents: deposit.amountCents,
            outstandingCents: deposit.outstandingCents || deposit.amountCents,
            receivedCents: deposit.receivedCents,
            createdAt: deposit.createdAt.toISOString(),
            closedAt: deposit.shift.closedAt?.toISOString() ?? null,
            sellerName: deposit.shift.operator.fullName,
            sellerId: deposit.shift.operator.id,
            stationName: deposit.shift.station.name,
            stationLocation: deposit.shift.station.location,
            eventName: deposit.shift.event?.name ?? "Bilheteira da organização",
            eventId: deposit.shift.event?.id ?? null,
          }))}
          totalSalesCents={sales._sum.totalSalesCents ?? 0}
        />
      </main>
      <SiteFooter />
    </>
  );
}
