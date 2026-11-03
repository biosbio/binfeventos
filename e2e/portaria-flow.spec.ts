// ============================================================
// E2E: portaria com conta de validador completa (Parte 20).
// Fluxo: convite TICKET_VALIDATOR → aceitação → portas → compra
// + webhook sandbox → recusas INVALID_QR (API+UI), NOT_EVENT_DAY,
// WRONG_SESSION, 403 sem access:validate (ABAC).
// O token QR vem da rota JSON do comprador (rotação por chamada).
// ============================================================

import { test, expect, APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";
import { e2eCredentials, organizerBootstrap, registerAndLogin } from "./helpers";

async function getQrToken(
  request: APIRequestContext,
  buyerHeaders: Record<string, string>,
  ticketId: string
): Promise<string> {
  const res = await request.get(`/api/access/tickets/${ticketId}/qr`, {
    headers: buyerHeaders,
  });
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()) as { qrToken: string };
  return data.qrToken;
}

function cookieValue(setCookie: string): string {
  return (setCookie.split(";")[0] ?? "").split("=")[1] ?? "";
}

test.describe("Portaria — fluxo completo do validador", () => {
  test("convite, validador, recusas e isolamento ABAC", async ({ page, request }) => {
    const creds = e2eCredentials();
    const boot = await organizerBootstrap(request, creds);
    const orgHeaders = { cookie: boot.organizerCookie, "content-type": "application/json" };

    // 1. Validador: registar, convidar, aceitar
    const validatorEmail = `validator-${Date.now()}@e2e.test`;
    await registerAndLogin(request, validatorEmail, creds.password);
    const invite = await request.post("/api/organizations/members/invite", {
      headers: orgHeaders,
      data: { email: validatorEmail, roleName: "TICKET_VALIDATOR" },
    });
    expect(invite.ok()).toBeTruthy();

    const vLogin = await registerAndLogin(request, validatorEmail, creds.password);
    const validatorHeaders = {
      cookie: vLogin.headers()["set-cookie"] ?? "",
      "content-type": "application/json",
    };

    const accept = await request.post("/api/organizations/members/accept", {
      headers: validatorHeaders,
      data: { organizationId: boot.organizationId },
    });
    expect(accept.status()).toBe(200);

    // 2. Compra de 1 bilhete + pagamento sandbox + webhook assinado
    const bLogin = await registerAndLogin(request, creds.buyerEmail, creds.password);
    const buyerHeaders = {
      cookie: bLogin.headers()["set-cookie"] ?? "",
      "content-type": "application/json",
    };

    const items = ((
      await (
        await request.post("/api/marketplace/availability", {
          data: { sessionId: boot.sessionId },
        })
      ).json()
    ).items ?? []) as { ticketTypeId: string; batchId: string }[];

    const hold = await request.post("/api/marketplace/holds", {
      headers: buyerHeaders,
      data: {
        sessionId: boot.sessionId,
        ticketTypeId: items[0]!.ticketTypeId,
        batchId: items[0]!.batchId,
        quantity: 1,
      },
    });
    const { holdId } = (await hold.json()) as { holdId: string };

    const order = await request.post("/api/marketplace/orders", {
      headers: buyerHeaders,
      data: {
        holdId,
        buyerName: creds.buyerName,
        buyerEmail: creds.buyerEmail,
        attendees: [{ ticketTypeId: items[0]!.ticketTypeId, fullName: "Titular Portaria E2E" }],
      },
    });
    const od = (await order.json()).order as { orderId: string; totalCents: number };

    const pay = await request.post("/api/payments/initiate", {
      headers: buyerHeaders,
      data: { orderId: od.orderId, providerCode: "sandbox", method: "MOBILE_MONEY" },
    });
    const { providerRef } = (await pay.json()) as { providerRef: string };

    const secret = process.env.SANDBOX_WEBHOOK_SECRET ?? "dev-only-secret";
    const raw = JSON.stringify({ providerRef, status: "CONFIRMED", amountCents: od.totalCents });
    const sig = createHmac("sha256", secret).update(raw).digest("hex");
    await request.post("/api/payments/webhook/sandbox", {
      headers: { "content-type": "application/json", "x-sandbox-signature": sig },
      data: raw,
    });

    const fetched = await request.get(`/api/marketplace/orders/${od.orderId}`, {
      headers: buyerHeaders,
    });
    const confirmed = (await fetched.json()).order as { status: string; tickets: { id: string }[] };
    expect(confirmed.status).toBe("CONFIRMED");
    const ticketId = confirmed.tickets[0]!.id;

    // 3. Portas: entrada na sessão de amanhã + porta em sessão ao-vivo
    const gateCode = `PORTA-E2E-${Date.now()}`;
    const gate = await request.post("/api/access/gates", {
      headers: orgHeaders,
      data: {
        venueId: boot.venueId,
        code: gateCode,
        name: "Porta principal",
        gateType: "ENTRY",
        sessionId: boot.sessionId,
      },
    });
    expect(gate.ok()).toBeTruthy();

    const live = await request.post(`/api/events/${boot.eventId}/sessions`, {
      headers: orgHeaders,
      data: {
        eventId: boot.eventId,
        venueId: boot.venueId,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        doorsOpenAt: new Date(Date.now() - 120_000).toISOString(),
      },
    });
    expect(live.ok()).toBeTruthy();
    const liveGateCode = `LIVE-E2E-${Date.now()}`;
    await request.post("/api/access/gates", {
      headers: orgHeaders,
      data: {
        venueId: boot.venueId,
        code: liveGateCode,
        name: "Porta ao-vivo",
        gateType: "ENTRY",
        sessionId: (await live.json()).session.id,
      },
    });

    // 4. QR real do comprador
    const token = await getQrToken(request, buyerHeaders, ticketId);
    expect(token.length).toBeGreaterThanOrEqual(20);

    // 5. QR inválido recusado (API)
    const bad = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: "x".repeat(48), gateCode, identityVerified: true },
    });
    const badR = (await bad.json()) as { allowed: boolean; reason?: string };
    expect(badR.allowed).toBe(false);
    expect(badR.reason).toBe("INVALID_QR");

    // 6. UI /portaria recusa token inválido
    await page.context().addCookies([
      {
        name: "binf_session",
        value: cookieValue(vLogin.headers()["set-cookie"] ?? ""),
        url: "http://localhost:3000",
      },
    ]);
    await page.goto("/portaria");
    await page.fill("#gate", gateCode);
    await page.fill("#qr", "x".repeat(48));
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByText("RECUSADO", { exact: false })).toBeVisible();

    // 7. QR real antes do dia do evento: NOT_EVENT_DAY
    const entry = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: token, gateCode, identityVerified: true },
    });
    const entryR = (await entry.json()) as { allowed: boolean; reason?: string };
    expect(entryR.allowed).toBe(false);
    expect(entryR.reason).toBe("NOT_EVENT_DAY");

    // 8. QR real em porta de outra sessão: WRONG_SESSION
    const wrong = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: token, gateCode: liveGateCode, identityVerified: true },
    });
    const wrongR = (await wrong.json()) as { allowed: boolean; reason?: string };
    expect(wrongR.allowed).toBe(false);
    expect(wrongR.reason).toBe("WRONG_SESSION");

    // 9. Sem access:validate: 403 (ABAC)
    const noPerm = await request.post("/api/access/validate", {
      headers: buyerHeaders,
      data: { qrToken: token, gateCode, identityVerified: true },
    });
    expect(noPerm.status()).toBe(403);
  });
});
