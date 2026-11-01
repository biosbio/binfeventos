import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requirePermission } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Módulo finance — rotas API
//   POST /api/finance/refunds/request     — solicitar (refund:request)
//   POST /api/finance/refunds/decide      — aprovar/rejeitar (refund:approve)
//   POST /api/finance/settlements/prepare — preparar (settlement:prepare)
//   POST /api/finance/settlements/decide  — dupla aprovação (settlement:approve)
//   POST /api/finance/settlements/paid   — marcar paga (settlement:approve)
//   POST /api/finance/reserves            — constituir (reserve:manage)
//   POST /api/finance/reserves/release    — libertar (reserve:manage)
//   POST /api/finance/ledger/adjust        — compensatório (ledger:adjust)
//   GET  /api/finance/ledger              — consultar (ledger:read)
// ============================================================

function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "refunds/request") {
      const auth = await requirePermission("refund:request");
      const body = parse((await import("@/modules/finance/schemas")).requestRefundSchema, await req.json());
      const { requestRefund } = await import("@/modules/finance/refunds");
      const result = await requestRefund(auth, body);
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    }

    if (path === "refunds/decide") {
      const auth = await requirePermission("refund:approve");
      const body = parse((await import("@/modules/finance/schemas")).approveRefundSchema, await req.json());
      const { decideRefund } = await import("@/modules/finance/refunds");
      const result = await decideRefund(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "refunds/complete") {
      const auth = await requirePermission("refund:approve");
      const body = parse((await import("@/modules/finance/schemas")).completeRefundSchema, await req.json());
      const { completeRefund } = await import("@/modules/finance/refunds");
      const result = await completeRefund(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "settlements/prepare") {
      const auth = await requirePermission("settlement:prepare");
      const body = parse((await import("@/modules/finance/schemas")).prepareSettlementSchema, await req.json());
      const { prepareSettlement } = await import("@/modules/finance/ledger");
      const settlement = await prepareSettlement(auth, body);
      return NextResponse.json({ ok: true, settlement }, { status: 201 });
    }

    if (path === "settlements/decide") {
      const auth = await requirePermission("settlement:approve");
      const body = parse((await import("@/modules/finance/schemas")).approveSettlementSchema, await req.json());
      const { decideSettlement } = await import("@/modules/finance/ledger");
      const result = await decideSettlement(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "settlements/paid") {
      const auth = await requirePermission("settlement:approve");
      const body = parse(z.object({ settlementId: z.string().uuid() }), await req.json());
      const { markSettlementPaid } = await import("@/modules/finance/ledger");
      await markSettlementPaid(auth, body.settlementId);
      return NextResponse.json({ ok: true });
    }

    if (path === "reserves") {
      const auth = await requirePermission("reserve:manage");
      const body = parse((await import("@/modules/finance/schemas")).reserveSchema, await req.json());
      const { createReserve } = await import("@/modules/finance/ledger");
      const reserve = await createReserve(auth, body);
      return NextResponse.json({ ok: true, reserve }, { status: 201 });
    }

    if (path === "reserves/release") {
      const auth = await requirePermission("reserve:manage");
      const body = parse((await import("@/modules/finance/schemas")).releaseReserveSchema, await req.json());
      const { releaseReserve } = await import("@/modules/finance/ledger");
      await releaseReserve(auth, body.reserveId, body.notes);
      return NextResponse.json({ ok: true });
    }

    if (path === "ledger/adjust") {
      const auth = await requirePermission("ledger:adjust");
      const body = parse((await import("@/modules/finance/schemas")).adjustLedgerSchema, await req.json());
      const { adjustLedger } = await import("@/modules/finance/ledger");
      const entry = await adjustLedger(auth, body);
      return NextResponse.json({ ok: true, entry }, { status: 201 });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "ledger") {
      const auth = await requirePermission("ledger:read");
      const { readLedger } = await import("@/modules/finance/ledger");
      const entries = await readLedger(auth);
      return NextResponse.json({ ok: true, entries });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
