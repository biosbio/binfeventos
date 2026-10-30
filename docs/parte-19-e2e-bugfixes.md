# Parte 19 — E2E (Playwright) e correções de bugs

## Bugs corrigidos ao preparar o E2E

### Bug 1 — MFA do admin impossibilitava login
`prisma/seed.ts` criava o admin com `mfaEnabled: true` mas **sem
`mfaSecret`** → `loginUser` devolvia sempre `MFA_MISCONFIGURED`.
Correção: o seed gera segredo TOTP real (`otplib`) e imprime a URL
otpauth **apenas em dev** para registo na app autenticadora. Em
produção, criar o admin por fluxo próprio interativo.

### Bug 2 — Lotes nunca ficavam à venda
`createBatch` gravava `status: "SCHEDULED"` e **não existia rota para
mudar o estado** → `getAvailability` devolvia sempre `onSale: false` →
nenhuma venda era possível (checkout morto).

Correção:
- `transitionBatch(ctx, batchId, to)` em `inventory/service.ts` com
  validações: escopo da organização, janela de comercialização, SOLD_OUT
  só fecha, transições auditadas (antes/depois).
- Rota `POST /api/catalog/batches/status` (`batch:manage`).

## Suíte E2E (Playwright)

| Ficheiro | Cobre |
|---|---|
| `playwright.config.ts` | webServer dev :3000, sequencial, chromium |
| `e2e/helpers.ts` | Bootstrap organizador via API: conta → org → recinto → evento → sessão futura → publicação → tipo → lote **aberto**; comprador |
| `e2e/purchase-flow.spec.ts` | Catálogo UI → detalhe → disponibilidade → hold → encomenda (2 titulares, total 945 000 cêntimos verificado server-side) → pagamento sandbox → **webhook HMAC assinado** → encomenda CONFIRMED → /minha-conta mostra → bilhete com QR SVG (content-type verificado) |
| `e2e/security.spec.ts` | Password fraca recusada (422); login inválido com mensagem genérica; injeção de `totalCents`/`priceCents` ignorada na resposta |

### Como correr

```bash
npm run db:seed              # prestadores sandbox/cash
npx playwright install chromium
npm run test:e2e             # arranca o dev server automaticamente
```

### Verificações financeiras do E2E

- Total esperado calculado no teste como **945 000 cêntimos**
  (2 × 4 500,00 + 5% taxa) — confirma o cálculo 100% server-side.
- Webhook usa HMAC real (`SANDBOX_WEBHOOK_SECRET`), provando a
  verificação de assinatura de ponta a ponta.

## Princípios mantidos

- Helpers E2E usam as mesmas APIs do cliente real; nada de acesso direto
  à base nas asserções de fluxo.
- Segredos por env; o E2E lê `SANDBOX_WEBHOOK_SECRET` como o adaptador.
- `fullyParallel: false` (fluxos partilham estado na base).

## Próximos passos

- E2E da portaria completa (conta de validador + validação QR real).
- Adicionar `test:e2e` ao CI (junto ao ficheiro manual da Parte 18).
- Screenshots/trace em falhas já ativos (`retain-on-failure`).
