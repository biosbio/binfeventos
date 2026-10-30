# Domínios 9-11 — Administração, Notificações e Relatórios

## Domínio 9 — Administração central

Administração global da plataforma: suspensão seletiva (conta, evento,
integração ou operação — regra especial de segurança nº 10), gestão de
assinaturas SaaS e parâmetros por organização e mercado.

### Assinaturas SaaS (modelo combinado aprovado)

- Planos: BASIC, PROFESSIONAL, ENTERPRISE.
- Estados: TRIALING → ACTIVE → PAST_DUE → CANCELLED/EXPIRED.
- `planLimits` (JSON): funcionalidades e limites configuráveis por plano.
- Receita de assinaturas identificada separadamente de comissões e taxas.

## Domínio 10 — Notificações

Comunicação com compradores, titulares e organizadores.

| Canal | Uso |
|---|---|
| EMAIL | Comprovativos, bilhetes, avisos (integração externa) |
| SMS | Códigos e notificações curtas (integração externa) |
| IN_APP | Alertas na área do utilizador |

Tipos essenciais: ORDER_CONFIRMED, PAYMENT_CONFIRMED, TICKETS_ISSUED,
TICKET_TRANSFERRED, REFUND_PROCESSED, EVENT_CANCELLED, EVENT_POSTPONED,
PAYMENT_REMINDER, ACCESS_ALERT, SECURITY_ALERT, SETTLEMENT_READY, SHIFT_ALERT.

Controlo de fiabilidade (risco "falha de notificações" — risco nº 12):
- Estados: PENDING → SENT → DELIVERED; FAILED e RETRYING com `attempts`.
- `lastError` registado; canais alternativos e escalonamento previstos.

## Domínio 11 — Relatórios

Indicadores comerciais, operacionais e financeiros como consultas agregadas
sobre os modelos existentes — sem novas tabelas no MVP:

| Indicador | Fonte |
|---|---|
| Vendas por evento/sessão | Order, OrderLine |
| Receita por canal | Order.channel |
| Comissões por organização | Order.commissionCents |
| Taxa de ocupação | Seat.status |
| Entradas e recusas | AccessEvent |
| Diferenças de caixa | CashShift.differenceCents |
| Alertas de fraude | FraudAlert |
| Pagamentos pendentes | Payment.status |

Exportações controladas (`DataExport`): registo de quem pediu, filtros,
status, ficheiro com URL assinada e **expiração** — em linha com a regra de
"exportação controlada" do módulo financeiro.
