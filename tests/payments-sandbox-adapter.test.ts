import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { SandboxAdapter } from "../src/modules/payments/adapters/sandbox";

// Testes de caracterização do adaptador sandbox — protegem a
// interface PaymentAdapter contra regressões (Parte 18).

const adapter = new SandboxAdapter();

describe("SandboxAdapter.initiate", () => {
  it("gera providerRef determinístico e estado INITIATED para valor positivo", async () => {
    const r = await adapter.initiate({
      paymentId: "p-123",
      amountCents: 5000,
      currency: "AOA",
      returnUrl: "http://x/return",
      idempotencyKey: "key-abcdef123456",
      adapterConfig: {},
    });
    expect(r.providerRef).toContain("sbx_p-123");
    expect(r.status).toBe("INITIATED");
    expect(r.redirectUrl).toBeTruthy();
  });

  it("recusa montante inválido", async () => {
    const r = await adapter.initiate({
      paymentId: "p-124",
      amountCents: 0,
      currency: "AOA",
      returnUrl: "http://x/return",
      idempotencyKey: "key-abcdef123456",
      adapterConfig: {},
    });
    expect(r.status).toBe("DECLINED");
  });
});

describe("SandboxAdapter.verifyWebhook (SEC-17)", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify({
    providerRef: "sbx_p-1",
    status: "CONFIRMED",
    amountCents: 5000,
  });

  function sign(body: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  it("aceita webhook com assinatura válida", () => {
    const payload = adapter.verifyWebhook(
      rawBody,
      { "x-sandbox-signature": sign(rawBody) },
      { webhookSecret: secret }
    );
    expect(payload).not.toBeNull();
    expect(payload!.providerRef).toBe("sbx_p-1");
    expect(payload!.status).toBe("CONFIRMED");
    expect(payload!.amountCents).toBe(5000);
  });

  it("rejeita assinatura inválida", () => {
    const payload = adapter.verifyWebhook(
      rawBody,
      { "x-sandbox-signature": "deadbeef" },
      { webhookSecret: secret }
    );
    expect(payload).toBeNull();
  });

  it("rejeita corpo modificado (assinatura não bate)", () => {
    const tampered = JSON.stringify({
      providerRef: "sbx_p-1",
      status: "CONFIRMED",
      amountCents: 1, // tentativa de manipulação
    });
    const payload = adapter.verifyWebhook(
      tampered,
      { "x-sandbox-signature": sign(rawBody) },
      { webhookSecret: secret }
    );
    expect(payload).toBeNull();
  });

  it("rejeita quando não há segredo configurado", () => {
    const payload = adapter.verifyWebhook(rawBody, { "x-sandbox-signature": sign(rawBody) }, {});
    expect(payload).toBeNull();
  });
});
