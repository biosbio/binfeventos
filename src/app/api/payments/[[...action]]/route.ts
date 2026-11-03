import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requireAuth, requirePermission } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Módulo payments — rotas API
//   POST /api/payments/initiate           — iniciar pagamento (comprador)
//   POST /api/payments/webhook/{code}     — webhook do prestador (público, assinado)
//   POST /api/payments/review             — Opção C: revisão manual
//   GET  /api/payments/pending            — pagamentos UNDER_REVIEW
// ============================================================

const UUID = z.string().uuid();

function parse<TSchema extends z.ZodType>(schema: TSchema, data: unknown): z.output<TSchema> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      r.error.issues.map((i) => `${i.path.map((part) => String(part)).join(".")}: ${i.message}`).join("; ")
    );
  }
  return r.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "initiate") {
      const auth = await requireAuth();
      const body = parse((await import("@/modules/payments/schemas")).initiatePaymentSchema, await req.json());
      const { initiatePayment } = await import("@/modules/payments/service");
      const result = await initiatePayment(auth, body);
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    }

    // Webhook: público, mas assinatura validada pelo adaptador
    if (action.length === 2 && action[0] === "webhook") {
      const providerCode = action[1]!;
      const rawBody = await req.text();
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => { headers[k] = v; });
      const { handleWebhook } = await import("@/modules/payments/service");
      const result = await handleWebhook(providerCode, rawBody, headers);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "review") {
      const auth = await requirePermission("payment:review");
      const body = parse((await import("@/modules/payments/schemas")).manualReviewSchema, await req.json());
      const { manualReview } = await import("@/modules/payments/service");
      await manualReview(auth, body);
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
  const path = action.join("/");

  try {
    if (path === "pending") {
      const auth = await requirePermission("payment:review");
      const { prisma } = await import("@/shared/lib/prisma");
      if (!auth.organizationId) return NextResponse.json({ ok: true, payments: [] });
      const payments = await prisma.payment.findMany({
        where: { organizationId: auth.organizationId, status: { in: ["UNDER_REVIEW", "AWAITING_AUTHORIZATION", "INITIATED", "PROCESSING"] } },
        select: {
          id: true, status: true, method: true, amountCents: true, currency: true,
          createdAt: true,
          order: { select: { orderNumber: true, buyerName: true, buyerEmail: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return NextResponse.json({ ok: true, payments });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
