# Parte 14 — Domínios 5-7 em código: pagamentos, caixa e acesso

## Módulo payments (Domínio 5)

### Camada de adaptação (`adapter.ts`)

Interface `PaymentAdapter` normaliza: iniciação, reembolso, verificação de
webhook e consulta de estado. **Substituir prestador não exige reemissão de
bilhetes nem perde histórico.** Chaves do prestador vivem em `adapterConfig`
(resolvidas via gestor de segredos) — nunca hardcoded, nunca no cliente.

### Opção B — tentativas controladas

- `PaymentAttempt` numerado por `attemptNumber`; `idempotencyKey` única.
- Nova tentativa **bloqueia** as anteriores (`ACTIVE → BLOCKED`).
- Na confirmação: tentativa ativa → `COMPLETED`; restantes → `BLOCKED`.

### Opção C — pagamentos pendentes

- Webhook com estado `UNKNOWN` ou divergência de montante →
  `InventoryHold.VERIFYING` (inventário protegido; nunca expira sozinho) +
  `Payment.UNDER_REVIEW`.
- `manualReview` exige `payment:review` **e evidência escrita obrigatória**
  (mín. 10 caracteres, auditada): ninguém marca como paga sem evidência.

### Webhooks (SEC-17)

- Assinatura validada pelo adaptador antes de qualquer processamento.
- Montante do webhook comparado ao registado — divergência → revisão manual.
- Confirmação idempotente: repetição do webhook não duplica nada.

### Fluxo de confirmação (idempotente)

```
webhook CONFIRMED
  → Payment.status = CONFIRMED (revalidado em transação)
  → Order.status = CONFIRMED
  → hold consumido: reservedQuantity → soldQuantity
  → issueTicketsForOrder() — emite bilhetes (idempotente)
  → audit payment.confirmed
```

## Módulo access (Domínio 7, SEC-18)

| Regra | Implementação |
|---|---|
| QR imprevisível | Segredo `randomBytes(32)` no servidor; base guarda só SHA-256 (`qrSecretHash`) |
| Token devolvido 1x | `issueTicketsForOrder`/`getQrToken` devolvem o token uma vez; nunca persistido em claro |
| Reobter QR = rotação | `getQrToken` gera novo segredo e invalida o anterior (`qrRotatedAt`) |
| Validação 100% online | `validateEntry` consulta sempre a base; nenhuma aprovação offline |
| Transferência invalida QR | `decideTransfer` roda o segredo + substitui o titular |
| Motivos de recusa | INVALID_QR, ALREADY_USED, WRONG_SESSION, TICKET_CANCELLED, TICKET_REVOKED, IDENTITY_MISMATCH, NOT_EVENT_DAY |
| Reentrada | Só com `reentryAllowed` + saída registada (`lastExitAt`) |
| Transação atômica | Entrada concedida atualiza Ticket + cria AccessEvent na mesma transação |

## Módulo boxoffice (Domínio 6)

- **Venda presencial usa o motor central**: `boxOfficeSale` chama o mesmo
  `createOrder` (canal `BOX_OFFICE`, `shiftId` do turno) — inventário central
  atualizado imediatamente. Pagamento CASH confirmado na hora.
- **Turno**: `openShift` (fundo inicial, esperado = fundo), movimentos
  autorizados ajustam o esperado (`CASH_IN`/`CASH_OUT`/`REFUND_PAID`).
- **Fecho com diferença é permitido**: `closeShift` regista
  `differenceCents` + notas, cria `CashDeposit` em COUNTED e, quando há
  divergência, lança **CASH_DIFFERENCE no livro-razão** — nunca ignorada.

## Endpoints novos

| Método | Rota | Guard |
|---|---|---|
| POST | `/api/payments/initiate` | comprador ou `boxoffice:sell` |
| POST | `/api/payments/webhook/{code}` | público (assinatura validada) |
| POST | `/api/payments/review` | `payment:review` |
| GET | `/api/payments/pending` | `payment:review` |
| POST | `/api/access/validate` | `access:validate` |
| POST | `/api/access/transfer` | titular (comprador) |
| POST | `/api/access/transfer/decide` | `transfer:approve` |
| GET | `/api/access/tickets/{id}/qr` | titular (rotação) |
| POST | `/api/access/gates` | `gate:manage` |
| POST | `/api/boxoffice/shifts/open` | `shift:open` |
| POST | `/api/boxoffice/shifts/close` | `shift:close` |
| POST | `/api/boxoffice/shifts/movement` | `cash:movement` |
| POST | `/api/boxoffice/sale` | `boxoffice:sell` |

## Segurança dos dados (ênfase do utilizador, mantida)

- Montante de pagamento vem SEMPRE da encomenda na base; schema do cliente
  não tem campo monetário (testado).
- Webhook exige assinatura válida; corpo não é confiado sem validação.
- QR: token plano nunca persistido; rotação invalida anteriores.
- `sanitizeForAudit` em todos os registos de auditoria.

## Pendências conscientes

1. Adaptador concreto de prestador real (ex: Multicaixa Express) —
   implementar `PaymentAdapter` + registrar com `registerAdapter`.
2. Reembolsos (`Refund`) e liquidações (`Settlement`) com dupla aprovação —
   Parte 15 (módulo financeiro completo).
3. `reentryAllowed` configurável por evento/sessão.
4. Fuso horário do turno (`openedAtLocal`) simplificado no MVP.
