import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { assertOrgActive } from "@/shared/audit";
import { getAuthContext } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "../_components/site-shell";
import CashierClient from "./cashier-client";

export const dynamic = "force-dynamic";

export default async function BoxOfficePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login?next=%2Fbilheteira");
  if (!auth.organizationId || !auth.permissions.has("boxoffice:sell")) redirect("/painel");
  if (!auth.panelVerifiedUntil || auth.panelVerifiedUntil <= new Date()) {
    redirect("/acesso-painel?next=%2Fbilheteira");
  }
  await assertOrgActive(auth.organizationId);

  const now = new Date();
  const [organization, stations, shift, sessions] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.organizationId },
      select: { currency: true },
    }),
    prisma.boxOfficeStation.findMany({
      where: { organizationId: auth.organizationId, status: "ACTIVE" },
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.cashShift.findFirst({
      where: {
        organizationId: auth.organizationId,
        operatorUserId: auth.userId,
        status: "OPEN",
      },
      select: {
        id: true,
        station: { select: { code: true, name: true } },
      },
    }),
    prisma.eventSession.findMany({
      where: {
        endsAt: { gt: now },
        event: { organizationId: auth.organizationId, status: "PUBLISHED" },
      },
      select: {
        id: true,
        startsAt: true,
        event: { select: { name: true } },
        inventory: {
          where: {
            ticketType: { status: "ACTIVE" },
            batch: { status: "OPEN" },
          },
          select: {
            totalQuantity: true,
            reservedQuantity: true,
            soldQuantity: true,
            ticketType: {
              select: { id: true, name: true, currency: true, basePriceCents: true },
            },
            batch: {
              select: { id: true, name: true, quantity: true, priceCents: true },
            },
          },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 100,
    }),
  ]);

  const events = sessions.map((session) => ({
    id: session.id,
    name: session.event.name,
    startsAt: session.startsAt.toISOString(),
    tickets: session.inventory
      .map((inventory) => ({
        ticketTypeId: inventory.ticketType.id,
        batchId: inventory.batch.id,
        name: inventory.ticketType.name,
        batchName: inventory.batch.name,
        currency: inventory.ticketType.currency,
        unitPriceCents: inventory.batch.priceCents ?? inventory.ticketType.basePriceCents,
        available: Math.max(
          0,
          inventory.totalQuantity - inventory.reservedQuantity - inventory.soldQuantity,
        ),
      }))
      .filter((ticket) => ticket.available > 0),
  })).filter((session) => session.tickets.length > 0);

  return (
    <>
      <SiteHeader />
      <main className="container cashier-page">
        <span className="section-kicker">BILHETEIRA PRESENCIAL</span>
        <h1>Vendas em dinheiro</h1>
        <p className="cashier-intro">
          O vendedor autorizado regista o pagamento recebido em dinheiro. A venda
          é confirmada e os bilhetes são emitidos no fim da operação.
        </p>
        <CashierClient
          currency={organization?.currency ?? "AOA"}
          stations={stations}
          activeShift={shift}
          sessions={events}
        />
      </main>
      <SiteFooter />
    </>
  );
}
