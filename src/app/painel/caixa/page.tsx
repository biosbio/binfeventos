import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "@/app/_components/site-shell";
import CashDashboard from "./cash-dashboard";

export const dynamic = "force-dynamic";

export default async function CashDashboardPage() {
  let auth;
  try { auth = await requireAuth(); } catch { redirect("/login?next=%2Fpainel%2Fcaixa"); }
  if (!auth.organizationId) redirect("/organizador");
  if (!auth.permissions.has("shift:reconcile") && !auth.permissions.has("cash:deposit")) redirect("/painel");

  const [organization, shifts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { currency: true } }),
    prisma.cashShift.findMany({
      where: { organizationId: auth.organizationId },
      include: {
        operator: { select: { id: true, fullName: true } },
        station: { select: { name: true } },
        event: { select: { name: true } },
        orders: {
          where: { status: "CONFIRMED" },
          select: {
            id: true, totalCents: true,
            lines: { select: { quantity: true, ticketType: { select: { name: true } } } },
            payments: { where: { status: "CONFIRMED" }, select: { amountCents: true, method: true } },
          },
        },
        deposits: { select: { id: true, amountCents: true, outstandingCents: true, receivedCents: true, differenceNotes: true, status: true, createdAt: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
  ]);

  const sellers = new Map<string, { id: string; name: string; soldCents: number; tickets: number; ticketTypes: Record<string, number>; payments: Record<string, number>; pendingCents: number; receivedCents: number; deposits: { id: string; amountCents: number; outstandingCents: number; receivedCents: number; differenceNotes: string | null; status: string; createdAt: string; shiftId: string; event: string; station: string }[] }>();
  for (const shift of shifts) {
    let seller = sellers.get(shift.operator.id);
    if (!seller) {
      seller = { id: shift.operator.id, name: shift.operator.fullName, soldCents: 0, tickets: 0, ticketTypes: {}, payments: {}, pendingCents: 0, receivedCents: 0, deposits: [] };
      sellers.set(shift.operator.id, seller);
    }
    for (const order of shift.orders) {
      seller.soldCents += order.totalCents;
      seller.tickets += order.lines.reduce((n, line) => n + line.quantity, 0);
      for (const line of order.lines) seller.ticketTypes[line.ticketType.name] = (seller.ticketTypes[line.ticketType.name] ?? 0) + line.quantity;
      for (const payment of order.payments) seller.payments[payment.method] = (seller.payments[payment.method] ?? 0) + payment.amountCents;
    }
    for (const deposit of shift.deposits) {
      seller.receivedCents += deposit.receivedCents;
      if (deposit.status !== "CONFIRMED") seller.pendingCents += deposit.outstandingCents || deposit.amountCents;
      seller.deposits.push({ id: deposit.id, amountCents: deposit.amountCents, outstandingCents: deposit.outstandingCents || deposit.amountCents, receivedCents: deposit.receivedCents, differenceNotes: deposit.differenceNotes, status: deposit.status, createdAt: deposit.createdAt.toISOString(), shiftId: shift.id, event: shift.event?.name ?? "Bilheteira", station: shift.station.name });
    }
  }
  const report = Array.from(sellers.values()).sort((a, b) => a.name.localeCompare(b.name));
  return <><SiteHeader /><main className="container dashboard-page"><span className="section-kicker">OPERAÇÕES</span><h1>Caixa</h1><p>Acompanhe bilhetes e vendas. Cada recebimento zera apenas o valor pendente; os totais vendidos e recebidos permanecem no histórico.</p><CashDashboard currency={organization?.currency ?? "AOA"} sellers={report} /></main><SiteFooter /></>;
}
