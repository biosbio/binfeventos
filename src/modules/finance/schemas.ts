import { z } from "zod";

// ============================================================
// Módulo finance — validação de entrada (SEC-09).
// Montantes são sempre validados contra o existente na base:
// o cliente indica a intenção, o servidor limita o valor.
// ============================================================

export const requestRefundSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().positive("Valor do reembolso deve ser positivo."),
  reason: z.string().trim().min(5, "Motivo obrigatório.").max(500),
});

export const approveRefundSchema = z.object({
  refundId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().max(500).optional(),
});

export const completeRefundSchema = z.object({
  refundId: z.string().uuid(),
  providerRef: z.string().trim().min(3).max(200),
  evidenceNotes: z.string().trim().min(10).max(2000),
});

export const prepareSettlementSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).refine((v) => v.periodEnd > v.periodStart, {
  message: "periodEnd deve ser posterior a periodStart.",
  path: ["periodEnd"],
});

export const approveSettlementSchema = z.object({
  settlementId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
});

export const adjustLedgerSchema = z
  .object({
    compensatesEntryId: z.string().uuid(),
    description: z.string().trim().min(5, "Descrição obrigatória.").max(300),
    amountCents: z.number().int(), // negativo = estorno do original
  })
  .refine((v) => v.amountCents !== 0, {
    message: "Lançamento compensatório não pode ser zero.",
    path: ["amountCents"],
  });

export const reserveSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(5).max(300),
  releaseConditions: z.string().trim().max(300).optional(),
  settlementId: z.string().uuid().optional(),
});

export const releaseReserveSchema = z.object({
  reserveId: z.string().uuid(),
  notes: z.string().trim().min(3).max(300),
});

export type RequestRefundInput = z.infer<typeof requestRefundSchema>;
export type ApproveRefundInput = z.infer<typeof approveRefundSchema>;
export type AdjustLedgerInput = z.infer<typeof adjustLedgerSchema>;
