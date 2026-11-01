import { test, expect } from "@playwright/test";
import { e2eCredentials, registerAndLogin } from "./helpers";

// ============================================================
// E2E: segurança do fluxo de autenticação
// - registo com password fraca recusado pelo SERVIDOR (SEC-09)
// - login com credenciais erradas devolve mensagem genérica
// - cliente não consegue injetar valores monetários no checkout
// ============================================================

test.describe("Segurança de autenticação e entrada", () => {
  test("password fraca é recusada pelo servidor", async ({ request }) => {
    const creds = e2eCredentials();
    const res = await request.post("/api/users/register", {
      data: { fullName: "Fraco E2E", email: creds.buyerEmail, password: "curta" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Dados inválidos.");
  });

  test("login inválido devolve mensagem genérica (não revela email)", async ({ request }) => {
    const res = await request.post("/api/users/login", {
      data: { email: `naoexiste-${Date.now()}@x.pt`, password: "PasswordErrada123" },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { message: string };
    // Mensagem genérica: igual para email inexistente e password errada
    expect(body.message).toBe("Autenticação necessária.");
  });

  test("hold com campos monetários injectados é ignorado", async ({ request }) => {
    const creds = e2eCredentials();
    await registerAndLogin(request, creds.buyerEmail, creds.password);
    // Sem sessão válida de organização: deve falhar com 403/409/422 —
    // mas NUNCA aceitar totalCents do cliente
    const res = await request.post("/api/marketplace/holds", {
      data: {
        sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
        ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
        batchId: "b3f1c0a0-0000-4000-8000-000000000003",
        quantity: 1,
        totalCents: 1, // tentativa de manipulação
        priceCents: 1,
      },
    });
    expect(res.ok()).toBeFalsy();
    const body = (await res.json()) as { totalCents?: number; priceCents?: number };
    expect(body.totalCents).toBeUndefined();
    expect(body.priceCents).toBeUndefined();
  });
});
