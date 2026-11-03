// ============================================================
// Catálogo central de permissões — fonte única de verdade.
// Seed de base + guards usam estas constantes (SEC-02: RBAC/ABAC).
// ============================================================

export const PERMISSIONS = [
  // Utilizadores e organizações (Domínio 1)
  { code: "org:manage", domain: "users", description: "Gerir a organização" },
  { code: "org:invite", domain: "users", description: "Gerir convites de vendedores" },
  { code: "org:role:assign", domain: "users", description: "Atribuir papéis" },

  // Eventos e sessões (Domínio 2)
  { code: "event:create", domain: "events", description: "Criar evento" },
  { code: "event:read", domain: "events", description: "Consultar eventos" },
  { code: "event:update", domain: "events", description: "Editar evento" },
  { code: "event:publish", domain: "events", description: "Publicar/suspender evento" },
  { code: "event:cancel", domain: "events", description: "Cancelar/adiar evento" },
  { code: "venue:manage", domain: "events", description: "Gerir recintos" },
  { code: "session:manage", domain: "events", description: "Gerir sessões" },

  // Bilhetes e inventário (Domínio 3)
  { code: "ticketType:manage", domain: "inventory", description: "Gerir tipos de bilhete" },
  { code: "batch:manage", domain: "inventory", description: "Gerir lotes" },
  { code: "seats:manage", domain: "inventory", description: "Gerir mapas e lugares" },
  { code: "seats:block", domain: "inventory", description: "Bloquear/desbloquear lugares" },
  { code: "inventory:read", domain: "inventory", description: "Consultar disponibilidade" },

  // Venda e checkout (Domínio 4)
  { code: "order:create", domain: "sales", description: "Iniciar checkout" },
  { code: "order:read", domain: "sales", description: "Consultar encomendas" },
  { code: "order:cancel", domain: "sales", description: "Cancelar encomenda" },
  { code: "order:review", domain: "sales", description: "Analisar ocorrências" },

  // Pagamentos e finanças (Domínio 5)
  { code: "payment:read", domain: "finance", description: "Consultar pagamentos" },
  { code: "payment:review", domain: "finance", description: "Analisar pagamentos pendentes" },
  { code: "refund:request", domain: "finance", description: "Solicitar reembolso" },
  { code: "refund:approve", domain: "finance", description: "Aprovar reembolso" },
  { code: "settlement:prepare", domain: "finance", description: "Preparar liquidação" },
  { code: "settlement:approve", domain: "finance", description: "Aprovar liquidação" },
  { code: "ledger:read", domain: "finance", description: "Consultar livro-razão" },
  { code: "ledger:adjust", domain: "finance", description: "Lançamentos compensatórios" },
  { code: "reserve:manage", domain: "finance", description: "Constituir/libertar reservas" },

  // Bilheteira física (Domínio 6)
  { code: "boxoffice:sell", domain: "boxoffice", description: "Vender na bilheteira" },
  { code: "shift:open", domain: "boxoffice", description: "Abrir turno" },
  { code: "shift:close", domain: "boxoffice", description: "Fechar turno" },
  { code: "shift:reconcile", domain: "boxoffice", description: "Conciliar turno" },
  { code: "cash:movement", domain: "boxoffice", description: "Autorizar movimentos de caixa" },
  { code: "cash:deposit", domain: "boxoffice", description: "Registar depósitos" },

  // Controlo de acesso (Domínio 7)
  { code: "ticket:read", domain: "access", description: "Consultar bilhetes" },
  { code: "ticket:revoke", domain: "access", description: "Revogar bilhete" },
  { code: "transfer:approve", domain: "access", description: "Aprovar transferência" },
  { code: "gate:manage", domain: "access", description: "Gerir portas/validadores" },
  { code: "access:validate", domain: "access", description: "Validar acessos" },
  { code: "access:report", domain: "access", description: "Relatórios de acesso" },

  // Segurança e antifraude (Domínio 8)
  { code: "fraudRule:create", domain: "security", description: "Criar regra antifraude" },
  { code: "fraudRule:approve", domain: "security", description: "Aprovar regra (dupla aprovação)" },
  { code: "fraudAlert:investigate", domain: "security", description: "Investigar alertas" },
  { code: "fraudAlert:resolve", domain: "security", description: "Resolver alertas" },
  { code: "incident:manage", domain: "security", description: "Gerir incidentes" },
  { code: "audit:read", domain: "security", description: "Consultar auditoria" },

  // Administração (Domínio 9)
  { code: "admin:platform", domain: "admin", description: "Administração central" },
  { code: "subscription:manage", domain: "admin", description: "Gerir assinaturas" },
  { code: "export:request", domain: "admin", description: "Exportar relatórios" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

/** Papéis de sistema (isSystem=true) e suas permissões. */
export const SYSTEM_ROLES: Record<string, PermissionCode[]> = {
  // Administrador da organização — tudo dentro da org
  ORG_ADMIN: [
    "org:manage", "org:invite", "org:role:assign",
    "event:create", "event:read", "event:update", "event:publish", "event:cancel",
    "venue:manage", "session:manage",
    "ticketType:manage", "batch:manage", "seats:manage", "seats:block", "inventory:read",
    "order:read", "order:cancel",
    "payment:read", "refund:approve",
    "ledger:read",
    "boxoffice:sell", "shift:reconcile", "cash:movement", "cash:deposit",
    "ticket:read", "ticket:revoke", "transfer:approve", "gate:manage", "access:report",
    "fraudRule:create", "fraudRule:approve", "fraudAlert:investigate", "fraudAlert:resolve",
    "incident:manage", "audit:read", "export:request",
  ],

  // Organizador de eventos
  ORGANIZER: [
    "org:invite",
    "event:create", "event:read", "event:update", "event:publish",
    "venue:manage", "session:manage",
    "ticketType:manage", "batch:manage", "seats:manage", "seats:block", "inventory:read",
    "order:read", "shift:reconcile",
    "ticket:read", "transfer:approve", "access:report", "export:request",
  ],

  // Gestor financeiro (segregação: aprova mas não vende)
  FINANCE_MANAGER: [
    "payment:read", "payment:review", "refund:request", "refund:approve",
    "settlement:prepare", "settlement:approve",
    "ledger:read", "ledger:adjust", "reserve:manage",
    "order:read", "audit:read", "export:request",
  ],

  // Operador de bilheteira
  BOX_OFFICE_OPERATOR: [
    "boxoffice:sell", "shift:open", "shift:close",
    "inventory:read", "order:read", "ticket:read",
  ],

  // Supervisor de entrada
  ENTRY_SUPERVISOR: [
    "gate:manage", "access:validate", "access:report", "ticket:read",
  ],

  // Validador de bilhetes
  TICKET_VALIDATOR: [
    "access:validate", "ticket:read",
  ],
};
