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
- [ ] Parte 12 — Domínio 2 em código: eventos/sessões (máquina de estados)
- [ ] Parte 13 — Domínios 3-4 em código: inventário transacional + checkout
- [ ] Parte 14 — Domínios 5-7 em código: pagamentos, caixa, controlo de acesso
- [ ] Parte 15 — Domínio 12: Aplicações e experiência (web responsiva)

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

## Princípios estruturais

Multiempresa (isolamento por organização) · Internacionalização · Integração · Segurança · Rastreabilidade · Escalabilidade · Modularidade · Integridade · Configurabilidade

## Documentação

- [docs/parte-10-fundacao-codigo.md](docs/parte-10-fundacao-codigo.md) — fundação de código e estrutura
- [docs/parte-11-modulos-users-organizations.md](docs/parte-11-modulos-users-organizations.md) — módulos de negócio
- [docs/dominio-2-eventos.md](docs/dominio-2-eventos.md)
- [docs/dominio-3-bilhetes-inventario.md](docs/dominio-3-bilhetes-inventario.md)
- [docs/dominio-4-venda-checkout.md](docs/dominio-4-venda-checkout.md)
- [docs/dominio-5-pagamentos-financas.md](docs/dominio-5-pagamentos-financas.md)
- [docs/dominio-6-bilheteira-fisica.md](docs/dominio-6-bilheteira-fisica.md)
- [docs/dominio-7-controlo-acesso.md](docs/dominio-7-controlo-acesso.md)
- [docs/dominio-8-seguranca-antifraude.md](docs/dominio-8-seguranca-antifraude.md)
- [docs/dominios-9-11-administracao-notificacoes-relatorios.md](docs/dominios-9-11-administracao-notificacoes-relatorios.md)
