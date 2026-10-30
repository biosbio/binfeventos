// ============================================================
// Módulo payments — camada de adaptação (Domínio 5).
// A camada normaliza: identificadores, estados, confirmações,
// webhooks, reembolsos, liquidações, erros, cancelamentos e
// consultas de estado. Substituir prestador não exige reemissão
// de bilhetes nem perda de histórico (documento mestre, secção 8).
//
// SEGURANÇA: chaves do prestador vivem em adapterConfig via gestor
// de segredos — NUNCA hardcoded, NUNCA enviadas ao cliente.
// ============================================================

/** Estado normalizado devolvido pelo prestador. */
export type ProviderResultStatus =
  | "INITIATED"
  | "AWAITING_AUTHORIZATION"
  | "PROCESSING"
  | "CONFIRMED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  | "UNKNOWN";

export interface InitiatePaymentInput {
  /** Referência normalizada da transação na nossa base. */
  paymentId: string;
  amountCents: number;
  currency: string;
  /** URL de retorno pós-pagamento (frontend). */
  returnUrl: string;
  /** Identificador do prestador para conciliação. */
  idempotencyKey: string;
  /** Configuração do adaptador (com chaves resolvidas do gestor de segredos). */
  adapterConfig: Record<string, unknown>;
}

export interface InitiatePaymentResult {
  providerRef: string;
  status: ProviderResultStatus;
  /** URL/redirecionamento quando aplicável (checkout hospedado). */
  redirectUrl?: string;
  /** Payload bruto do prestador — persistido como evidência. */
  rawPayload: unknown;
}

export interface RefundInput {
  providerRef: string;
  amountCents: number;
  adapterConfig: Record<string, unknown>;
}

export interface RefundResult {
  refundRef: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  rawPayload: unknown;
}

/** Resultado normalizado de um webhook (verificado no servidor). */
export interface WebhookPayload {
  providerRef: string;
  status: ProviderResultStatus;
  amountCents: number;
  eventIdempotent: boolean;
  rawPayload: unknown;
}

/**
 * Interface que cada adaptador de prestador implementa.
 * MVP: um prestador principal por mercado (ex: Multicaixa Express em AO).
 */
export interface PaymentAdapter {
  readonly code: string;
  readonly country: string;

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** Valida assinatura do webhook (nunca confiar no corpo sem validar). */
  verifyWebhook(rawBody: string, headers: Record<string, string>, adapterConfig: Record<string, unknown>): WebhookPayload | null;
  /** Consulta o estado atual no prestador (conciliação). */
  queryStatus(providerRef: string, adapterConfig: Record<string, unknown>): Promise<ProviderResultStatus>;
}

/** Registo de adaptadores por código (injeção simples). */
const adapters = new Map<string, PaymentAdapter>();

export function registerAdapter(adapter: PaymentAdapter): void {
  adapters.set(adapter.code, adapter);
}

export function getAdapter(code: string): PaymentAdapter | undefined {
  return adapters.get(code);
}
