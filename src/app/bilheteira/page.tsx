import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { assertOrgActive } from "@/shared/audit";
import { getAuthContext } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "../_components/site-shell";
import CashierClient from "./cashier-client";
import { listPaymentOptions } from "@/modules/payments/service";

export const dynamic = "force-dynamic";

export default async function BoxOfficePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login?next=%2Fbilheteira");
  if (!auth.organizationId) redirect("/painel");
  const eventStaffOnly = !auth.permissions.has("boxoffice:sell");
  const eventStaff = eventStaffOnly
    ? await prisma.eventStaffMembership.findMany({
        where: {
          userId: auth.userId,
          role: { in: ["ORGANIZER", "SELLER"] },
          approvedAt: { not: null },
          event: {
            organizationId: auth.organizationId,
            organization: { status: "ACTIVE" },
          },
        },
        select: {
          eventId: true,
          event: { select: { sessions: { select: { venueId: true } } } },
        },
      })
    : [];
  if (eventStaffOnly && eventStaff.length === 0) redirect("/painel");
  if (!auth.panelVerifiedUntil || auth.panelVerifiedUntil <= new Date()) {
    redirect("/acesso-painel?next=%2Fbilheteira");
  }
  await assertOrgActive(auth.organizationId);

  const now = new Date();
  const eventIds = eventStaff.map((staff) => staff.eventId);
  const venueIds = [...new Set(eventStaff.flatMap((staff) =>
    staff.event.sessions.flatMap((session) => session.venueId ? [session.venueId] : []),
  ))];
  const [organization, stations, shift, sessions] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.organizationId },
      select: { currency: true },
    }),
    prisma.boxOfficeStation.findMany({
      where: {
        organizationId: auth.organizationId,
        status: "ACTIVE",
        ...(eventStaffOnly ? { venueId: { in: venueIds } } : {}),
      },
      select: { code: true, name: true, venueId: true },
      orderBy: { name: "asc" },
    }),
    prisma.cashShift.findFirst({
      where: {
        organizationId: auth.organizationId,
        ...(eventStaffOnly ? { eventId: { in: eventIds } } : {}),
        operatorUserId: auth.userId,
        status: "OPEN",
      },
      select: {
        id: true,
        eventId: true,
        station: { select: { code: true, name: true } },
      },
    }),
    prisma.eventSession.findMany({
      where: {
        endsAt: { gt: now },
        event: {
          organizationId: auth.organizationId,
          status: "PUBLISHED",
          ...(eventStaffOnly ? { id: { in: eventIds } } : {}),
        },
      },
      select: {
        id: true,
        eventId: true,
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
    eventId: session.eventId,
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
  const cashierStations = stations.map((station) => ({
    code: station.code,
    name: station.name,
    eventIds: eventStaffOnly
      ? eventStaff
          .filter((staff) => staff.event.sessions.some((session) => session.venueId === station.venueId))
          .map((staff) => staff.eventId)
      : [],
  }));
  const currency = organization?.currency ?? "AOA";
  const paymentOptions = [
    { providerCode: "cash", providerName: "Pagamento em dinheiro", method: "CASH" as const },
    ...(await listPaymentOptions(currency)).filter((option) => option.method !== "CASH"),
  ];

  return (
    <>
      <SiteHeader />
      <main className="container cashier-page">
        <span className="section-kicker">BILHETEIRA PRESENCIAL</span>
        <h1>Bilheteira presencial</h1>
        <p className="cashier-intro">
          Registe vendas presenciais com dinheiro ou com os meios de pagamento
          disponíveis. Os bilhetes são emitidos após a confirmação do pagamento.
        </p>
        <CashierClient
          currency={currency}
          paymentOptions={paymentOptions}
          stations={cashierStations}
          activeShift={shift}
          sessions={events}
          eventStaffOnly={eventStaffOnly}
        />
      </main>
      <SiteFooter />
    </>
  );
}
