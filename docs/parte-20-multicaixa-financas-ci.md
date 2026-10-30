# Parte 20 — CI com E2E, portaria E2E, Multicaixa Express e painel financeiro

## 1. Adaptador Multicaixa Express (Angola) ✅

`src/modules/payments/adapters/multicaixa-express.ts` + registro no arranque
(`adapters/index.ts`) + testes (`tests/payments-multicaixa-adapter.test.ts`).

| Regra | Implementação |
|---|---|
| Contrato `PaymentAdapter` | `initiate`/`refund`/`verifyWebhook`/`queryStatus` — substituir prestador sem tocar na orquestração |
| Config via segredos | `baseUrl`, `merchantToken`, `posId`, `webhookSecret` em `adapterConfig` (nunca no código) |
| Config incompleta → `UNKNOWN` | Inventário protegido (Opção C), nunca falha silenciosamente |
| Prestador indisponível → `UNKNOWN` | Nunca `CANCELLED` — encomenda não é morta por falha do prestador |
| Webhook | HMAC-SHA256 em tempo constante; `PAID→CONFIRMED`, `FAILED→DECLINED`, desconhecido→`UNKNOWN` |
| Valores | EMIS em kwanzas decimais; plataforma em cêntimos — conversão no servidor com `Math.round(amount*100)` (testada: 1000 kz → 100000 cêntimos) |
| Reembolso | PROCESSING com nota operacional (portal EMIS) — o fluxo financeiro (Parte 15) registar e o operador confirmar |

⚠️ A pesquisa da API oficial (EMIS) confirma que os detalhes de endpoint
variam por integração/contrato — validar os URLs exatos com a EMIS ao
assinar. O contrato do adaptador está protegido por testes, pelo que trocar
URLs/payload não afeta o resto do sistema.

## 2. Painel financeiro web ✅

| Página | Conteúdo |
|---|---|
| `/financas` | KPIs agregados (vendas 30d, reembolsos a analisar, liquidações pendentes, reservas ativas), liquidações recentes, livro-razão (últimos 30 lançamentos, compensatórios marcados) |
| `/financas/acoes` | Preparar liquidação (período), aprovar/rejeitar (dupla aprovação), marcar paga — cliente mínimo, valores sempre do servidor |

Guard: `ledger:read` (leitura) e `settlement:prepare`/`settlement:approve`
(ações). Quem prepara não aprova — o servidor recusa.

## 3. E2E da portaria ⚠️ (conteúdo pronto; escrita falhou no conector)

O ficheiro `e2e/gate-flow.spec.ts` no repositório contém placeholders que
devem ser substituídos pela versão correta. A versão definitiva cobre:

1. Convite `TICKET_VALIDATOR` → aceitação com `organizationId` do bootstrap.
2. Compra + webhook → bilhete `CONFIRMED`.
3. Porta na sessão de amanhã + porta em sessão ao-vivo.
4. QR do comprador via `GET /api/access/tickets/{id}/qr` (rotação).
5. QR inválido → `INVALID_QR` (API + UI `/portaria`).
6. QR real antes do dia do evento → `NOT_EVENT_DAY`.
7. QR real em porta de outra sessão → `WRONG_SESSION`.
8. Comprador sem `access:validate` → `403` (ABAC).

Substituir o conteúdo do ficheiro por:

