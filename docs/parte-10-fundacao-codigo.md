# Parte 10 — Monólito modular: fundação de código

## Como executar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar ambiente
cp .env.example .env
# Editar .env com a sua DATABASE_URL (PostgreSQL)

# 3. Gerar o client do Prisma e migrar a base
npm run prisma:generate
npm run prisma:migrate

# 4. Seed (permissões, papéis de sistema, admin local)
npm run db:seed

# 5. Desenvolvimento
npm run dev
```

## Estrutura (monólito modular)

```
src/
├── shared/                    # Núcleo transversal
│   ├── lib/
│   │   ├── prisma.ts          # Cliente Prisma singleton
│   │   └── security.ts        # Argon2id, tokens, QR, rate limit
│   ├── errors.ts              # Erros padronizados + mapeamento HTTP
│   ├── audit.ts               # Auditoria append-only + sanitização
│   ├── auth.ts                # Sessões (cookie HttpOnly) + guards ABAC
│   └── permissions.ts         # Catálogo de permissões e papéis
├── modules/                   # Módulos por domínio (a implementar)
│   ├── users/
│   ├── organizations/
│   ├── events/
│   ├── inventory/
│   ├── sales/
│   ├── payments/
│   ├── finance/
│   ├── boxoffice/
│   ├── access/
│   ├── security/
│   └── notifications/
└── app.ts
```

## Fundação implementada

| Camada | Conteúdo | Controlo de segurança |
|---|---|---|
| Erros | Classes AppError + `errorResponse` | SEC-09: sem vazamento de detalhes internos |
| Segurança | Argon2id, sessões opacas com hash, QR secrets, rate limit | SEC-01, SEC-03, SEC-05, SEC-18 |
| Auditoria | `writeAudit` append-only + `sanitizeForAudit` | SEC-16: sem dados sensíveis em logs |
| Autorização | `requireAuth` / `requirePermission` (ABAC por organização) | SEC-02 |
| Permissões | Catálogo central + papéis de sistema (7 papéis) | SEC-02 |

## Papéis de sistema (seed)

| Papel | Descrição |
|---|---|
| PLATFORM_ADMIN | Administração central da plataforma |
| ORG_ADMIN | Tudo dentro da organização |
| ORGANIZER | Eventos, bilhetes, lugares, relatórios |
| FINANCE_MANAGER | Pagamentos, reembolsos, liquidações, ledger (segregação: não vende) |
| BOX_OFFICE_OPERATOR | Bilheteira física: vender, turnos |
| ENTRY_SUPERVISOR | Portas, validação, relatórios de acesso |
| TICKET_VALIDATOR | Validar acessos |

## Segregação de responsabilidades (documento mestre, secção 15)

- `refund:approve` e `settlement:approve` ficam com FINANCE_MANAGER;
  ORG_ADMIN não acumula `refund:request` (separação entre quem solicita e
  quem aprova operações críticas).
- `ledger:adjust` exige dupla aprovação em runtime (implementação nos módulos
  financeiros).

## Próximos passos

- Módulo `users`: registo, login, MFA (rotas API).
- Módulo `organizations`: criação, convites, gestão de membros.
- Domínio 2 (events): CRUD de eventos/sessões com máquina de estados.
