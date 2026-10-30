import { prisma } from "@/shared/lib/prisma";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { requireAuth } from "@/shared/auth";

// ============================================================
// Consultas autenticadas server-side para as páginas web.
// SEMPRE com select explícito — sem dados sensíveis (QR hash,
// passwordHash, mfaSecret, payloads de prestador).
// ============================================================

/** Encomendas do utilizador autenticado (comprador). */
export async function listMyOrders(userId: string) {
  return prisma.order.findMany({
    where: { buyerUserId: userId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalCents: true,
      currency: true,
      createdAt: true,
      confirmedAt: true,
      lines: {
        select: {
          quantity: true,
          unitPriceCents: true,
          ticketType: { select: { name: true, category: true } },
        },
      },
      tickets: {
        select: {
          id: true,
          ticketNumber: true,
          status: true,
          orderAttendee: { select: { fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Contexto mínimo da sessão para layouts autenticados. */
export async function getMyContext() {
  const ctx = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { fullName: true, email: true, mfaEnabled: true },
  });
  if (!user) throw new NotFoundError("Utilizador");
  return { ctx, user };
}
