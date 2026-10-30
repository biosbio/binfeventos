import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requireAuth, requirePermission } from "@/shared/auth";

// ============================================================
// Módulo access — rotas API
//   POST /api/access/validate            — validar QR na portaria
//   POST /api/access/transfer            — solicitar transferência (titular)
//   POST /api/access/transfer/decide      — aprovar/rejeitar (transfer:approve)
//   GET  /api/access/tickets/{id}/qr     — reobter token QR (rotação)
//   POST /api/access/gates               — criar porta (gate:manage)
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
    if (path === "validate") {
      const auth = await requirePermission("access:validate");
      const body = parse((await import("@/modules/access/schemas")).validateQrSchema, await req.json());
      const { validateEntry } = await import("@/modules/access/service");
      const result = await validateEntry(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "transfer") {
      const auth = await requireAuth();
      const body = parse((await import("@/modules/access/schemas")).issueTransferSchema, await req.json());
      const { requestTransfer } = await import("@/modules/access/service");
      const request = await requestTransfer(auth, body);
      return NextResponse.json({ ok: true, request }, { status: 201 });
    }

    if (path === "transfer/decide") {
      const auth = await requirePermission("transfer:approve");
      const body = parse((await import("@/modules/access/schemas")).approveTransferSchema, await req.json());
      const { decideTransfer } = await import("@/modules/access/service");
      const result = await decideTransfer(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "gates") {
      const auth = await requirePermission("gate:manage");
      const body = parse((await import("@/modules/access/schemas")).createGateSchema, await req.json());
      const { prisma } = await import("@/shared/lib/prisma");
      if (!auth.organizationId) throw new Error("no-active-organization");
      const gate = await prisma.accessGate.create({
        data: {
          organizationId: auth.organizationId,
          venueId: body.venueId,
          sessionId: body.sessionId ?? null,
          code: body.code,
          name: body.name,
          gateType: body.gateType,
        },
        select: { id: true, code: true },
      });
      return NextResponse.json({ ok: true, gate }, { status: 201 });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;

  try {
    // GET /api/access/tickets/{id}/qr
    if (action.length === 3 && action[0] === "tickets" && action[2] === "qr") {
      const auth = await requireAuth();
      const { getQrToken } = await import("@/modules/access/service");
      const token = await getQrToken(auth, action[1]!);
      return NextResponse.json({ ok: true, qrToken: token });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
