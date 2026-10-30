import { z } from "zod";

// ============================================================
// Módulo payments — validação de entrada (SEC-09).
// Valores monetários NUNCA vêm do cliente: o montante é sempre
// derivado do Payment/Order na base, validado no servidor.
// ============================================================

export const initiatePaymentSchema = z.object({
  orderId: z.string().uuid(),
  providerCode: z.string().trim().min(2).max(40),
  method: z.enum(["CARD", "MOBILE_MONEY", "DIGITAL_WALLET", "BANK_TRANSFER", "CASH"]),
  idempotencyKey: z.string().min(16).max(128).optional(),
});

export const webhookSchema = z.object({
  providerCode: z.string().trim().min(2).max(40),
  // corpo bruto chega como string — verificado pelo adaptador
  rawBody: z.string().min(1),
});

export const queryStatusSchema = z.object({
  paymentId: z.string().uuid(),
});

export const manualReviewSchema = z.object({
  paymentId: z.string().uuid(),
  decision: z.enum(["CONFIRM", "DECLINE"]),
  evidenceNotes: z.string().trim().min(10, "Evidência obrigatória (Opção C).").max(2000),
});

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type ManualReviewInput = z.infer<typeof manualReviewSchema>;
