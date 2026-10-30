# BINF EVENTOS

Plataforma internacional de gestão de eventos, bilhética, pagamentos e controlo de acesso.

## Stack (aprovada)

- TypeScript
- Next.js + React
- PostgreSQL
- Prisma ORM
- Monólito modular

## Domínios funcionais (12)

1. Utilizadores e organizações
2. Gestão de eventos
3. Bilhetes e inventário
4. Venda e checkout
5. Pagamentos e finanças
6. Bilheteira física
7. Controlo de acesso
8. Segurança e antifraude
9. Administração central
10. Notificações
11. Relatórios
12. Aplicações e experiência

## Estado do projeto

- [x] Parte 1 — Fundação + Domínio 1 (Utilizadores e Organizações): MER e schema Prisma
- [x] Parte 2 — Domínio 2: Eventos e Sessões (Event, EventSession, Venue)
- [x] Parte 3 — Domínio 3: Bilhetes e Inventário (TicketType, TicketBatch, SeatMap, Seat, InventoryHold)
- [x] Parte 4 — Domínio 4: Venda e Checkout (Order, OrderLine, OrderAttendee, SalesChannel)
- [x] Parte 5 — Domínio 5: Pagamentos e Finanças (Payment, PaymentAttempt, Refund, Chargeback, Settlement, FinancialReserve, FinancialLedgerEntry)
- [x] Parte 6 — Domínio 6: Bilheteira Física (BoxOfficeStation, CashShift, CashMovement, CashDeposit)
- [x] Parte 7 — Domínio 7: Controlo de Acesso (Ticket, TicketTransferRequest, AccessGate, AccessEvent)
- [x] Parte 8 — Domínio 8: Segurança e Antifraude (FraudRule, FraudAlert, SecurityIncident)
- [x] Parte 9 — Domínios 9-11: Administração (SaasSubscription), Notificações, Relatórios (DataExport)
- [x] Parte 10 — Fundação de código: setup, erros, segurança, auditoria, sessões/guards ABAC, permissões, seed
- [x] Parte 11 — Módulos users + organizations: registo, login, MFA TOTP, orgs, convites, papéis, testes
- [x] Parte 12 — Módulo events: CRUD, sessões, recintos, máquina de estados com guards e testes
- [x] Parte 13 — Módulos inventory + sales: reservas com FOR UPDATE, idempotência, checkout 100% server-side
- [x] Parte 14 — Módulos payments + access + boxoffice: adaptadores, Opção B/C, QR rotativo, turnos de caixa
- [x] Parte 15 — Módulo finance: reembolsos segregados, liquidações com dupla aprovação, livro-razão imutável
- [x] Parte 16 — Web responsiva: catálogo público, detalhe do evento, login (MFA), registo
- [x] Parte 17 — Ecrãs autenticados: minha conta, bilhete com QR SVG, checkout 3 passos, portaria, painel
- [x] Parte 18 — Bugfix CASH (emissão de bilhetes na bilheteira), adaptador sandbox com HMAC, testes

## Regra de ouro (segurança)

**Senhas e dados sensíveis ficam no backend.** O cliente envia apenas
identificadores e quantidades; preços, taxas, totais, prazos de expiração e
segredos são sempre calculados/gerados no servidor e nunca devolvidos em
consultas (`select` explícito em todas as APIs). A web não persiste
passwords, tokens de sessão ou QR no navegador — a sessão vive em cookie
HttpOnly gerado pelo backend, e o QR do bilhete chega apenas como imagem SVG
gerada no servidor.

## Como executar localmente

```bash
npm install
cp .env.example .env      # preencher DATABASE_URL
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
npm run dev
npm run test             # testes de caracterização (vitest)
```

## Páginas web

| Rota | Descrição | Tipo |
|---|---|---|
| `/` | Catálogo público de eventos publicados | Server |
| `/eventos/{slug}` | Detalhe: sessões, tipos de bilhete, regras | Server |
| `/login` | Login com MFA (campo dinâmico) | Client |
| `/register` | Registo (validação forte no servidor) | Client |
| `/minha-conta` | Encomendas e bilhetes do comprador | Server |
| `/bilhetes/{id}` | Bilhete com QR SVG rotativo | Server |
| `/checkout` | Compra em 3 passos (reserva → titulares → pagamento) | Client |
| `/portaria` | Validação de QR online com registo de recusas | Client |
| `/painel` | KPIs do organizador (vendas, pagamentos, alertas) | Server |

## Endpoints disponíveis

