# Parte 15 — Módulo finance: reembolsos, liquidações e livro-razão

Completa o Domínio 5 em código, sobre a orquestração de pagamentos da
Parte 14.

## Reembolsos (`refunds.ts`)

| Regra | Implementação |
|---|---|
| Segregação de funções | `requestRefund` (refund:request) ≠ `decideRefund` (refund:approve); **quem solicita não pode aprovar** — regra auditada |
| Totais e parciais | `amountCents` validado contra `pago − reembolsado anterior` (nunca reembolsa a mais, nunca duplicado) |
| Associação à venda original | Refund liga `orderId` + `paymentId` com motivo e responsáveis |
| Efeito na encomenda | Total → `Order.REFUNDED` + bilhetes `CANCELLED`; parcial → `PARTIALLY_REFUNDED` |
| Inventário | Não reposto automaticamente (decisão comercial); registado para revisão |
| Livro-razão | Lançamento `REFUND` (crédito) imutável na aprovação |

## Liquidações (`ledger.ts`)

Cálculo 100% agregado na base (período, nunca valores do cliente):

```
gross        = Σ Order.totalCents (confirmadas no período)
commission   = Σ Order.commissionCents
providerFee  = 1,5% × gross (MVP; config por prestador depois)
net          = gross − commission − providerFee − refunded − chargebacks
payable      = max(0, net − reservas ativas)
```

**Dupla aprovação**: `prepareSettlement` (settlement:prepare) marca
`preparedByUserId`; `decideSettlement` (settlement:approve) **recusa se o
aprovador for o preparador**. Aprovação lança `SETTLEMENT` no razão.

## Reservas financeiras

- `createReserve` (reserve:manage): motivo + condições de libertação
  explícitas; lança `RESERVE`.
- `releaseReserve`: liberta com notas; lança `RESERVE_RELEASE`.
- Reservas ativas reduzem `payable` das liquidações seguintes.

## Livro-razão imutável

1. **Nunca apagar/sobrescrever**: não existe rota de update/delete de
   `FinancialLedgerEntry`.
2. **Correções = compensatórios**: `adjustLedger` cria `ADJUSTMENT` com
   `compensatesEntryId` → rastreia o original; não compensa compensatório.
3. Guard `ledger:adjust`; auditoria de cada ajuste.
4. Consulta somente leitura via `ledger:read`.

## Endpoints

| Método | Rota | Guard |
|---|---|---|
| POST | `/api/finance/refunds/request` | `refund:request` |
| POST | `/api/finance/refunds/decide` | `refund:approve` (segregação) |
| POST | `/api/finance/settlements/prepare` | `settlement:prepare` |
| POST | `/api/finance/settlements/decide` | `settlement:approve` (dupla) |
| POST | `/api/finance/settlements/paid` | `settlement:approve` |
| POST | `/api/finance/reserves` | `reserve:manage` |
| POST | `/api/finance/reserves/release` | `reserve:manage` |
| POST | `/api/finance/ledger/adjust` | `ledger:adjust` |
| GET | `/api/finance/ledger` | `ledger:read` |

## Pendências conscientes

1. Chamada real ao adaptador de reembolso do prestador dentro de
   `decideRefund` (quando existir adaptador concreto — o estado
   PROCESSING→COMPLETED está pronto para o fluxo assíncrono).
2. Chargeback workflow (prazos, evidências) — herda estes modelos.
3. Taxa do prestador fixa em 1,5% no MVP → configuração por prestador.
