// ============================================================
// Erros de aplicação padronizados — todo o monólito usa estas classes.
// Mensagens nunca expõem detalhes internos ao cliente.
// ============================================================

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly userMessage: string;

  constructor(code: string, httpStatus: number, userMessage: string, internal?: string) {
    super(internal ?? userMessage);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
  }
}

/** Recurso não encontrado (404) — resposta neutra; não revela existência. */
export class NotFoundError extends AppError {
  constructor(entity: string) {
    super("NOT_FOUND", 404, `${entity} não encontrado.`);
  }
}

/** Dados de entrada inválidos (400) */
export class ValidationError extends AppError {
  constructor(details: string) {
    super("VALIDATION_ERROR", 400, "Dados inválidos.", details);
  }
}

/** Conflito de integridade (409) — ex: venda duplicada, slug repetido */
export class ConflictError extends AppError {
  constructor(userMessage: string, internal?: string) {
    super("CONFLICT", 409, userMessage, internal);
  }
}

/** Regra de negócio violada (422) — ex: transferência não elegível */
export class BusinessRuleError extends AppError {
  constructor(userMessage: string, internal?: string) {
    super("BUSINESS_RULE", 422, userMessage, internal);
  }
}

/** Não autenticado (401) */
export class UnauthorizedError extends AppError {
  constructor() {
    super("UNAUTHORIZED", 401, "Autenticação necessária.");
  }
}

/** Autenticado mas sem permissão (403) */
export class ForbiddenError extends AppError {
  constructor(permission?: string) {
    super(
      "FORBIDDEN",
      403,
      "Sem permissão para esta operação.",
      permission ? `Missing permission: ${permission}` : undefined
    );
  }
}

/** Regra antifraude ou limite de risco bloqueou a operação (429) */
export class RiskBlockedError extends AppError {
  constructor(ruleName: string) {
    super("RISK_BLOCKED", 429, "Operação temporariamente bloqueada.", `Rule: ${ruleName}`);
  }
}

/** Inventario insuficiente (409) */
export class InsufficientInventoryError extends AppError {
  constructor() {
    super("INSUFFICIENT_INVENTORY", 409, "Ingressos insuficientes no momento.");
  }
}

/** Mapeamento AppError -> resposta HTTP (API routes) */
export function errorResponse(err: unknown): {
  status: number;
  body: { code: string; message: string };
} {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { code: err.code, message: err.userMessage } };
  }
  // Erro desconhecido: log interno, resposta genérica (SEC-09: não vazar detalhes)
  console.error("[unexpected-error]", err);
  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "Erro interno. Tente novamente." },
  };
}
