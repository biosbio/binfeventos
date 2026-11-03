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
- [x] Parte 19 — Bugfixes MFA/lotes, gestão de estado de lotes, suíte E2E Playwright (fluxo completo + segurança)
- [x] Parte 20 — Adaptador Multicaixa Express (AO), painel financeiro web, E2E portaria, CI documentado

## Regra de ouro (segurança)

**Senhas e dados sensíveis ficam no backend.** O cliente envia apenas
identificadores e quantidades; preços, taxas, totais, prazos de expiração e
segredos são sempre calculados/gerados no servidor e nunca devolvidos em
consultas (`select` explícito em todas as APIs). A web não persiste
passwords, tokens de sessão ou QR no navegador — a sessão vive em cookie
HttpOnly gerado pelo backend, e o QR do bilhete chega apenas como imagem SVG
gerada no servidor. Chaves de prestadores (EMIS/Multicaixa) vivem em
`adapterConfig` via gestor de segredos — nunca no código.

## Como executar localmente

```bash
npm ci                   # instalação reproduzível a partir do package-lock.json
cp .env.example .env      # preencher DATABASE_URL e gerar os segredos
npm run prisma:generate
npm run prisma:migrate   # desenvolvimento; cria/aplica migrations pendentes
npm run db:seed
npm run dev
npm run test             # testes unitários/de caracterização (Vitest)

# E2E (Playwright) — requer seed aplicado
npx playwright install chromium
npm run test:e2e          # arranca o dev server automaticamente
```

## Páginas web

| Rota | Descrição | Tipo |
|---|---|---|
| `/` | Catálogo público de eventos publicados | Server |
| `/eventos/{slug}` | Detalhe: sessões, tipos de bilhete, regras | Server |
| `/login` | Login com MFA (campo dinâmico) | Client |
| `/forgot-password` | Recuperação de palavra-passe por email/SMS ou TOTP do administrador | Client |
| `/register` | Registo (validação forte no servidor) | Client |
| `/minha-conta` | Encomendas e bilhetes do comprador | Server |
| `/bilhetes/{id}` | Bilhete com QR SVG rotativo | Server |
| `/checkout` | Compra em 3 passos (reserva → titulares → pagamento) | Client |
| `/portaria` | Validação de QR online com registo de recusas | Client |
| `/painel` | KPIs do organizador (vendas, pagamentos, alertas), protegido por validação reforçada | Server |
| `/acesso-painel` | Reautenticação: password + TOTP para admin; OTP por email/SMS para organizador | Server/Client |
| `/admin` | Painel central da plataforma, exclusivo do administrador | Server |
| `/financas` | Liquidações + livro-razão (FINANCE_MANAGER) | Server |
| `/financas/acoes` | Preparar/aprovar/pagar liquidações (dupla aprovação) | Client |

## Prestadores de pagamento

| Código | Tipo | Notas |
|---|---|---|
| `sandbox` | Mock | Desenvolvimento; webhook HMAC assinado |
| `cash` | Físico | Bilheteira física (turnos de caixa) |
| `multicaixa-express` | Angola (EMIS) | QR/deeplink; UNKNOWN protege inventário; reembolso operacional via portal EMIS |

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
| POST | `/api/users/password-recovery-start` | Iniciar recuperação por email/SMS (resposta não revela se a conta existe) | público + rate limit |
| POST | `/api/users/password-recovery-confirm` | Confirmar código e definir nova password; administrador usa TOTP | público + rate limit |
| POST | `/api/users/panel-auth-start` | Enviar código de acesso de 6 dígitos por email/SMS | organizador autenticado |
| POST | `/api/users/panel-auth-verify` | Validar OTP do organizador ou password + TOTP do administrador | autenticado |
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
| POST | `/api/catalog/batches/status` | Abrir/pausar/fechar lote | `batch:manage` |
| POST | `/api/catalog/run-expiration` | Job: expirar reservas | `inventory:read` (cron) |
| POST | `/api/payments/initiate` | Iniciar pagamento | comprador / `boxoffice:sell` |
| POST | `/api/payments/webhook/{code}` | Webhook do prestador | assinatura validada |
| POST | `/api/payments/review` | Opção C: revisão manual | `payment:review` |
| GET | `/api/payments/pending` | Pagamentos pendentes | `payment:review` |
| POST | `/api/access/validate` | Validar QR na portaria | `access:validate` |
| POST | `/api/access/transfer` | Solicitar transferência | titular |
| POST | `/api/access/transfer/decide` | Aprovar/rejeitar transferência | `transfer:approve` |
| GET | `/api/access/tickets/{id}/qr` | QR token (rotação) | titular |
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

## Segurança e autenticação

- **Passwords:** hash com Argon2id; a aplicação não armazena passwords em texto simples.
- **Sessões:** tokens opacos; apenas o hash do token é persistido. A sessão é transportada em cookie HttpOnly e pode ser revogada.
- **MFA TOTP:** ativação, confirmação e desativação autenticadas. Os segredos TOTP são cifrados em repouso com AES-256-GCM; a chave de cifragem é fornecida por `MFA_ENCRYPTION_KEY`.
- **Acesso reforçado ao painel:** administradores confirmam password + TOTP; organizadores confirmam código de utilização única por email/SMS.
- **Recuperação de password:** utilizadores/organizadores elegíveis podem receber código por email ou SMS; o administrador recupera através do TOTP. Os códigos têm validade limitada, limite de tentativas e rate limiting. A resposta inicial não revela se uma conta está registada. A recuperação termina as sessões anteriores.
- **Rate limiting:** limites persistentes no PostgreSQL, partilhados entre instâncias.
- **Autorização:** permissões por organização (RBAC/ABAC), validação no servidor e segregação de funções em operações financeiras.
- **Auditoria:** operações sensíveis são registadas; o livro-razão é corrigido por lançamentos compensatórios, não por edição de lançamentos confirmados.

