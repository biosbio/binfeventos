# Parte 11 — Módulos de negócio: users + organizations

Primeiros módulos funcionais do monólito, usando toda a fundação da Parte 10.

## Módulo `users`

### Fluxo de conta

| Operação | Regras aplicadas |
|---|---|
| Registo | Password forte (12+, maiúscula, minúscula, número); email normalizado; Argon2id |
| Login | Rate limit 10/min por IP+email; mensagem genérica em falha (não revela email existente); MFA TOTP obrigatório quando ativado |
| MFA setup | Gera segredo Base32 + URL otpauth para QR (Google Authenticator etc.); confirmação em 2 passos |
| MFA confirm | Só ativa com código TOTP válido — evita bloquear a conta com segredo não guardado na app |
| MFA disable | Exige código TOTP válido — não pode ser desligado sem prova de posse |
| Password | Exige password atual; revoga TODAS as sessões ativas |
| Logout | Revoga a sessão atual |

### Contexto organizacional no login

A sessão recebe `organizationId` da primeira associação **aceita** do
utilizador. Contas sem organização ficam com contexto nulo (só operam
registo/login/MFA até criarem ou aceitarem convite).

## Módulo `organizations`

| Operação | Requisito | Regras de isolamento |
|---|---|---|
| Criar organização | autenticado | Criador torna-se ORG_ADMIN com `acceptedAt` imediato; slug único global |
| Convidar membro | `org:invite` | Papel alvo deve ser de sistema OU da própria organização; utilizador tem de existir; `acceptedAt: null` até aceitar |
| Aceitar convite | autenticado | Só o próprio convidado pode aceitar |
| Mudar papel | `org:role:assign` | Não atribui papéis de outras organizações; só altera membros da org ativa |
| Listar membros | `org:manage` | Consulta sempre filtrada por `organizationId` do contexto |

Todas as operações geram `AuditLog` via `writeAudit` com `sanitizeForAudit`.

## Testes

```bash
npm run test
```

- `tests/users-schemas.test.ts` — password forte, normalização de email, TOTP 6 dígitos
- `tests/organizations-schemas.test.ts` — slug, defaults de país/moeda, convite

## Pendências conscientes (marcadas no código)

1. `registerUser`/`login_failed` usam `console.log` até existir contexto
   organizacional para o `AuditLog` (contas sem org não têm orgId).
2. Notificação de convite (`inviteMember`) fica para o Domínio 10.
3. `mfaSecret` deve ser encriptado em repouso na fase de infraestrutura
   (SEC-07), por exemplo com KMS/pgcrypto.
4. `route.ts` de users usa um handler catch-all `[action]` com dynamic
   import — em produção pode ser dividido em ficheiros por ação para
   cache de rotas mais eficiente.
