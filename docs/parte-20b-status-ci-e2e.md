# Parte 20b — CI e E2E da portaria: estado final

## O que ficou resolvido (PR #1)

**PR:** https://github.com/biosbio/binfeventos/pull/1
(branch `chore-ci-workflow` → `develop`)

### E2E da portaria ✅ completo

`e2e/portaria-flow.spec.ts` (novo, sem placeholders) + `e2e/gate-flow.spec.ts`
esvaziado. Cobre:

1. Convite `TICKET_VALIDATOR` → aceitação (com `organizationId` do bootstrap)
2. Compra + pagamento sandbox + webhook HMAC assinado → bilhete CONFIRMED
3. Porta na sessão de amanhã + porta em sessão ao-vivo
4. QR do comprador via rota JSON (rotação por chamada)
5. `INVALID_QR` — API **e UI** `/portaria`
6. `NOT_EVENT_DAY` (sessão abre amanhã)
7. `WRONG_SESSION` (porta de outra sessão)
8. `403` sem `access:validate` (ABAC)

### Pipeline CI ✅ pronto (1 passo manual)

O conector GitHub não tem o âmbito `workflow`, que o GitHub exige para
escrever em `.github/workflows/`. O ficheiro completo está em `ci.yml` na
raiz do PR, com a nota de instruções no topo.

**Após aceitar o PR:**
1. Copiar o conteúdo de `ci.yml` (abaixo da nota)
2. Criar `.github/workflows/ci.yml` na web e colar
3. Eliminar `ci.yml` da raiz
4. Push → o pipeline corre: Postgres 16 → prisma generate → migrate deploy
   → seed → typecheck → vitest → lint → playwright chromium → build →
   `npm run test:e2e`

**Alternativa definitiva:** renovar a ligação GitHub em
**Conta → Conectores** com a permissão de workflows ativada. Depois disso
o agente escreve diretamente em `.github/workflows/` e elimina o ficheiro
da raiz.

## Porquê esta abordagem

- Tentámos escrever `.github/workflows/ci.yml` no `develop` e num branch
  novo: o GitHub recusa sem o âmbito `workflow` (comportamento padrão da
  API para ficheiros de workflow).
- O ficheiro na raiz garante versionamento e revisão via PR em vez de
  instruções soltas em docs.