| Método | Rota | Descrição | Requisito |
|---|---|---|---|
| POST | `/api/users/register` | Registar conta | público |
| POST | `/api/users/login` | Login (com MFA se ativado) | público |
| POST | `/api/users/logout` | Terminar sessão | autenticado |
| POST | `/api/users/mfa/setup` | Iniciar MFA (gera QR otpauth) | autenticado |
| POST | `/api/users/mfa/confirm` | Confirmar MFA | autenticado |
| POST | `/api/users/mfa/disable` | Desativar MFA (exige código) | autenticado |
| POST | `/api/users/password` | Alterar password (revoga sessões) | autenticado |
| POST | `/api/organizations/create` | Criar organização | autenticado |
| GET | `/api/organizations/members` | Listar membros | `org:manage` |
| POST | `/api/organizations/members/invite` | Convidar membro | `org:invite` |
| POST | `/api/organizations/members/accept` | Aceitar convite | autenticado |
| POST | `/api/organizations/members/role` | Mudar papel | `org:role:assign` |
| POST | `/api/events/create` | Criar evento (começa DRAFT) | `event:create` |
| GET | `/api/events` | Listar eventos (`?status=`) | `event:read` |
| GET | `/api/events/{id}` | Detalhe do evento | `event:read` |
| PATCH | `/api/events/{id}` | Editar evento | `event:update` |
| POST | `/api/events/{id}/sessions` | Adicionar sessão | `session:manage` |
| POST | `/api/events/{id}/transition` | Transição de estado (por destino) | `event:publish` / `event:cancel` / `org:manage` |
| POST | `/api/events/venues` | Criar recinto | `venue:manage` |
| POST | `/api/marketplace/availability` | Disponibilidade da sessão | público |
| POST | `/api/marketplace/holds` | Criar reserva temporária | `order:create` |
| POST | `/api/marketplace/holds/release` | Libertar reserva | autenticado (própria) |
| POST | `/api/marketplace/orders` | Checkout (valores server-side) | `order:create` |
| GET | `/api/marketplace/orders/{id}` | Consultar encomenda | comprador / `order:read` |
| POST | `/api/marketplace/orders/{id}/cancel` | Cancelar encomenda | comprador / `order:cancel` |
| POST | `/api/catalog/ticket-types` | Criar tipo de bilhete | `ticketType:manage` |
| POST | `/api/catalog/batches` | Criar lote (+ inventário) | `batch:manage` |
| POST | `/api/catalog/run-expiration` | Job: expirar reservas | `inventory:read` (cron) |
| POST | `/api/payments/initiate` | Iniciar pagamento | comprador / `boxoffice:sell` |
| POST | `/api/payments/webhook/{code}` | Webhook do prestador | assinatura validada |
| POST | `/api/payments/review` | Opção C: revisão manual | `payment:review` |
| GET | `/api/payments/pending` | Pagamentos pendentes | `payment:review` |
| POST | `/api/access/validate` | Validar QR na portaria | `access:validate` |
| POST | `/api/access/transfer` | Solicitar transferência | titular |
| POST | `/api/access/transfer/decide` | Aprovar/rejeitar transferência | `transfer:approve` |
| GET | `/api/access/tickets/{id}/qr-image` | QR SVG (segredo rotado) | titular |
| POST | `/api/access/gates` | Criar porta/validador | `gate:manage` |
| POST | `/api/boxoffice/shifts/open` | Abrir turno | `shift:open` |
| POST | `/api/boxoffice/shifts/close` | Fechar turno (regista diferenças) | `shift:close` |
| POST | `/api/boxoffice/shifts/movement` | Movimento de caixa | `cash:movement` |
| POST | `/api/boxoffice/sale` | Venda presencial (motor central) | `boxoffice:sell` |
| POST | `/api/finance/refunds/request` | Solicitar reembolso | `refund:request` |
| POST | `/api/finance/refunds/decide` | Aprovar/rejeitar (segregação) | `refund:approve` |
| POST | `/api/finance/settlements/prepare` | Preparar liquidação | `settlement:prepare` |
| POST | `/api/finance/settlements/decide` | Dupla aprovação | `settlement:approve` |
| POST | `/api/finance/settlements/paid` | Marcar liquidação paga | `settlement:approve` |
| POST | `/api/finance/reserves` | Constituir reserva | `reserve:manage` |
| POST | `/api/finance/reserves/release` | Libertar reserva | `reserve:manage` |
| POST | `/api/finance/ledger/adjust` | Lançamento compensatório | `ledger:adjust` |
| GET | `/api/finance/ledger` | Consultar livro-razão | `ledger:read` |

## Princípios estruturais

Multiempresa (isolamento por organização) · Internacionalização · Integração · Segurança · Rastreabilidade · Escalabilidade · Modularidade · Integridade · Configurabilidade

## Documentação

- [docs/parte-10-fundacao-codigo.md](docs/parte-10-fundacao-codigo.md) — fundação de código
- [docs/parte-11-modulos-users-organizations.md](docs/parte-11-modulos-users-organizations.md) — módulos de negócio
- [docs/parte-12-modulo-events.md](docs/parte-12-modulo-events.md) — módulo events
- [docs/parte-13-inventario-checkout.md](docs/parte-13-inventario-checkout.md) — inventário transacional + checkout
- [docs/parte-14-pagamentos-caixa-acesso.md](docs/parte-14-pagamentos-caixa-acesso.md) — pagamentos, caixa, acesso
- [docs/parte-15-modulo-finance.md](docs/parte-15-modulo-finance.md) — reembolsos, liquidações, livro-razão
- [docs/parte-16-web-responsiva.md](docs/parte-16-web-responsiva.md) — interface web pública
- [docs/parte-17-ecras-autenticados.md](docs/parte-17-ecras-autenticados.md) — ecrãs autenticados
- [docs/parte-18-adaptador-sandbox-ci.md](docs/parte-18-adaptador-sandbox-ci.md) — bugfix CASH, sandbox, CI
- [docs/dominio-2-eventos.md](docs/dominio-2-eventos.md)
- [docs/dominio-3-bilhetes-inventario.md](docs/dominio-3-bilhetes-inventario.md)
- [docs/dominio-4-venda-checkout.md](docs/dominio-4-venda-checkout.md)
- [docs/dominio-5-pagamentos-financas.md](docs/dominio-5-pagamentos-financas.md)
- [docs/dominio-6-bilheteira-fisica.md](docs/dominio-6-bilheteira-fisica.md)
- [docs/dominio-7-controlo-acesso.md](docs/dominio-7-controlo-acesso.md)
- [docs/dominio-8-seguranca-antifraude.md](docs/dominio-8-seguranca-antifraude.md)
- [docs/dominios-9-11-administracao-notificacoes-relatorios.md](docs/dominios-9-11-administracao-notificacoes-relatorios.md)
