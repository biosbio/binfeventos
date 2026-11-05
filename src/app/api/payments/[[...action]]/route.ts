import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
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
    if (path === "sandbox/authorize") {
      if (process.env.NODE_ENV === "production") {
        throw new ValidationError("A simulação sandbox está disponível apenas em desenvolvimento e testes.");
      }
      const auth = await requireAuth();
      const body = parse(z.object({ providerRef: z.string().trim().min(20).max(160) }), await req.json());
      const { prisma } = await import("@/shared/lib/prisma");
      const payment = await prisma.payment.findFirst({
        where: { providerRef: body.providerRef, provider: { code: "sandbox" } },
        select: {
          amountCents: true,
          orderId: true,
          provider: { select: { adapterConfig: true } },
          order: {
            select: {
              buyerUserId: true,
              channel: true,
              cashShift: { select: { operatorUserId: true } },
            },
          },
        },
      });
      if (!payment) throw new ValidationError("Pagamento sandbox não encontrado.");
      const isBuyer = payment.order.buyerUserId === auth.userId;
      const isCashier = payment.order.channel === "BOX_OFFICE" && payment.order.cashShift?.operatorUserId === auth.userId;
      const cashierStepUp = Boolean(auth.panelVerifiedUntil && auth.panelVerifiedUntil.getTime() > Date.now());
      if (payment.order.channel === "BOX_OFFICE" ? (!isCashier || !cashierStepUp) : !isBuyer) {
        throw new ValidationError("Este pagamento não pertence à sua sessão autenticada.");
      }
      const adapterConfig = (payment.provider.adapterConfig ?? {}) as Record<string, unknown>;
      const webhookSecret = adapterConfig.webhookSecret;
      if (typeof webhookSecret !== "string" || webhookSecret.length < 32) {
        throw new ValidationError("O prestador sandbox não está configurado.");
      }
      const rawBody = JSON.stringify({ providerRef: body.providerRef, status: "CONFIRMED", amountCents: payment.amountCents });
      const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const { handleWebhook } = await import("@/modules/payments/service");
      await handleWebhook("sandbox", rawBody, { "x-sandbox-signature": signature });
      return NextResponse.json({ ok: true, orderId: payment.orderId });
    }

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
    if (path === "options") {
      await requireAuth();
      const url = new URL(_req.url);
      const currency = url.searchParams.get("currency")?.toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        throw new ValidationError("Indique um código de moeda válido.");
      }
      const { listPaymentOptions } = await import("@/modules/payments/service");
      const options = await listPaymentOptions(currency);
      return NextResponse.json({ ok: true, options }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

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
