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
- [ ] Parte 5 — Domínio 5: Pagamentos e Finanças
- [ ] Parte 6 — Domínio 6: Bilheteira Física
- [ ] Parte 7 — Domínio 7: Controlo de Acesso
- [ ] Partes 8-12 — Antifraude, Administração, Notificações, Relatórios, UX

## Princípios estruturais

Multiempresa (isolamento por organização) · Internacionalização · Integração · Segurança · Rastreabilidade · Escalabilidade · Modularidade · Integridade · Configurabilidade

## Documentação por domínio

- [docs/dominio-2-eventos.md](docs/dominio-2-eventos.md)
- [docs/dominio-3-bilhetes-inventario.md](docs/dominio-3-bilhetes-inventario.md)
- [docs/dominio-4-venda-checkout.md](docs/dominio-4-venda-checkout.md)
