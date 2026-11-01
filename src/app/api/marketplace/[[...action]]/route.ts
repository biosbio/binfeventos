import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError, NotFoundError } from "@/shared/errors";
import { requireAuth } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Módulos inventory + sales — rotas API
//   POST /api/marketplace/availability          — disponibilidade (público)
//   POST /api/marketplace/holds                 — criar reserva (order:create)
//   POST /api/marketplace/holds/release         — libertar reserva (própria)
//   POST /api/marketplace/orders                — checkout (order:create)
//   GET  /api/marketplace/orders/{id}            — consultar (comprador)
//   POST /api/marketplace/orders/{id}/cancel    — cancelar (próprio/organização)
//   POST /api/admin/ticket-types                — criar tipo (ticketType:manage)
//   POST /api/admin/batches                      — criar lote (batch:manage)
//   POST /api/admin/expired-holds                — job de expiração (interno)
// ============================================================

const UUID = z.string().uuid();

function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

/** Rotas de catálogo/checkout do marketplace. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "availability") {
      // Disponibilidade é pública (marketplace), mas a chave de sessão valida formato
      const body = parse(
        (await import("@/modules/inventory/schemas")).availabilityQuerySchema,
        await req.json()
      );
      const { getAvailability } = await import("@/modules/inventory/service");
      const items = await getAvailability(body.sessionId);
      return NextResponse.json({ ok: true, items });
    }

    if (path === "holds") {
      const auth = await requireAuth();
      const body = parse((await import("@/modules/inventory/schemas")).holdRequestSchema, await req.json());
      const { createHold } = await import("@/modules/inventory/service");
      const hold = await createHold(auth, body);
      return NextResponse.json({ ok: true, ...hold }, { status: 201 });
    }

    if (path === "holds/release") {
      const auth = await requireAuth();
      const body = parse((await import("@/modules/inventory/schemas")).releaseHoldSchema, await req.json());
      const { releaseHold } = await import("@/modules/inventory/service");
      await releaseHold(auth, body.holdId);
      return NextResponse.json({ ok: true });
    }

    if (path === "orders") {
      const auth = await requireAuth();
      const body = parse((await import("@/modules/sales/schemas")).createOrderSchema, await req.json());
      const { createOrder } = await import("@/modules/sales/service");
      const order = await createOrder(auth, body);
      return NextResponse.json({ ok: true, order }, { status: 201 });
    }

    if (action.length === 3 && action[1] === "orders" && action[2] === "cancel") {
      const auth = await requireAuth();
      const orderId = parse(UUID, action[0]);
      const { cancelOrder } = await import("@/modules/sales/service");
      await cancelOrder(auth, orderId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;

  try {
    if (action.length === 1) {
      const auth = await requireAuth();
      const orderId = parse(UUID, action[0]);
      const { getOrder } = await import("@/modules/sales/service");
      const order = await getOrder(auth, orderId);
      return NextResponse.json({ ok: true, order });
    }

    throw new NotFoundError("Rota");
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
