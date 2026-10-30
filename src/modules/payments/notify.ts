import { prisma } from "@/shared/lib/prisma";

// ============================================================
// Parte 21b (Domínio 10): notificação do comprador após
// confirmação de pagamento. Best-effort: falha de notificação
// NÃO desfaça o pagamento (risco nº 12) — Promise.allSettled
// deixa o registo RETRYING no módulo notifications para o job
// de reprocessamento.
// ============================================================

export async function notifyPaymentConfirmed(orderId: string, paymentId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { buyerUserId: true, sessionId: true },
  });
  if (!order?.buyerUserId) return;

  let eventName = "";
  if (order.sessionId) {
    const session = await prisma.eventSession.findUnique({
      where: { id: order.sessionId },
      select: { event: { select: { name: true } } },
    });
    eventName = session?.event.name ?? "";
  }

  const { queueNotification } = await import("@/modules/notifications/service");
  const data = { orderNumber: orderId, eventName };
  await Promise.allSettled([
    queueNotification({
      userId: order.buyerUserId,
      type: "PAYMENT_CONFIRMED",
      channel: "IN_APP",
      data,
      idempotencyKey: `payment-confirmed:${paymentId}`,
    }),
    queueNotification({
      userId: order.buyerUserId,
      type: "PAYMENT_CONFIRMED",
      channel: "EMAIL",
      data,
      idempotencyKey: `payment-confirmed:${paymentId}`,
    }),
    queueNotification({
      userId: order.buyerUserId,
      type: "TICKETS_ISSUED",
      channel: "IN_APP",
      data,
      idempotencyKey: `tickets-issued:${orderId}`,
    }),
  ]);
}
