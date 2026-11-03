import { createHmac, timingSafeEqual } from "crypto";
import type {
  PaymentAdapter,
  PaymentMethodType,
  InitiatePaymentInput,
  InitiatePaymentResult,
  RefundInput,
  RefundResult,
  WebhookPayload,
  ProviderResultStatus,
} from "../adapter";

// ============================================================
// Adaptador Multicaixa Express (EMIS) — Angola.
// Implementa o contrato PaymentAdapter da Parte 14.
//
// CONFIG (sempre via adapterConfig/gestor de segredos, nunca
// no código): { baseUrl, merchantToken, posId, webhookSecret }
//
// Fluxo "frame" (Push Payment) da EMIS:
//   1. initiate → POST /frameToken com token, frameToken devolve
//      redirectUrl ao app Multicaixa Express (QR/deeplink).
//   2. Utilizador confirma no app → EMIS chama o nosso webhook.
//   3. Verificação: HMAC-SHA256(rawBody, webhookSecret) em tempo
//      constante; payload { reference, status, amount }.
//   4. Em caso de UNKNOWN, queryStatus consulta GET /getByReference.
//
// Valores monetários em KWZ (1.000.000 = 1 kz? NÃO: EMIS usa
// kvandros em CENTAVOS — amount inteiro em cêntimos de kz).
// Moeda da org em Angola: AOA; a conversão AOA↔kz é 1:1.
// ============================================================

interface MulticaixaConfig {
  baseUrl?: string;
  merchantToken?: string;
  posId?: string;
  webhookSecret?: string;
}

interface EmisFrameResponse {
  id?: string;
  reference?: string;
  frameToken?: string;
  amount?: string;
  errors?: string[];
}

export class MulticaixaExpressAdapter implements PaymentAdapter {
  readonly code = "multicaixa-express";
  readonly country = "AO";
  readonly supportedMethods: readonly PaymentMethodType[] = ["MOBILE_MONEY"];
  readonly supportedCurrencies = ["AOA"];

  isConfigured(adapterConfig: Record<string, unknown>): boolean {
    const config = adapterConfig as MulticaixaConfig;
    return Boolean(
      config.baseUrl &&
      config.merchantToken &&
      config.posId &&
      config.webhookSecret
    );
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const config = (input.adapterConfig ?? {}) as MulticaixaConfig;
    if (!config.baseUrl || !config.merchantToken || !config.posId) {
      // Config incompleta: estado UNKNOWN protege o inventário
      // (Opção C) em vez de falhar silenciosamente.
      return {
        providerRef: `mcx_unconfigured_${input.paymentId}`,
        status: "UNKNOWN",
        rawPayload: { error: "adapter-unconfigured", code: this.code },
      };
    }

    // A referência enviada é a mesma que a EMIS devolve no webhook.
    // Não usar data.id: é um identificador interno diferente da referência.
    const reference = input.idempotencyKey.slice(0, 40);
    const response = await fetch(`${config.baseUrl}/frameToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: config.merchantToken,
      },
      body: JSON.stringify({
        posID: config.posId,
        reference,
        amount: input.amountCents / 100, // EMIS espera valor em kwanzas (decimal)
        mobile: false,
        card: "DISABLED",
        qrCode: "PAYMENT",
        callbackUrl: `${process.env.APP_URL ?? ""}/api/payments/webhook/${this.code}`,
      }),
    });

    if (!response.ok) {
      // Prestador indisponível: UNKNOWN preserva o inventário
      // para análise manual (Opção C), nunca CANCELLED.
      return {
        providerRef: reference,
        status: "UNKNOWN",
        rawPayload: { httpStatus: response.status, code: this.code },
      };
    }

    const data = (await response.json()) as EmisFrameResponse;
    if (data.errors?.length || !data.frameToken) {
      return {
        providerRef: data.reference ?? reference,
        status: "DECLINED",
        rawPayload: data as unknown,
      };
    }

    return {
      providerRef: reference,
      status: "INITIATED",
      // Deeplink/QR para o utilizador abrir o Multicaixa Express
      redirectUrl: `https://www.multicaixaexpress.ao/qr/payment?token=${encodeURIComponent(data.frameToken)}`,
      rawPayload: data as unknown,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const config = (input.adapterConfig ?? {}) as MulticaixaConfig;
    // EMIS não expõe reembolso automático no gateway básico:
    // reembolsos são operacionais (via EMIS Portal) e registados
    // manualmente. Devolvemos PROCESSING para o fluxo financeiro
    // (Parte 15) registar e o operador concluir no portal.
    void input;
    return {
      refundRef: `mcx_manual_${Date.now()}`,
      status: "PROCESSING",
      rawPayload: {
        adapter: this.code,
        note: "Reembolso via portal EMIS; concluí-lo manualmente e confirmar na plataforma.",
        merchant: Boolean(config.merchantToken),
      },
    };
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
    adapterConfig: Record<string, unknown>
  ): WebhookPayload | null {
    const config = (adapterConfig ?? {}) as MulticaixaConfig;
    const received =
      headers["x-emis-signature"] ?? headers["x-signature"] ?? "";

    if (!config.webhookSecret) return null;
    const expected = createHmac("sha256", config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const body = JSON.parse(rawBody) as {
        reference: string;
        status: "PAID" | "FAILED" | "EXPIRED" | string;
        amount: number; // kwanzas decimais
      };
      const statusMap: Record<string, ProviderResultStatus> = {
        PAID: "CONFIRMED",
        FAILED: "DECLINED",
        EXPIRED: "EXPIRED",
      };
      return {
        providerRef: body.reference,
        status: statusMap[body.status] ?? "UNKNOWN",
        amountCents: Math.round(body.amount * 100), // converte para cêntimos
        eventIdempotent: true,
        rawPayload: body,
      };
    } catch {
      return null;
    }
  }

  async queryStatus(
    providerRef: string,
    adapterConfig: Record<string, unknown>
  ): Promise<ProviderResultStatus> {
    const config = (adapterConfig ?? {}) as MulticaixaConfig;
    if (!config.baseUrl || !config.merchantToken) return "UNKNOWN";

    const response = await fetch(
      `${config.baseUrl}/getByReference?reference=${encodeURIComponent(providerRef)}`,
      { headers: { token: config.merchantToken } }
    );
    if (!response.ok) return "UNKNOWN";

    const data = (await response.json()) as { status?: string; errors?: string[] };
    if (data.errors?.length) return "UNKNOWN";
    switch (data.status) {
      case "PAID":
        return "CONFIRMED";
      case "FAILED":
        return "DECLINED";
      case "EXPIRED":
        return "EXPIRED";
      default:
        return "PROCESSING";
    }
  }
}
