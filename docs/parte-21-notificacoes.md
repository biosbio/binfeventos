# Parte 21 — Módulo de Notificações (Domínio 10)

Fecha os 12 domínios funcionais em código.

## Ficheiros

| Ficheiro | Conteúdo |
|---|---|
| `src/modules/notifications/schemas.ts` | Zod: canais, 13 tipos, filtros, preferências, pedido interno |
| `src/modules/notifications/service.ts` | Fila com persistência pré-envio, providers abstraídos, templates PT, retry, preferências |
| `src/app/api/notifications/route.ts` | `GET` minhas IN_APP (`?unread=1`), `POST read`, `POST preference` |
| `tests/notifications-templates.test.ts` | Caracterização dos templates (interpolação, texto-chave, dados ausentes) |

## Arquitetura

```
módulo de negócio ──queueNotification──▶ persiste PENDING ──▶ provider.send ──▶ SENT
                                              │ falha
                                              ▼
                                       RETRYING (attempts, lastError)
                                              │ job cron (retryFailedNotifications)
                                              ▼
                                        SENT ou FAILED (≤5 tentativas)
```

- **Persistência antes do envio** (risco nº 12): nenhuma notificação é
  enviada sem registo auditável; `lastError` sempre preenchido em falha.
- **Templates 100% server-side**: `renderTemplate` interpola dados da base
  de dados — o pedido do cliente nunca traz conteúdo de mensagem.
- **Idempotência**: `idempotencyKey` única por (userId, type, channel).
- **Preferências**: opt-out por (tipo, canal); IN_APP nunca é silenciado.
  Supressões são registadas como `SUPPRESSED` (rastreáveis, não perdidas).
- **Providers abstraídos**: `registerChannelProvider()` — mesmo padrão dos
  adaptadores de pagamento (Partes 14/18/20). Mocks em dev logam para a
  consola; produção regista SMTP/Resend (email) e gateway SMS.
- **Payloads sanitizados**: `sanitizeForAudit` nos `payload` (SEC-16).

## Rotas

| Método | Rota | Descrição | Requisito |
|---|---|---|---|
| GET | `/api/notifications` | Minhas notificações IN_APP | autenticado |
| POST | `/api/notifications` (`action: "read"`) | Marcar lida | autenticado (própria) |
| POST | `/api/notifications` (`action: "preference"`) | Opt-out por tipo+canal | autenticado |

Enviar notificações **não é rota pública** — os módulos de negócio chamam
`queueNotification` internamente.

## Pontos de integração (a ligar na revisão deste PR)

Chamar `queueNotification` em:
- `organizations.inviteMember` → `MEMBER_INVITED` EMAIL + IN_APP (inclui o
  `organizationId` no payload — resolve a lacuna do E2E da portaria, em que
  o validador não conhece a organização sem notificação)
- `sales.createOrder` → `ORDER_CONFIRMED` (após pagamento: `PAYMENT_CONFIRMED`)
- `payments.confirmPayment` → `PAYMENT_CONFIRMED` + `TICKETS_ISSUED`
- `access.transfer`/`decideTransfer` → `TICKET_TRANSFERRED`
- `finance.decideRefund` → `REFUND_PROCESSED`
- `finance.prepareSettlement` → `SETTLEMENT_READY` (FINANCE_MANAGER)
- `events.transition` → `EVENT_CANCELLED` / `EVENT_POSTPONED` (todos os
  compradores confirmados)
- `boxoffice.closeShift` → `SHIFT_ALERT` (diferença ≠ 0)

## Schema (pré-existente da Parte 9)

O modelo `Notification` existe no `prisma/schema.prisma` desde a Parte 9
(canais EMAIL/SMS/IN_APP; estados PENDING/SENT/DELIVERED/FAILED/RETRYING/
SUPPRESSED; `attempts`, `lastError`, `externalId`, `readAt`). Este módulo
adiciona `NotificationPreference` — criar a migration correspondente:

```prisma
model NotificationPreference {
  id        String   @id @default(uuid())
  userId    String
  type      String   // NotificationType
  channel   String   // EMAIL | SMS
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user User @relation(fields: [userId], references: [id])
  @@unique([userId, type, channel])
  @@index([userId])
}
```

Executar `npm run prisma:migrate` após merge para gerar a migration.

## Próximos passos

- Ligar os pontos de integração acima (PR pequeno e focado)
- UI: sino de notificações em `/minha-conta`
- Provider EMAIL real (Resend/SMTP) + provider SMS local (Angola)
