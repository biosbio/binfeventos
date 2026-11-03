import { test, expect } from "@playwright/test";
import { e2eCredentials, organizerBootstrap, buyerLogin } from "./helpers";
import { createHmac } from "crypto";

// ============================================================
// E2E: fluxo de compra completo (Parte 19)
// Marketplace (página) → disponibilidade → reserva → titulares →
// encomenda → pagamento sandbox → webhook assinado → bilhete
// com QR emitido → portaria valida entrada.
// ============================================================

test.describe("Fluxo completo de compra", () => {
  test("registo, compra, webhook, bilhete e portaria", async ({ page, request }) => {
    const creds = e2eCredentials();
    const boot = await organizerBootstrap(request, creds);
    const buyerCookie = await buyerLogin(request, creds);
    const buyerHeaders = { cookie: buyerCookie, "content-type": "application/json" };

    // --- 1. Catálogo público mostra o evento publicado
    await page.goto("/");
    const catalog = page.locator(".event-card", { hasText: "Show E2E" });
    await expect(catalog.first()).toBeVisible();

    // --- 2. Detalhe público do evento
    await page.goto(`/eventos/${boot.eventSlug}`);
    await expect(page.getByRole("heading", { name: "Show E2E" })).toBeVisible();

    // --- 3. Disponibilidade via API (lote aberto — bug fix Parte 19)
    const availability = await request.post("/api/marketplace/availability", {
      data: { sessionId: boot.sessionId },
    });
    expect(availability.ok()).toBeTruthy();
    const items = (await availability.json()).items as Array<{
      onSale: boolean; available: number; batchId: string; ticketTypeId: string;
    }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.onSale).toBe(true); // lote aberto pela nova rota
    expect(items[0]!.available).toBeGreaterThan(0);

    // --- 4. Reserva temporária (hold) pelo comprador
    const hold = await request.post("/api/marketplace/holds", {
      headers: buyerHeaders,
      data: {
        sessionId: boot.sessionId,
        ticketTypeId: items[0]!.ticketTypeId,
        batchId: items[0]!.batchId,
        quantity: 2,
      },
    });
    expect(hold.ok()).toBeTruthy();
    const { holdId } = (await hold.json()) as { holdId: string };

    // --- 5. Encomenda com 2 titulares (comprador ≠ titular)
    const order = await request.post("/api/marketplace/orders", {
      headers: buyerHeaders,
      data: {
        holdId,
        buyerName: creds.buyerName,
        buyerEmail: creds.buyerEmail,
        attendees: [
          {
            ticketTypeId: items[0]!.ticketTypeId,
            fullName: "Titular Um E2E",
            documentType: "TEST",
            documentNumber: "E2E-001",
          },
          {
            ticketTypeId: items[0]!.ticketTypeId,
            fullName: "Titular Dois E2E",
            documentType: "TEST",
            documentNumber: "E2E-002",
          },
        ],
      },
    });
    expect(order.ok(), `API de encomenda (${order.status()}): ${await order.text()}`).toBeTruthy();
    const orderData = (await order.json()).order as {
      orderId: string; orderNumber: string; totalCents: number; status: string;
    };
    expect(orderData.status).toBe("RESERVED");
    // Total = 2 × 450000 + 5% taxa = 945000 (server-side)
    expect(orderData.totalCents).toBe(945_000);

    // --- 6. Iniciar pagamento sandbox
    const payment = await request.post("/api/payments/initiate", {
      headers: buyerHeaders,
      data: {
        orderId: orderData.orderId,
        providerCode: "sandbox",
        method: "MOBILE_MONEY",
      },
    });
    expect(payment.ok()).toBeTruthy();
    const paymentData = (await payment.json()) as { providerRef: string };
    expect(paymentData.providerRef).toBeTruthy();

    // --- 7. Webhook sandbox assinado (HMAC) confirma o pagamento
    const secret = process.env.SANDBOX_WEBHOOK_SECRET ?? "dev-only-secret";
    const rawBody = JSON.stringify({
      providerRef: paymentData.providerRef,
      status: "CONFIRMED",
      amountCents: orderData.totalCents, // montante registado
    });
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const webhook = await request.post("/api/payments/webhook/sandbox", {
      headers: { "content-type": "application/json", "x-sandbox-signature": signature },
      data: rawBody,
    });
    expect(webhook.ok()).toBeTruthy();

    // --- 8. Encomenda confirmada; bilhetes emitidos na base
    const confirmed = await request.get(`/api/marketplace/orders/${orderData.orderId}`, {
      headers: buyerHeaders,
    });
    expect(confirmed.ok(), `Consulta da encomenda (${confirmed.status()}): ${await confirmed.text()}`).toBeTruthy();
    const confirmedOrder = (await confirmed.json()).order as {
      status: string;
    };
    expect(confirmedOrder.status).toBe("CONFIRMED");

    // --- 9. A minha conta (UI) mostra a encomenda
    await page.context().addCookies([
      {
        name: "binf_session",
        value: extractCookieValue(buyerCookie),
        url: "http://localhost:3000",
      },
    ]);
    await page.goto("/minha-conta");
    await expect(page.getByText(orderData.orderNumber)).toBeVisible();

    // --- 10. Bilhetes emitidos; QR SVG gerado no servidor
    const myTickets = await request.get("/api/access/my-tickets", { headers: buyerHeaders });
    expect(myTickets.ok()).toBeTruthy();
    const tickets = (await myTickets.json()).tickets as { id: string; status: string }[];
    expect(tickets).toHaveLength(2);
    expect(tickets.every((ticket) => ticket.status === "ISSUED")).toBe(true);
    const ticketId = tickets[0]!.id;
    await page.goto(`/bilhetes/${ticketId}`);
    await expect(page.locator("img[alt='QR Code do bilhete']")).toBeVisible();

    // --- 11. Portaria: validar entrada exige conta de validador
    // (fluxo de validador fica para suíte própria; aqui garantimos que
    // a rota de QR devolve SVG e o bilhete existe com estado ISSUED)
    const qr = await request.get(`/api/access/tickets/${ticketId}/qr-image`, {
      headers: buyerHeaders,
    });
    expect(qr.ok()).toBeTruthy();
    expect((qr.headers()["content-type"] ?? "")).toContain("image/svg+xml");
  });
});

/** Extrai o valor do cookie de sessão do header set-cookie. */
function extractCookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0] ?? "";
  return pair.split("=")[1] ?? "";
}
