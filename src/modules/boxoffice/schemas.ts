import { z } from "zod";

// ============================================================
// Módulo boxoffice — validação de entrada (SEC-09).
// ============================================================

export const openShiftSchema = z.object({
  stationCode: z.string().trim().min(2).max(40),
  openingFloatCents: z.number().int().min(0).max(10_000_000),
});

export const closeShiftSchema = z
  .object({
    shiftId: z.string().uuid(),
    countedCents: z.number().int().min(0).max(100_000_000),
    differenceNotes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.differenceNotes !== undefined, {
    // preenchido na rota quando há diferença; aqui garantimos campo
    message: "Notas obrigatórias quando há diferença.",
    path: ["differenceNotes"],
  });

export const cashMovementSchema = z.object({
  shiftId: z.string().uuid(),
  type: z.enum(["CASH_IN", "CASH_OUT", "REFUND_PAID"]),
  amountCents: z.number().int().positive().max(10_000_000),
  reason: z.string().trim().min(3, "Motivo obrigatório.").max(300),
});

export const boxOfficeSaleSchema = z.object({
  stationCode: z.string().trim().min(2).max(40),
  holdId: z.string().uuid(),
  buyerName: z.string().trim().min(3).max(120),
  buyerEmail: z.string().trim().toLowerCase().email(),
  attendees: z
    .array(
      z.object({
        ticketTypeId: z.string().uuid(),
        fullName: z.string().trim().min(3).max(120),
        documentType: z.string().trim().min(2).max(30),
        documentNumber: z.string().trim().min(4).max(40),
      })
    )
    .min(1),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type BoxOfficeSaleInput = z.infer<typeof boxOfficeSaleSchema>;
