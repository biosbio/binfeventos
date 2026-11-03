# Parte 13 — Domínios 3-4 em código: inventário transacional + checkout

## Princípio de segurança aplicado (ênfase do utilizador)

**Senhas e dados sensíveis ficam sempre no backend.** Concretamente:

| Dado | Tratamento |
|---|---|
| Passwords | Argon2id; nunca saem do backend; nunca em logs/audit (`sanitizeForAudit`) |
| Preços, taxas, descontos, totais | **100% calculados no servidor**; o cliente envia apenas identificadores e quantidades; campos monetários enviados pelo cliente são ignorados (testes cobrem isto) |
| Expiração da reserva | Definida pelo servidor (10 min); o cliente nunca controla prazos |
| Chaves de idempotência | Aceitas do cliente (chave opaca) ou geradas no servidor |
| Segredo do QR (futuro, Parte 14) | Gerado no servidor; só o hash é persistido |
| `mfaSecret`, `passwordHash`, tokens | Nunca devolvidos por API; `select` explícito em todas as consultas |

## Ficheiros

| Ficheiro | Papel |
|---|---|
| `src/modules/inventory/schemas.ts` | Zod: tipos, lotes, holds — sem valores do cliente |
| `src/modules/inventory/service.ts` | Núcleo transacional: `FOR UPDATE`, idempotência, VERIFYING, expiração |
| `src/modules/sales/schemas.ts` | Checkout: hold + titulares; comprador vem da conta autenticada (nada monetário) |
| `src/modules/sales/service.ts` | Motor de encomendas: cálculo server-side, OrderStatus, canal |
| `src/app/api/marketplace/[[...action]]/route.ts` | Disponibilidade, holds, checkout, consulta, cancelamento |
| `src/app/api/catalog/[[...action]]/route.ts` | Tipos, lotes, job de expiração |
| `src/app/painel/eventos/[id]/ticket-inventory-manager.tsx` | Ecrã do organizador para criar tipos personalizados, definir quantidade e encerrar vendas |
| `tests/inventory-sales-schemas.test.ts` | Testes: cliente não pode injetar valores monetários |

### Configuração pelo organizador

Na criação de cada evento, o organizador define o preço e a quantidade do
bilhete normal; este tipo é criado atomicamente com o evento e a sessão inicial,
na moeda da organização. Depois, pode adicionar tipos de bilhete com nome,
categoria, descrição/condições, preço e exigência de identificação. Nomes e
descrições personalizadas permitem explicar entradas gratuitas, VIP, mesas,
combos e bilhetes infantis. Cada tipo tem preço, quantidade e limite por
comprador. A data do evento é definida na criação, como um dia ou vários dias;
tipos criados na gestão ficam ativos sem datas de lote até o organizador
terminar as vendas. O início das vendas depende da publicação do evento. Os
preços e moedas são determinados no servidor a partir da organização.

O detalhe público mostra as condições do tipo; a compra só é habilitada quando
há um lote aberto e inventário disponível. O checkout apresenta o preço
efetivo. Cupons e reserva de lugares/mesas numerados não fazem parte deste
fluxo de catálogo.

## Núcleo de inventário (Domínio 3)

### Reserva temporária (`createHold`)

```
TRANSATÇÃO:
  SELECT ... FOR UPDATE na linha de ticket_inventory
  → disponibilidade = total − reservado − vendido (dentro do lock)
  → valida limite por comprador (maxPerBuyer, no servidor)
  → valida estado do lote (OPEN)
  → incrementa reservedQuantity
  → cria InventoryHold com expiresAt = agora + 10min (servidor)
```

- **Exclusividade**: duas compras simultâneas não vendem o mesmo bilhete.
- **Idempotência**: `idempotencyKey` única; repetição devolve a mesma reserva.
- **Proteção em verificação**: `markHoldVerifying` muda para `VERIFYING` —
  estado que **nunca expira automaticamente** enquanto o pagamento não tem
  resultado definitivo.

### Expiração (`releaseExpiredHolds`)

Job idempotente: só expira estado `RESERVED`; `PENDING_PAYMENT` e `VERIFYING`
permanecem protegidos (regra crítica do documento mestre). Revalida estado
dentro de cada transação (múltiplos workers não duplicam).

## Checkout (Domínio 4)

### Cálculo financeiro (exclusivamente server-side)

```
unitPriceCents   = batch.priceCents ?? ticketType.basePriceCents  (base de dados)
lineSubtotal     = unitPrice × quantity
subtotal         = Σ linhas (mono-sessão no MVP)
serviceFee       = 0 (não cobrada ao comprador)
commission       = 0 até existir acordo aprovado para o evento
tax              = 0 (regra fiscal por mercado — Parte 14)
total            = subtotal + tax
```

Nenhum destes valores é aceito do cliente; o resumo é devolvido para
conferência, não para cálculo.

### Titulares (secção 12 do documento mestre)

- Comprador ≠ titular; o comprador responde pelo pagamento.
- Cada bilhete exige titular identificado: quantidade de attendees
  `== hold.quantity` para o tipo, validado no servidor.
- Não é obrigatório criar conta para cada titular (só nome é obrigatório;
  documento quando exigido pelo tipo).

### Estados usados

- Encomenda nasce `RESERVED` (hold passa a `PENDING_PAYMENT`).
- Cancelamento pré-pagamento liberta o inventário transacionalmente.
- Estados `PENDING_PAYMENT` → `UNDER_REVIEW` → `CONFIRMED` ficam para a
  Parte 14 (pagamentos), que chamará `confirmHold` na confirmação.

## Endpoints

| Método | Rota | Guard |
|---|---|---|
| POST | `/api/marketplace/availability` | público (catálogo) |
| POST | `/api/marketplace/holds` | `order:create` |
| POST | `/api/marketplace/holds/release` | autenticado (própria reserva) |
| POST | `/api/marketplace/orders` | `order:create` |
| GET | `/api/marketplace/orders/{id}` | comprador ou `order:read` |
| POST | `/api/marketplace/orders/{id}/cancel` | comprador ou `order:cancel` |
| POST | `/api/catalog/ticket-types` | `ticketType:manage` |
| POST | `/api/catalog/batches` | `batch:manage` |
| POST | `/api/catalog/run-expiration` | `inventory:read` (chamado por cron) |

## Pendências conscientes

1. `maxPerBuyer` hoje valida o total de reservas por sessão, não por
   comprador individual — na Parte 14 o hold ganha `buyerKey` (cookie/conta)
   para limite exato por pessoa.
2. As taxas da plataforma serão acordadas com cada organizador e aprovadas
   pela administração. Até existir esse acordo, não se cobra taxa por evento
   nem comissão por bilhete; nenhuma taxa de serviço é acrescentada ao preço
   pago pelo comprador.
3. `nextOrderNumber` usa `count()` — em alta concorrência trocar por
   sequência dedicada do PostgreSQL.
4. Webhooks de pagamento e `confirmHold` na confirmação — Parte 14.
