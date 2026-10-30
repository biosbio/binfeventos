import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requirePermission } from "@/shared/auth";

// ============================================================
// Módulo boxoffice — rotas API
//   POST /api/boxoffice/shifts/open    — abrir turno (shift:open)
//   POST /api/boxoffice/shifts/close   — fechar turno (shift:close)
//   POST /api/boxoffice/shifts/movement — movimento de caixa (cash:movement)
//   POST /api/boxoffice/sale           — venda presencial (boxoffice:sell)
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
    if (path === "shifts/open") {
      const auth = await requirePermission("shift:open");
      const body = parse((await import("@/modules/boxoffice/schemas")).openShiftSchema, await req.json());
      const { openShift } = await import("@/modules/boxoffice/service");
      const shift = await openShift(auth, body);
      return NextResponse.json({ ok: true, shift }, { status: 201 });
    }

    if (path === "shifts/close") {
      const auth = await requirePermission("shift:close");
      const raw = await req.json();
      // Notas obrigatórias quando há diferença: validação dupla (servidor)
      const body = parse((await import("@/modules/boxoffice/schemas")).closeShiftSchema, raw);
      const { closeShift } = await import("@/modules/boxoffice/service");
      const result = await closeShift(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "shifts/movement") {
      const auth = await requirePermission("cash:movement");
      const body = parse((await import("@/modules/boxoffice/schemas")).cashMovementSchema, await req.json());
      const { registerCashMovement } = await import("@/modules/boxoffice/service");
      await registerCashMovement(auth, body);
      return NextResponse.json({ ok: true });
    }

    if (path === "sale") {
      const auth = await requirePermission("boxoffice:sell");
      const body = parse((await import("@/modules/boxoffice/schemas")).boxOfficeSaleSchema, await req.json());
      const { boxOfficeSale } = await import("@/modules/boxoffice/service");
      const order = await boxOfficeSale(auth, body);
      return NextResponse.json({ ok: true, order }, { status: 201 });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
