import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requirePermission } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Rotas de administração de catálogo (organizador)
//   POST /api/catalog/ticket-types      — criar tipo (ticketType:manage)
//   POST /api/catalog/batches            — criar lote (batch:manage)
//   POST /api/catalog/batches/status    — abrir/pausar/fechar (batch:manage)
//   POST /api/catalog/run-expiration    — job de expiração (inventory:read)
// ============================================================

function parse<TSchema extends z.ZodType>(schema: TSchema, data: unknown): z.output<TSchema> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      r.error.issues.map((i) => `${i.path.map((part) => String(part)).join(".")}: ${i.message}`).join("; ")
    );
  }
  return r.data;
}

const batchStatusSchema = z.object({
  batchId: z.string().uuid(),
  to: z.enum(["OPEN", "PAUSED", "CLOSED"]),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
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

    // Parte 19: sem esta rota, nenhum lote ficava à venda
    if (path === "batches/status") {
      const auth = await requirePermission("batch:manage");
      const body = parse(batchStatusSchema, await req.json());
      const { transitionBatch } = await import("@/modules/inventory/service");
      const result = await transitionBatch(auth, body.batchId, body.to);
      return NextResponse.json({ ok: true, ...result });
    }

    // Job interno de expiração de reservas (chamado por cron/worker)
    if (path === "run-expiration") {
      // A tarefa é global a todas as organizações; apenas o administrador
      // central, com step-up MFA, pode executá-la manualmente.
      const auth = await requirePermission("admin:platform");
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
