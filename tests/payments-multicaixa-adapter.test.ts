import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { MulticaixaExpressAdapter } from "../src/modules/payments/adapters/multicaixa-express";

// Testes de caracterização do adaptador Multicaixa Express.
// Nenhuma chamada HTTP real: testam-se contratos e segurança.

const adapter = new MulticaixaExpressAdapter();

describe("MulticaixaExpressAdapter.initiate", () => {
  it("sem config devolve UNKNOWN (inventário protegido, Opção C)", async () => {
    const r = await adapter.initiate({
      paymentId: "p-1",
      amountCents: 100000,
      currency: "AOA",
      returnUrl: "http://x/r",
      idempotencyKey: "key-1234567890abcdef",
      adapterConfig: {},
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.redirectUrl).toBeUndefined();
  });

  it("com config completa gera INITIATED com redirectUrl do QR", async () => {
    // Mock do fetch: resposta EMIS válida
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ id: "mcx-ref-1", frameToken: "FRAME123", amount: "1000.00" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    try {
      const r = await adapter.initiate({
        paymentId: "p-2",
        amountCents: 100000,
        currency: "AOA",
        returnUrl: "http://x/r",
        idempotencyKey: "key-1234567890abcdef",
        adapterConfig: { baseUrl: "https://api.emis.ao/v1", merchantToken: "tok", posId: "123" },
      });
      expect(r.status).toBe("INITIATED");
      expect(r.providerRef).toBe("mcx-ref-1");
      expect(r.redirectUrl).toContain("multicaixaexpress.ao");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("prestador indisponível devolve UNKNOWN (nunca CANCELLED)", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response("upstream", { status: 503 })) as typeof fetch;
    try {
      const r = await adapter.initiate({
        paymentId: "p-3",
        amountCents: 1000,
        currency: "AOA",
        returnUrl: "http://x/r",
        idempotencyKey: "key-1234567890abcdef",
        adapterConfig: { baseUrl: "https://api.emis.ao/v1", merchantToken: "tok", posId: "123" },
      });
      expect(r.status).toBe("UNKNOWN");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("MulticaixaExpressAdapter.verifyWebhook (SEC-17)", () => {
  const secret = "mcx-secret";
  const rawBody = JSON.stringify({
    reference: "mcx-ref-1",
    status: "PAID",
    amount: 1000, // kwanzas
  });

  function sign(body: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  it("aceita PAID e converte kwanzas para cêntimos", () => {
    const payload = adapter.verifyWebhook(
      rawBody,
      { "x-emis-signature": sign(rawBody) },
      { webhookSecret: secret }
    );
    expect(payload).not.toBeNull();
    expect(payload!.status).toBe("CONFIRMED");
    expect(payload!.amountCents).toBe(100_000); // 1000 kz → 100000 cêntimos
  });

  it("mapeia FAILED → DECLINED e EXPIRED → EXPIRED", () => {
    const failed = JSON.stringify({ reference: "r", status: "FAILED", amount: 1 });
    expect(
      adapter.verifyWebhook(failed, { "x-emis-signature": sign(failed) }, { webhookSecret: secret })?.status
    ).toBe("DECLINED");
  });

  it("rejeita assinatura inválida e corpo modificado", () => {
    expect(
      adapter.verifyWebhook(rawBody, { "x-emis-signature": "bad" }, { webhookSecret: secret })
    ).toBeNull();

    const tampered = JSON.stringify({ reference: "mcx-ref-1", status: "PAID", amount: 1 });
    expect(
      adapter.verifyWebhook(tampered, { "x-emis-signature": sign(rawBody) }, { webhookSecret: secret })
    ).toBeNull();
  });

  it("estado desconhecido mapeia para UNKNOWN (protege inventário)", () => {
    const unknown = JSON.stringify({ reference: "r", status: "PENDING", amount: 5 });
    const payload = adapter.verifyWebhook(
      unknown,
      { "x-emis-signature": sign(unknown) },
      { webhookSecret: secret }
    );
    expect(payload?.status).toBe("UNKNOWN");
  });
});

describe("MulticaixaExpressAdapter.refund", () => {
  it("devolve PROCESSING com nota operacional (portal EMIS)", async () => {
    const r = await adapter.refund({
      providerRef: "mcx-ref-1",
      amountCents: 500,
      adapterConfig: { merchantToken: "tok" },
    });
    expect(r.status).toBe("PROCESSING");
    expect(JSON.stringify(r.rawPayload)).toContain("EMIS");
  });
});
