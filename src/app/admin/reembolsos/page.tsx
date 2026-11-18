import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import RefundReviewActions from "@/app/_components/refund-review-actions";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  SELLER_REVIEW: "À espera da análise do vendedor",
  ORGANIZER_REVIEW: "À espera da decisão do organizador",
  PLATFORM_REVIEW: "À espera da validação da plataforma",
  PROCESSING: "Autorizado · à espera da execução pelo organizador",
  REFUND_AWAITING_PLATFORM_CONFIRMATION: "Reembolso registado · confirmação da plataforma pendente",
  COMPLETED: "Reembolso concluído",
  REJECTED: "Pedido rejeitado",
  FAILED: "Reembolso falhou",
  CANCELLED: "Pedido cancelado",
};

export default async function PlatformRefundsPage() {
  const { escalateStaleTicketCancellations } = await import("@/modules/finance/ticket-cancellations");
  await escalateStaleTicketCancellations();
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fadmin%2Freembolsos");
  if (ctx.platformRole !== "PLATFORM_ADMIN") redirect("/painel");
  if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) redirect("/acesso-painel");
  const refunds = await prisma.refund.findMany({
    where: { ticketId: { not: null } },
    include: {
      organization: { select: { name: true } },
      payment: { select: { currency: true } },
      ticket: { include: { ticketType: { select: { name: true } }, session: { include: { event: { select: { name: true } } } }, orderAttendee: { select: { fullName: true } } } },
      order: { select: { orderNumber: true, buyerName: true, buyerEmail: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <main className="container dashboard-page"><div className="dashboard-heading"><div><span className="section-kicker">ADMINISTRAÇÃO CENTRAL</span><h1>Casos de cancelamento</h1><p>Acompanhe os pedidos dos compradores em todas as etapas. A validação da plataforma fica disponível após a decisão do organizador ou o escalonamento.</p></div></div>{refunds.length ? <div className="dashboard-event-list">{refunds.map((refund) => <article className="panel refund-review-card" key={refund.id}><div className="refund-review-header"><div><strong>{refund.ticket?.ticketNumber} · {refund.ticket?.ticketType.name}</strong><p>{refund.organization.name} · {refund.ticket?.session.event.name}</p><small>{refund.order.buyerName} · {refund.order.buyerEmail} · {refund.order.orderNumber}</small></div><div><strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: refund.payment.currency }).format(refund.amountCents / 100)}</strong><span>{statusLabels[refund.status] ?? refund.status}</span></div></div><p><strong>Motivo:</strong> {refund.reason}</p><p><strong>Organizador assumiu reembolso:</strong> {refund.organizerAssumesRefund ? "Sim" : "Não (escalado para a plataforma)"}</p>{refund.sellerNotes ? <p><strong>Nota do vendedor:</strong> {refund.sellerNotes}</p> : null}{refund.organizerNotes ? <p><strong>Decisão do organizador:</strong> {refund.organizerNotes}</p> : null}{refund.platformNotes ? <p><strong>Notas da plataforma:</strong> {refund.platformNotes}</p> : null}{refund.refundRecipient ? <div className="refund-evidence"><p><strong>Recebedor:</strong> {refund.refundRecipient}</p><p><strong>Meio:</strong> {refund.refundMethod} · <strong>Data:</strong> {refund.refundPaidAt?.toISOString()}</p><p><strong>Referência:</strong> {refund.refundEvidenceRef ?? "Não indicada"}</p><p><strong>Notas:</strong> {refund.refundEvidenceNotes}</p></div> : null}<RefundReviewActions refundId={refund.id} status={refund.status} organizerAssumesRefund={refund.organizerAssumesRefund} platformOnly /></article>)}</div> : <div className="empty-state">Não há pedidos de cancelamento.</div>}</main>;
}