```ts
// e2e/gate-flow.spec.ts — substituir integralmente
import { test, expect, APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";
import { e2eCredentials, organizerBootstrap, registerAndLogin } from "./helpers";

test.describe("Portaria — fluxo completo do validador", () => {
  test("convite, validador, recusas e isolamento ABAC", async ({ page, request }) => {
    const creds = e2eCredentials();
    const boot = await organizerBootstrap(request, creds);
    const orgHeaders = { cookie: boot.organizerCookie, "content-type": "application/json" };

    const validatorEmail = `validator-${Date.now()}@e2e.test`;
    await registerAndLogin(request, validatorEmail, creds.password);
    const invite = await request.post("/api/organizations/members/invite", {
      headers: orgHeaders,
      data: { email: validatorEmail, roleName: "TICKET_VALIDATOR" },
    });
    expect(invite.ok()).toBeTruthy();

    const validatorLogin = await registerAndLogin(request, validatorEmail, creds.password);
    const validatorCookie = validatorLogin.headers()["set-cookie"] ?? "";
    const validatorHeaders = { cookie: validatorCookie, "content-type": "application/json" };

    const accept = await request.post("/api/organizations/members/accept", {
      headers: validatorHeaders,
      data: { organizationId: boot.organizationId },
    });
    expect(accept.status()).toBe(200);

    const buyerLogin = await registerAndLogin(request, creds.buyerEmail, creds.password);
    const buyerCookie = buyerLogin.headers()["set-cookie"] ?? "";
    const buyerHeaders = { cookie: buyerCookie, "content-type": "application/json" };

    const availability = (await (
      await request.post("/api/marketplace/availability", {
        data: { sessionId: boot.sessionId },
      })
    ).json()) as { items: { ticketTypeId: string; batchId: string }[] };

    const hold = await request.post("/api/marketplace/holds", {
      headers: buyerHeaders,
      data: {
        sessionId: boot.sessionId,
        ticketTypeId: availability.items[0]!.ticketTypeId,
        batchId: availability.items[0]!.batchId,
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
        attendees: [
          { ticketTypeId: availability.items[0]!.ticketTypeId, fullName: "Titular Portaria E2E" },
        ],
      },
    });
    const orderData = (await order.json()).order as { orderId: string; totalCents: number };

    const payment = await request.post("/api/payments/initiate", {
      headers: buyerHeaders,
      data: { orderId: orderData.orderId, providerCode: "sandbox", method: "MOBILE_MONEY" },
    });
    const { providerRef } = (await payment.json()) as { providerRef: string };

    const secret = process.env.SANDBOX_WEBHOOK_SECRET ?? "dev-only-secret";
    const rawBody = JSON.stringify({
      providerRef,
      status: "CONFIRMED",
      amountCents: orderData.totalCents,
    });
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    await request.post("/api/payments/webhook/sandbox", {
      headers: { "content-type": "application/json", "x-sandbox-signature": signature },
      data: rawBody,
    });

    const myOrders = await request.get(`/api/marketplace/orders/${orderData.orderId}`, {
      headers: buyerHeaders,
    });
    const confirmed = (await myOrders.json()).order as {
      status: string;
      tickets: { id: string }[];
    };
    expect(confirmed.status).toBe("CONFIRMED");
    const ticketId = confirmed.tickets[0]!.id;

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

    const liveSession = await request.post(`/api/events/${boot.eventId}/sessions`, {
      headers: orgHeaders,
      data: {
        eventId: boot.eventId,
        venueId: boot.venueId,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        doorsOpenAt: new Date(Date.now() - 120_000).toISOString(),
      },
    });
    expect(liveSession.ok()).toBeTruthy();
    const liveGateCode = `LIVE-E2E-${Date.now()}`;
    await request.post("/api/access/gates", {
      headers: orgHeaders,
      data: {
        venueId: boot.venueId,
        code: liveGateCode,
        name: "Porta ao-vivo",
        gateType: "ENTRY",
        sessionId: (await liveSession.json()).session.id,
      },
    });

    const token = await getQrToken(request, buyerHeaders, ticketId);
    expect(token.length).toBeGreaterThanOrEqual(20);

    const bad = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: "x".repeat(48), gateCode, identityVerified: true },
    });
    const badResult = (await bad.json()) as { allowed: boolean; reason?: string };
    expect(badResult.allowed).toBe(false);
    expect(badResult.reason).toBe("INVALID_QR");

    await page.context().addCookies([
      { name: "binf_session", value: extractCookieValue(validatorCookie), url: "http://localhost:3000" },
    ]);
    await page.goto("/portaria");
    await page.fill("#gate", gateCode);
    await page.fill("#qr", "x".repeat(48));
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByText("RECUSADO", { exact: false })).toBeVisible();

    const entry = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: token, gateCode, identityVerified: true },
    });
    const entryResult = (await entry.json()) as { allowed: boolean; reason?: string };
    expect(entryResult.allowed).toBe(false);
    expect(entryResult.reason).toBe("NOT_EVENT_DAY");

    const wrong = await request.post("/api/access/validate", {
      headers: validatorHeaders,
      data: { qrToken: token, gateCode: liveGateCode, identityVerified: true },
    });
    const wrongResult = (await wrong.json()) as { allowed: boolean; reason?: string };
    expect(wrongResult.allowed).toBe(false);
    expect(wrongResult.reason).toBe("WRONG_SESSION");

    const noPerm = await request.post("/api/access/validate", {
      headers: buyerHeaders,
      data: { qrToken: token, gateCode, identityVerified: true },
    });
    expect(noPerm.status()).toBe(403);
  });
});

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

function extractCookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0] ?? "";
  return pair.split("=")[1] ?? "";
}
```

Nota: os helpers (`e2e/helpers.ts`) já devolvem `organizationId` e `venueId`.

## 4. CI com E2E ⚠️ (criar manualmente no GitHub)

O conector não conseguiu escrever em `.github/workflows/` (provável falta da
permissão `workflow` no token do GitHub). Criar manualmente o ficheiro
`.github/workflows/ci.yml` com:

```yaml
name: CI
on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]
jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: binf_test
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/binf_test?schema=public
      SANDBOX_WEBHOOK_SECRET: ci-secret-4f7a
      ADMIN_EMAIL: admin@binf.local
      ADMIN_PASSWORD: CiAdmin!2026x
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx prisma migrate deploy
      - run: npm run db:seed
      - run: npm run typecheck
      - run: npm run test
      - run: npm run lint
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
```

Alternativa: renovar a ligação GitHub em Conta → Conectores com a permissão
`workflow` ativada, e o agente passa a poder escrever o ficheiro.

## 5. Segurança mantida

- Adaptador MCX: chaves só via `adapterConfig` (gestor de segredos).
- Painel financeiro: agregados mínimos, `select` explícito, guard `ledger:read`.
- E2E: usa apenas APIs reais; nenhuma escrita direta à base.
