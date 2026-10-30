# Parte 16 — Domínio 12: Aplicações e experiência (web responsiva)

Primeira leva da interface web (Next.js App Router), consumindo as APIs das
Partes 11-15.

## Páginas implementadas

| Rota | Tipo | Conteúdo |
|---|---|---|
| `/` | Server Component | Catálogo público: hero, eventos publicados com sessão futura, como funciona |
| `/eventos/[slug]` | Server Component | Detalhe do evento: sessões, tipos de bilhete, regras de entrada, CTA de login |
| `/login` | Client Component | Login com campo MFA dinâmico (aparece quando exigido) |
| `/register` | Client Component | Registo com aviso de política de password (validação forte no servidor) |

## Regras de segurança na camada web

1. **Sem dados sensíveis no cliente**: nenhuma página persiste password,
   token de sessão ou QR em localStorage/sessionStorage. A sessão vive no
   cookie HttpOnly gerido pelo backend (SEC-03).
2. **Consultas públicas mínimas** (`_lib/public-queries.ts`): apenas campos
   públicos de eventos PUBLICADOS (`select` explícito) — nunca dados de
   compradores, titulares, pagamentos ou segredos.
3. **Preços lidos da base** e formatados com `Intl.NumberFormat` (AOA);
   nenhum cálculo financeiro acontece no cliente.
4. **MFA dinâmico**: o campo TOTP só aparece quando o backend responde que é
   exigido — a decisão é sempre do servidor.
5. **Mensagens de erro neutras**: o que o backend devolve é o que se mostra
   (mensagens genéricas já garantidas por `errors.ts`).

## Responsividade

- Breakpoints: 850px (grid 2 colunas → 1) e 600px (mobile: header
  compacto, hero reduzido, cards em coluna única).
- `next-env.d.ts` + `force-dynamic` nas páginas que consultam a base.

## Próximos ecrãs (Parte 17+)

- `/minha-conta` — bilhetes do comprador com QR (busca via API autenticada).
- `/painel` — organizador: eventos, lotes, vendas, pagamentos pendentes.
- `/portaria` — validador de QR (chama `/api/access/validate`).
- `/checkout` — fluxo hold → titulares → pagamento (usa `checkoutIdempotencyKey`).
