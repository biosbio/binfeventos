import { z } from "zod";

// ============================================================
// Módulo inventory — validação de entrada (SEC-09).
// IMPORTANTE: o cliente NUNCA envia preços, taxas ou totais —
// apenas identificadores e quantidades. Tudo mais é calculado
// no servidor (documento mestre, Domínio 3/4).
// ============================================================

export const ticketCategoryEnum = z.enum([
  "NORMAL", "VIP", "PREMIUM", "STUDENT", "CHILD",
  "FREE", "INVITE", "SPECIAL_ACCESS",
]);

export const createTicketTypeSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2, "Nome do tipo obrigatório.").max(120),
  category: ticketCategoryEnum.default("NORMAL"),
  description: z.string().trim().max(2000).optional(),
  basePriceCents: z.number().int().min(0).max(100_000_000), // preço em cêntimos, validado no servidor
  requiresIdentity: z.boolean().default(true),
  quantity: z.number().int().positive().max(1_000_000),
  maxPerBuyer: z.number().int().min(1).max(1_000_000).default(10),
});

export const updateTicketTypeQuantitySchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().positive().max(1_000_000),
});

export const createBatchSchema = z.object({
  ticketTypeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  quantity: z.number().int().positive().max(1_000_000),
  priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  maxPerBuyer: z.number().int().min(1).max(1_000_000).default(10),
});

// Pedido de reserva temporária: só identificadores + quantidade.
// Nada de preços, taxas, descontos ou totais vindos do cliente.
export const holdRequestSchema = z.object({
  sessionId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  idempotencyKey: z.string().min(16).max(128).optional(),
});

export const availabilityQuerySchema = z.object({
  sessionId: z.string().uuid(),
});

export const releaseHoldSchema = z.object({
  holdId: z.string().uuid(),
});

export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;
export type UpdateTicketTypeQuantityInput = z.infer<typeof updateTicketTypeQuantitySchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type HoldRequestInput = z.infer<typeof holdRequestSchema>;
