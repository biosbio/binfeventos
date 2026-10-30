# Domínio 3 — Bilhetes e Inventário

Tipos de bilhetes, lotes, lugares numerados e o núcleo comum de inventário
(disponibilidade, reservas temporárias, exclusividade, expiração e proteção
contra venda duplicada).

## MER — Domínio 3

```mermaid
erDiagram
    EVENT ||--o{ TICKET_TYPE : "define"
    TICKET_TYPE ||--o{ TICKET_BATCH : "tem lotes"
    TICKET_TYPE ||--o{ TICKET_INVENTORY : ""
    EVENT_SESSION ||--o{ TICKET_INVENTORY : ""
    TICKET_BATCH ||--o{ TICKET_INVENTORY : ""
    EVENT_SESSION ||--o{ INVENTORY_HOLD : "reserva"
    TICKET_TYPE ||--o{ INVENTORY_HOLD : ""
    EVENT_SESSION ||--o{ SEAT_MAP : "tem mapa"
    VENUE ||--o{ SEAT_MAP : ""
    SEAT_MAP ||--o{ SEAT : "tem lugares"
    TICKET_TYPE ||--o{ SEAT : "atribuído"

    TICKET_TYPE {
        uuid id PK
        uuid eventId FK
        string name
        enum category
        int basePriceCents
        json rules
        bool requiresIdentity
    }
    TICKET_BATCH {
        uuid id PK
        uuid ticketTypeId FK
        string name
        int quantity
        int priceCents
        datetime startsAt
        datetime endsAt
        int maxPerBuyer
    }
    TICKET_INVENTORY {
        uuid id PK
        uuid sessionId FK
        uuid ticketTypeId FK
        uuid batchId FK
        int totalQuantity
        int reservedQuantity
        int soldQuantity
    }
    INVENTORY_HOLD {
        uuid id PK
        uuid sessionId FK
        uuid ticketTypeId FK
        uuid batchId FK
        enum status
        int quantity
        string idempotencyKey UK
        datetime expiresAt
    }
    SEAT_MAP {
        uuid id PK
        uuid sessionId FK
        uuid venueId FK
    }
    SEAT {
        uuid id PK
        uuid seatMapId FK
        uuid ticketTypeId FK
        string section
        string row
        string label
        enum status
        uuid holdId FK
    }
```

## Estados da reserva temporária (HoldStatus)

Conforme documentação mestra, secção 11:

| Estado | Significado |
|---|---|
| RESERVED | Reserva temporária ativa, inventário protegido |
| PENDING_PAYMENT | Pagamento iniciado, aguarda confirmação |
| VERIFYING | Pagamento sem resultado definitivo — inventário permanece protegido |
| CONFIRMED | Venda confirmada, hold consumido em soldQuantity |
| EXPIRED | Prazo terminou, inventário libertado |
| CANCELLED | Cancelado pelo utilizador ou pelo sistema |

Regra crítica: **se existir transação financeira sem resultado definitivo, o
inventário permanece protegido** (hold não expira enquanto estado = VERIFYING).

## Categorias de bilhete

| Categoria | Observação |
|---|---|
| NORMAL | Preço base |
| VIP | Regras próprias |
| PREMIUM | Regras próprias |
| STUDENT | Documento exigível |
| CHILD | Condições de idade |
| FREE | Gratuito — emissão ainda exige titular |
| INVITE | Convite — pode exigir aprovação |
| SPECIAL_ACCESS | Acesso especial |

## Regras do núcleo de inventário

1. Disponibilidade calculada em **transação**:
   `available = totalQuantity - reservedQuantity - soldQuantity`.
2. Reservas temporárias com **prazo controlado pelo servidor**; o navegador
   nunca é fonte confiável de valores ou prazos.
3. `idempotencyKey` único em `InventoryHold` impede reservas duplicadas.
4. Exclusividade de venda de lugares: `Seat.status` transita
   AVAILABLE → RESERVED → SOLD; a transição é atômica com atualização de
   `TicketInventory`.
5. Varrimento de expiração por índice `expiresAt` (job periódico).
6. Limite por comprador aplicado no servidor (`maxPerBuyer`).
7. Isolamento multiempresa: `organizationId` em `InventoryHold` e consultas.

## Permissões do domínio

| Código | Descrição |
|---|---|
| `ticketType:manage` | Criar/editar tipos de bilhete |
| `batch:manage` | Criar/editar/encerrar lotes |
| `seats:manage` | Gerir mapas e lugares |
| `seats:block` | Bloquear/desbloquear lugares |
| `inventory:read` | Consultar disponibilidade |
| `inventory:hold` | Criar reservas (checkout) |
