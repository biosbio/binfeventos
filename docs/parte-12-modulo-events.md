# Parte 12 — Módulo events: eventos, sessões e recintos em código

Primeira implementação completa de domínio de negócio sobre a fundação
(Partes 10-11), cobrindo o Domínio 2 do documento mestre.

## Ficheiros

| Ficheiro | Papel |
|---|---|
| `src/modules/events/state-machine.ts` | Máquina de estados: transições permitidas e rótulos humanos |
| `src/modules/events/schemas.ts` | Validação Zod (SEC-09): evento, sessão, recinto, slugs |
| `src/modules/events/service.ts` | CRUD + transições com regras de negócio + isolamento multiempresa |
| `src/app/api/events/[[...action]]/route.ts` | Rotas API com guards por permissão |
| `tests/events-state-machine.test.ts` | Testes da máquina de estados (proteção contra regressões) |
| `tests/events-schemas.test.ts` | Testes de validação |

## Endpoints

| Método | Rota | Guard |
|---|---|---|
| POST | `/api/events/create` | `event:create` |
| GET | `/api/events` (filtro `?status=`) | `event:read` |
| GET | `/api/events/{id}` | `event:read` |
| PATCH | `/api/events/{id}` | `event:update` |
| POST | `/api/events/{id}/sessions` | `session:manage` |
| POST | `/api/events/{id}/transition` | por destino (ver abaixo) |
| POST | `/api/events/venues` | `venue:manage` |

Guards de transição por destino:

| Destino | Permissão exigida |
|---|---|
| PUBLISHED, SUSPENDED, SOLD_OUT | `event:publish` |
| CANCELLED, POSTPONED | `event:cancel` |
| COMPLETED, CLOSED | `org:manage` (encerramento é decisão administrativa) |

## Regras de negócio implementadas

1. **Transições validadas no servidor** — o cliente nunca decide estado;
   `transitionEvent` rejeita transições fora da tabela `EVENT_TRANSITIONS`
   com mensagem explícita (`Em preparação → Esgotado` etc.).
2. **Publicar exige sessão futura** — evento sem sessões futuras não pode
   ficar PUBLISHED.
3. **Sessões não podem começar no passado** (tolerância de 1h na criação).
4. **Eventos em estado terminal não são editáveis** (CANCELLED, COMPLETED,
   CLOSED) — protege o histórico de eventos concluídos.
5. **Cancelar/postergar com vendas confirmadas** registra no audit quantas
   encomendas são afetadas; o tratamento financeiro (reembolsos) fica no
   Domínio 5 — **cancelamento não apaga obrigações financeiras**.
6. **Isolamento multiempresa**: todo acesso passa por `scopedEvent()`,
   que devolve 404 neutro para eventos de outras organizações.
7. **slug único por organização** (`@@unique([organizationId, slug])`).
8. Toda mudança de estado gera `AuditLog` (antes/depois).

## Testes

```bash
npm run test
```

Cobrem: tabela completa de transições, estados terminais sem saída, sem
auto-transição, slugs, datas de sessão ordenadas, capacidade de recinto.

## Próximos passos

- Parte 13: Domínio 3 em código — inventário transacional (holds com
  `SELECT ... FOR UPDATE`, expiração por job, idempotência).
- Parte 14: Domínio 4 em código — checkout com cálculo server-side.
