import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import RefundReviewActions from "@/app/_components/refund-review-actions";

export const dynamic = "force-dynamic";

export default async function PlatformRefundsPage() {
  const { escalateStaleTicketCancellations } = await import("@/modules/finance/ticket-cancellations");
  await escalateStaleTicketCancellations();
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fadmin%2Freembolsos");
  if (ctx.platformRole !== "PLATFORM_ADMIN") redirect("/painel");
  if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) redirect("/acesso-painel");
  const refunds = await prisma.refund.findMany({
    where: { status: { in: ["PLATFORM_REVIEW", "REFUND_AWAITING_PLATFORM_CONFIRMATION"] } },
    include: {
      organization: { select: { name: true } },
      payment: { select: { currency: true } },
      ticket: { include: { ticketType: { select: { name: true } }, session: { include: { event: { select: { name: true } } } }, orderAttendee: { select: { fullName: true } } } },
      order: { select: { orderNumber: true, buyerName: true, buyerEmail: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return <main className="container dashboard-page"><div className="dashboard-heading"><div><span className="section-kicker">ADMINISTRAÇÃO CENTRAL</span><h1>Validação de reembolsos</h1><p>Valide o pedido e, depois, confirme o reembolso com base nos dados e comprovativo registados pelo organizador.</p></div></div>{refunds.length ? <div className="dashboard-event-list">{refunds.map((refund) => <article className="panel refund-review-card" key={refund.id}><div className="refund-review-header"><div><strong>{refund.ticket?.ticketNumber} · {refund.ticket?.ticketType.name}</strong><p>{refund.organization.name} · {refund.ticket?.session.event.name}</p><small>{refund.order.buyerName} · {refund.order.buyerEmail} · {refund.order.orderNumber}</small></div><div><strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: refund.payment.currency }).format(refund.amountCents / 100)}</strong><span>{refund.status === "PLATFORM_REVIEW" ? "A validar autorização" : "A confirmar pagamento efetuado"}</span></div></div><p><strong>Motivo:</strong> {refund.reason}</p><p><strong>Organizador assumiu reembolso:</strong> {refund.organizerAssumesRefund ? "Sim" : "Não (escalado para a plataforma)"}</p>{refund.platformNotes ? <p><strong>Notas anteriores:</strong> {refund.platformNotes}</p> : null}{refund.refundRecipient ? <div className="refund-evidence"><p><strong>Recebedor:</strong> {refund.refundRecipient}</p><p><strong>Meio:</strong> {refund.refundMethod} · <strong>Data:</strong> {refund.refundPaidAt?.toISOString()}</p><p><strong>Referência:</strong> {refund.refundEvidenceRef ?? "Não indicada"}</p><p><strong>Notas:</strong> {refund.refundEvidenceNotes}</p></div> : null}<RefundReviewActions refundId={refund.id} status={refund.status} organizerAssumesRefund={refund.organizerAssumesRefund} /></article>)}</div> : <div className="empty-state">Não há reembolsos pendentes de validação.</div>}</main>;
}
