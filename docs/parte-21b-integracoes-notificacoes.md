# Parte 21b — Integrações de notificações (Domínio 10)

Liga `queueNotification` aos pontos de negócio. Continuação do PR da Parte 21.

## Integrações entregues

| Ponto de negócio | Notificação | Canais | Idempotência |
|---|---|---|---|
| `organizations.inviteMember` | `MEMBER_INVITED` | EMAIL + IN_APP | `member-invited:{membershipId}` |
| `payments.confirmPayment` (webhook) | `PAYMENT_CONFIRMED` + `TICKETS_ISSUED` | EMAIL + IN_APP | `payment-confirmed:{paymentId}` / `tickets-issued:{orderId}` |
| `payments.manualReview` (CONFIRM) | idem | idem | idem |
| `finance.decideRefund` (aprovação) | `REFUND_PROCESSED` | EMAIL + IN_APP | `refund-processed:{refundId}` |

## Princípio de robustez (risco nº 12)

Todas as integrações são **best-effort**: a notificação nunca desfaz a
operação de negócio. Padrões:

- `payments`: a lógica vive em `src/modules/payments/notify.ts`
  (bridge isolada, fácil de testar); chamada com `Promise.allSettled`
  após emissão de bilhetes.
- `organizations`: `queueNotification(...).catch(() => undefined)` —
  o convite é persistido mesmo que o email falhe (fica RETRYING).
- `finance`: notificação após o `writeAudit` do reembolso concluído.

## Payload MEMBER_INVITED (resolve a lacuna do E2E)

O payload inclui `organizationId` + `orgName` + `roleName`. O convidado
passa a conhecer a organização pela notificação IN_APP — na UI futura,
o botão "Aceitar convite" lê o `organizationId` diretamente do payload,
sem listagens de convites (a lacuna apontada no E2E da portaria).

## Ficheiros

| Ficheiro | Alteração |
|---|---|
| `src/modules/organizations/service.ts` | `inviteMember` notifica (TODO Domínio 10 resolvido) |
| `src/modules/payments/notify.ts` | **novo** — bridge PAYMENT_CONFIRMED/TICKETS_ISSUED |
| `src/modules/payments/service.ts` | chama `notifyPaymentConfirmed` em `confirmPayment` e `manualReview` CONFIRM |
| `src/modules/finance/refunds.ts` | `decideRefund` aprovado notifica REFUND_PROCESSED |
| `tests/notifications-integration.test.ts` | **novo** — caracterização das chaves de idempotência |

## Integrações futuras (não bloqueiam este PR)

- `events.transition` → `EVENT_CANCELLED` / `EVENT_POSTPONED` (todos os
  compradores confirmados — exige consulta em lote, PR próprio)
- `finance.prepareSettlement` → `SETTLEMENT_READY` (FINANCE_MANAGER)
- `boxoffice.closeShift` → `SHIFT_ALERT` (diferença ≠ 0)

## Verificação

- `npm run typecheck` — confirma imports e tipos
- `npm run test` — roda a caracterização nova
- E2E da portaria (PR #1) passa inalterado: o convite notifica mas o
  fluxo de aceitação continua a usar o `organizationId` do bootstrap.
