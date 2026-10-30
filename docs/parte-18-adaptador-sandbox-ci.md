# Parte 18 — Adaptador sandbox, correção de bug e CI

## 1. Correção de bug (venda a dinheiro / bilheteira física)

**Problema**: `boxOfficeSale` criava o Payment CASH já em `CONFIRMED` e
sem `providerRef`. O fluxo `confirmPayment` (que confirma a encomenda,
consome o hold, move inventário para vendido e **emite os bilhetes**)
saía cedo por não haver providerRef — os bilhetes nunca eram emitidos
nas vendas presenciais.

**Correção**: o pagamento CASH agora nasce em `INITIATED` com
`providerRef = cash-{paymentId}` e passa pelo `confirmPayment` normal.
Mesma garantia de idempotência; caixa do turno e auditoria atualizadas.

**Impacto**: nenhuma assinatura de API muda; comportamento agora correto.

## 2. Adaptador sandbox (mock de prestador)

`src/modules/payments/adapters/sandbox.ts` implementa `PaymentAdapter`:

| Operação | Comportamento sandbox |
|---|---|
| `initiate` | providerRef determinístico; INITIATED para valor > 0; DECLINED caso contrário; redirectUrl para autorização simulada |
| `refund` | COMPLETED imediato com refundRef |
| `verifyWebhook` | HMAC-SHA256 do corpo com `webhookSecret` (comparação em tempo constante); rejeita sem segredo configurado |
| `queryStatus` | UNKNOWN (produção consulta o prestador real) |

Bootstrap: `src/instrumentation.ts` chama `registerAllAdapters()` no
arranque do servidor. Adaptadores reais (ex: Multicaixa Express) seguem
o mesmo contrato — a arquitetura de adaptação da Parte 14 fica assim
**validada com um prestador concreto de referência**.

## 3. Testes novos

`tests/payments-sandbox-adapter.test.ts`:
- iniciação determinística e recusa de montante inválido;
- webhook aceito com assinatura válida;
- **corpo modificado rejeitado** (assinatura não bate — manipulação de
  montante bloqueada);
- assinatura inválida e ausência de segredo rejeitadas.

## 4. CI (pendente manual)

⚠️ A criação do ficheiro `.github/workflows/ci.yml` falhou por razões
técnicas do conector. Criar manualmente com este conteúdo:

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
          POSTGRES_DB: binf_eventos_test
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/binf_eventos_test?schema=public
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck
      - run: npm run test
      - run: npm run lint
```

## 5. Segredos (regra de ouro)

- `SANDBOX_WEBHOOK_SECRET` vem de variável de ambiente no seed — nunca
  hardcoded em produção.
- Adaptador sandbox não contém chaves; config chega via `adapterConfig`.

## Próximos passos

- Adaptador real de mercado (Multicaixa Express / carteiras locais).
- E2E do fluxo completo com Playwright (registo → evento → checkout →
  webhook sandbox → bilhete → portaria).
- Rate limit com Redis (substituir buckets em memória).
