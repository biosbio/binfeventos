import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentAdapter,
  InitiatePaymentInput,
  InitiatePaymentResult,
  RefundInput,
  RefundResult,
  WebhookPayload,
  ProviderResultStatus,
} from "../adapter";

// ============================================================
// Adaptador SANDBOX (mock) — implementa PaymentAdapter para
// desenvolvimento e testes end-to-end sem prestador real.
//
// Em produção, criar adaptadores concretos (ex: MulticaixaExpress
// em AO) implementando a MESMA interface e registrando com
// registerAdapter(). Nenhuma chave aqui: a config chega sempre
// via adapterConfig (gestor de segredos no deploy).
//
// Assinatura de webhook: HMAC-SHA256(rawBody, webhookSecret) —
// comparação em tempo constante.
// ============================================================

interface SandboxConfig {
  /** Chave de assinatura do webhook (vinda de secrets). */
  webhookSecret?: string;
  /** Forçar resultado na iniciação (para testes). */
  forceStatus?: ProviderResultStatus;
}

export class SandboxAdapter implements PaymentAdapter {
  readonly code = "sandbox";
  readonly country = "GLOBAL";

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const providerRef = `sbx_${input.paymentId}_${input.idempotencyKey.slice(0, 8)}`;
    const status: ProviderResultStatus = input.amountCents > 0 ? "INITIATED" : "DECLINED";
    return {
      providerRef,
      status,
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/checkout/sandbox-authorization?ref=${providerRef}&amount=${input.amountCents}`,
      rawPayload: { adapter: "sandbox", providerRef, amountCents: input.amountCents },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      refundRef: `sbxrf_${input.providerRef}`,
      status: "COMPLETED",
      rawPayload: { adapter: "sandbox", refundOf: input.providerRef, amountCents: input.amountCents },
    };
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
    adapterConfig: Record<string, unknown>
  ): WebhookPayload | null {
    const config = (adapterConfig ?? {}) as SandboxConfig;
    const received =
      headers["x-sandbox-signature"] ?? headers["x-signature"] ?? "";

    if (!config.webhookSecret) return null; // sem segredo configurado: recusa
    const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");

    // Comparação em tempo constante (SEC: timing attacks)
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const body = JSON.parse(rawBody) as {
        providerRef: string;
        status: string;
        amountCents: number;
      };
      return {
        providerRef: body.providerRef,
        status: body.status as ProviderResultStatus,
        amountCents: body.amountCents,
        eventIdempotent: true,
        rawPayload: body,
      };
    } catch {
      return null;
    }
  }

  async queryStatus(
    providerRef: string,
    _adapterConfig: Record<string, unknown>
  ): Promise<ProviderResultStatus> {
    void providerRef;
    void _adapterConfig;
    // Sandbox: sem consulta real; produção consulta o prestador
    return "UNKNOWN";
  }
}
