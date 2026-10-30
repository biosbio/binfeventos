import { z } from "zod";

// ============================================================
// Módulo sales (checkout) — validação de entrada (SEC-09).
// O cliente envia APENAS: hold (reserva já criada), dados de
// identificação do comprador e titulares. NUNCA preços, taxas,
// descontos ou totais — calculados exclusivamente no servidor.
// ============================================================

export const attendeeSchema = z.object({
  ticketTypeId: z.string().uuid(),
  fullName: z.string().trim().min(3, "Nome do titular obrigatório.").max(120),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  documentType: z.string().trim().max(30).optional(),
  documentNumber: z.string().trim().max(40).optional(),
});

export const createOrderSchema = z
  .object({
    holdId: z.string().uuid(),
    checkoutIdempotencyKey: z.string().min(16).max(128).optional(),
    buyerName: z.string().trim().min(3, "Nome do comprador obrigatório.").max(120),
    buyerEmail: z.string().trim().toLowerCase().email(),
    buyerPhone: z.string().trim().min(7).max(20).optional(),
    attendees: z.array(attendeeSchema).min(1, "Pelo menos um titular obrigatório."),
  })
  .refine(
    (v) => v.attendees.length <= 20,
    { message: "Máximo de 20 titulares por encomenda." }
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
