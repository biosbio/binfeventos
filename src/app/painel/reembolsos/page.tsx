import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteFooter, SiteHeader } from "@/app/_components/site-shell";
import RefundReviewActions from "@/app/_components/refund-review-actions";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = { SELLER_REVIEW: "Análise do vendedor", ORGANIZER_REVIEW: "Decisão do organizador", PROCESSING: "Reembolso autorizado · aguarda execução" };

export default async function OrganizerRefundsPage() {
  const { escalateStaleTicketCancellations } = await import("@/modules/finance/ticket-cancellations");
  await escalateStaleTicketCancellations();
  let ctx;
  try { ctx = await requireAuth(); } catch { redirect("/login?next=%2Fpainel%2Freembolsos"); }
  if (!ctx.organizationId) redirect("/organizador");
  const staffEvents = await prisma.eventStaffMembership.findMany({ where: { userId: ctx.userId, role: { in: ["SELLER", "ORGANIZER"] }, approvedAt: { not: null }, event: { organizationId: ctx.organizationId } }, select: { eventId: true } });
  const ownedEvents = await prisma.event.findMany({ where: { organizationId: ctx.organizationId, responsibleUserId: ctx.userId }, select: { id: true } });
  const scopedEventIds = [...new Set([...staffEvents.map((e) => e.eventId), ...ownedEvents.map((e) => e.id)])];
  if (!scopedEventIds.length) redirect("/painel");
  const refunds = await prisma.refund.findMany({
    where: { organizationId: ctx.organizationId, status: { in: ["SELLER_REVIEW", "ORGANIZER_REVIEW", "PROCESSING"] }, ticket: { session: { eventId: { in: scopedEventIds } } } },
    include: {
      ticket: { include: { ticketType: { select: { name: true } }, session: { include: { event: { select: { name: true } } } }, orderAttendee: { select: { fullName: true } } } },
      payment: { select: { currency: true } },
      order: { select: { orderNumber: true, buyerName: true, buyerEmail: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return <><SiteHeader /><main className="container dashboard-page"><span className="section-kicker">FINANÇAS</span><h1>Cancelamentos e reembolsos</h1><p>Analise pedidos de cancelamento. A aprovação do organizador assume a responsabilidade pelo reembolso; a plataforma autoriza e confirma a conclusão.</p>{refunds.length ? <div className="dashboard-event-list">{refunds.map((refund) => <article className="panel refund-review-card" key={refund.id}><div className="refund-review-header"><div><strong>{refund.ticket?.ticketNumber} · {refund.ticket?.ticketType.name}</strong><p>{refund.ticket?.session.event.name} · {refund.ticket?.orderAttendee?.fullName ?? refund.order.buyerName}</p><small>Comprador: {refund.order.buyerName} · {refund.order.buyerEmail} · Pedido {refund.order.orderNumber}</small></div><div><strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: refund.payment.currency }).format(refund.amountCents / 100)}</strong><span>{statusLabels[refund.status] ?? refund.status}</span></div></div><p><strong>Motivo:</strong> {refund.reason}</p>{refund.sellerNotes ? <p><strong>Nota do vendedor:</strong> {refund.sellerNotes}</p> : null}{refund.organizerNotes ? <p><strong>Decisão do organizador:</strong> {refund.organizerNotes}</p> : null}<RefundReviewActions refundId={refund.id} status={refund.status} /></article>)}</div> : <div className="empty-state">Não há pedidos à espera da sua análise.</div>}</main><SiteFooter /></>;
}
