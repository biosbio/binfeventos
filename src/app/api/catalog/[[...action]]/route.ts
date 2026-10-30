import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requirePermission } from "@/shared/auth";

// ============================================================
// Rotas de administração de catálogo (organizador)
//   POST /api/catalog/ticket-types  — criar tipo (ticketType:manage)
//   POST /api/catalog/batches       — criar lote (batch:manage)
// ============================================================

function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "ticket-types") {
      const auth = await requirePermission("ticketType:manage");
      const body = parse((await import("@/modules/inventory/schemas")).createTicketTypeSchema, await req.json());
      const { createTicketType } = await import("@/modules/inventory/service");
      const ticketType = await createTicketType(auth, body);
      return NextResponse.json({ ok: true, ticketType }, { status: 201 });
    }

    if (path === "batches") {
      const auth = await requirePermission("batch:manage");
      const body = parse((await import("@/modules/inventory/schemas")).createBatchSchema, await req.json());
      const { createBatch } = await import("@/modules/inventory/service");
      const batch = await createBatch(auth, body);
      return NextResponse.json({ ok: true, batch }, { status: 201 });
    }

    // Job interno de expiração de reservas (chamado por cron/worker)
    if (path === "run-expiration") {
      const auth = await requirePermission("inventory:read");
      const { releaseExpiredHolds } = await import("@/modules/inventory/service");
      const result = await releaseExpiredHolds();
      return NextResponse.json({ ok: true, ...result, by: auth.userId });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