### Variáveis de ambiente

Consulte [.env.example](.env.example) como inventário dos nomes e formatos esperados. Nunca copie valores reais para o repositório.

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | Ligação PostgreSQL |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Conta administrativa inicial do seed; use uma password forte e exclusiva |
| `ADMIN_MFA_SECRET` | Segredo TOTP Base32 para configuração inicial/administração conforme o seed |
| `SESSION_SECRET` | Segredo da aplicação para hashing/derivação e proteção de operações sensíveis |
| `MFA_ENCRYPTION_KEY` | Chave hexadecimal de 64 caracteres (32 bytes) para AES-256-GCM |
| `SANDBOX_WEBHOOK_SECRET` | Segredo HMAC do adaptador sandbox |
| `PAYMENT_PROVIDER_CODE` | Prestador selecionado, por exemplo `sandbox` |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | URLs da aplicação |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_API_KEY` | Configuração de envio de email, conforme o adaptador/provedor usado |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_API_KEY` | Configuração de SMS, conforme o adaptador/provedor usado |

Gere os segredos no ambiente de destino com um gestor de segredos ou gerador criptograficamente seguro. Não reutilize os exemplos deste README ou de `.env.example`. A chave `MFA_ENCRYPTION_KEY` deve permanecer estável enquanto existirem segredos TOTP cifrados com ela; planeie qualquer rotação com migração controlada. Não exponha `.env`, códigos TOTP, códigos de recuperação, tokens, chaves ou payloads de webhook em logs, commits ou pedidos de suporte.

## Base de dados e migrations

As migrations Prisma versionadas na branch incluem:

- `20261101110000_add_inventory_hold_owner` — metadados de titularidade das reservas de inventário.
- `20261101111000_add_rate_limit_buckets` — armazenamento persistente de contadores de rate limit.
- `20261101112000_unique_ledger_compensation` — unicidade das referências de lançamentos compensatórios.
- `20261101113000_ticket_holder_identity` — identidade do titular do bilhete.
- `20261101190000_password_reset_codes` — códigos de recuperação de palavra-passe.

Em produção, aplique migrations versionadas com `npx prisma migrate deploy` depois de backup e validação do estado/dados existentes. Antes de aplicar a migration de unicidade do livro-razão, confirme que não existem referências compensatórias duplicadas. Antes do backfill de titularidade, verifique se existem emails que colidem após normalização para minúsculas. Faça primeiro um ensaio em staging com cópia representativa da base de dados; não use `prisma migrate dev` em produção.

## Qualidade e integração contínua

O workflow [CI](.github/workflows/main.yml) é executado em push e pull request para `develop` e `main`. O pipeline configura PostgreSQL 16 e Node.js 22.12.0, instala dependências com npm 11 (`npm ci`) e executa:

1. `npm audit --audit-level=moderate`
2. `prisma generate` e `prisma validate`
3. `prisma migrate deploy` e `db:seed`
4. `typecheck`, testes Vitest e lint
5. Instalação do Chromium, build de produção e testes E2E Playwright

Comandos úteis:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

A existência do workflow no repositório não significa que uma execução tenha passado. Consulte a aba **Actions** e os checks do pull request para confirmar o resultado do commit que pretende integrar.

## Notas operacionais e limites conhecidos

- O adaptador sandbox é destinado a desenvolvimento/testes; não representa liquidação real.
- A taxa de prestador de 1,5% usada no cálculo de liquidação está identificada no código como provisória e deve ser validada/substituída pela taxa contratual efetiva antes de utilização financeira em produção.
- A confirmação de pagamento e a emissão de bilhetes são idempotentes; se a emissão falhar depois da confirmação, uma nova execução do processamento pode tentar concluir a emissão sem criar bilhetes duplicados.
- O fluxo de pagamentos desconhecidos mantém a reserva protegida para revisão, em vez de libertar inventário cuja cobrança possa ter sido concluída.
- A documentação descreve o código desta branch; confirme migrations, variáveis, integrações e estado do CI no ambiente real antes de uma publicação.


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
- [docs/parte-19-e2e-bugfixes.md](docs/parte-19-e2e-bugfixes.md) — bugfixes MFA/lotes + E2E Playwright
- [docs/parte-20-multicaixa-financas-ci.md](docs/parte-20-multicaixa-financas-ci.md) — Multicaixa Express, painel financeiro, CI/E2E
- [docs/dominio-2-eventos.md](docs/dominio-2-eventos.md)
- [docs/dominio-3-bilhetes-inventario.md](docs/dominio-3-bilhetes-inventario.md)
- [docs/dominio-4-venda-checkout.md](docs/dominio-4-venda-checkout.md)
- [docs/dominio-5-pagamentos-financas.md](docs/dominio-5-pagamentos-financas.md)
- [docs/dominio-6-bilheteira-fisica.md](docs/dominio-6-bilheteira-fisica.md)
- [docs/dominio-7-controlo-acesso.md](docs/dominio-7-controlo-acesso.md)
- [docs/dominio-8-seguranca-antifraude.md](docs/dominio-8-seguranca-antifraude.md)
- [docs/dominios-9-11-administracao-notificacoes-relatorios.md](docs/dominios-9-11-administracao-notificacoes-relatorios.md)
