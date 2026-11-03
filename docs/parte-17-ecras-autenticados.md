# Parte 17 — Ecrãs autenticados: conta, checkout, portaria e painel

Completa o Domínio 12 com os ecrãs que consomem as APIs autenticadas
(Partes 11-15).

## Páginas novas

| Rota | Tipo | Conteúdo |
|---|---|---|
| `/minha-conta` | Server | Encomendas do comprador com estados, valores e bilhetes emitidos |
| `/bilhetes/{id}` | Server | Bilhete individual: titular, sessão, regras + **QR em imagem SVG** |
| `/checkout` | Client | 3 passos: reserva → titulares → pagamento (resumo 100% do servidor) |
| `/portaria` | Client | Validador: código de porta + token QR + conferência de identidade |
| `/painel` | Server | KPIs do organizador: vendas 24h, pagamentos a analisar, alertas, eventos |

## QR em imagem (evolução do fluxo SEC-18)

A rota `GET /api/access/tickets/{id}/qr-image` gera o **SVG no servidor**
com o token rotativo e devolve apenas a imagem:

- O token plano **nunca** chega ao browser em JSON/texto.
- `Cache-Control: no-store` — QR rotativo nunca é cacheado.
- Cada consulta roda o segredo (mecanismo da Parte 14); a página informa
  o utilizador de que o QR anterior deixa de funcionar.

## Checkout (3 passos, cliente mínimo)

1. **Reserva** — escolhe tipo/quantidade; servidor valida lote aberto,
   disponibilidade e limite por comprador; TTL de 10 min mostrado ao vivo.
2. **Identificação** — o nome e email do comprador vêm da conta autenticada;
   o comprador identifica todos os titulares (comprador ≠ titular).
   `checkoutIdempotencyKey = crypto.randomUUID()` gerada **em memória do
   componente** (nunca localStorage).
3. **Pagamento** — resumo recebido do servidor (subtotal, taxa, total) é
   apenas exibido; iniciação delega ao `/api/payments/initiate` e segue o
   `redirectUrl` do prestador quando existir.

## Portaria

- Envia token lido + código da porta + flag de identidade conferida.
- Toda decisão é do servidor (`/api/access/validate`); nenhuma aprovação offline.
- Recusas exibem os motivos mapeados (QR inválido, já utilizado, sessão
  errada, identidade não conferida…).

## Painel do organizador

- Agregações server-side mínimas: soma/count de vendas confirmadas (24h),
  contagem de pagamentos `UNDER_REVIEW` (Opção C), alertas de fraude abertos
  e lista de eventos com primeira sessão.
- Sem dados de titulares, segredos ou payloads de prestador na página.

## Segurança dos dados (regra de ouro mantida)

- Sessão em cookie HttpOnly; nenhuma página persiste token, QR ou password
  no navegador.
- `select` explícito em todas as consultas das páginas (`my-queries`, painel,
  bilhete).
- Redirecionamento para `/login` quando a sessão não é válida.

## Próximos passos (futuro)

- Leitura de QR por câmara na portaria (BarcodeDetector API).
- Painel administrativo completo (membros, liquidações, livro-razão).
- PWA offline-first para bilhetes do comprador.
