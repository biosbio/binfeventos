import { z } from "zod";

// ============================================================
// Módulo access — validação de entrada (SEC-09, SEC-18).
// O QR lido na portaria envia o TOKEN APRESENTADO; o segredo
// original nunca sai do backend (só o hash está na base).
// ============================================================

export const validateQrSchema = z.object({
  qrToken: z.string().min(20, "QR inválido.").max(200),
  gateCode: z.string().trim().min(2).max(40),
  identityVerified: z.boolean().default(false),
});

export const issueTransferSchema = z.object({
  ticketId: z.string().uuid(),
  newHolderFullName: z.string().trim().min(3).max(120),
  newHolderEmail: z.string().trim().toLowerCase().email(),
  newHolderPhone: z.string().trim().min(7).max(20).optional(),
  newHolderDocumentType: z.string().trim().max(30).optional(),
  newHolderDocumentNumber: z.string().trim().max(40).optional(),
});

export const approveTransferSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().trim().min(3).max(300).optional(),
});

export const createGateSchema = z.object({
  venueId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  gateType: z.enum(["ENTRY", "EXIT", "REENTRY"]).default("ENTRY"),
  sessionId: z.string().uuid().optional(),
});

export type ValidateQrInput = z.infer<typeof validateQrSchema>;
export type IssueTransferInput = z.infer<typeof issueTransferSchema>;
export type ApproveTransferInput = z.infer<typeof approveTransferSchema>;
