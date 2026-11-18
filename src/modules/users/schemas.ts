import { z } from "zod";

// ============================================================
// Módulo users — validação de entrada (SEC-09)
// O navegador nunca é fonte confiável: tudo é validado no servidor.
// ============================================================

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email inválido.");

export const passwordSchema = z
  .string()
  .min(12, "Password deve ter pelo menos 12 caracteres.")
  .regex(/[a-z]/, "Password deve conter uma minúscula.")
  .regex(/[A-Z]/, "Password deve conter uma maiúscula.")
  .regex(/[0-9]/, "Password deve conter um número.");

export const adminPasswordSchema = z
  .string()
  .min(9, "A password do administrador deve ter pelo menos 9 caracteres.")
  .regex(/[a-z]/, "A password deve conter uma letra minúscula.")
  .regex(/[A-Z]/, "A password deve conter uma letra maiúscula.")
  .regex(/[0-9]/, "A password deve conter um número.")
  .regex(/[^A-Za-z0-9]/, "A password deve conter um símbolo.");

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, "Nome completo obrigatório.").max(120),
  email: emailSchema,
  phone: z.string().trim().regex(/^[+][1-9][0-9]{7,14}$/, "Indique o telemóvel com indicativo internacional, por exemplo +245XXXXXXXXX."),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password obrigatória."),
  totpCode: z.string().regex(/^\d{6}$/, "Código MFA inválido.").optional(),
});

export const passwordRecoveryStartSchema = z.object({
  email: emailSchema,
});

export const passwordRecoveryConfirmSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/).optional(),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  newPassword: z.union([passwordSchema, adminPasswordSchema]),
}).refine((value) => Boolean(value.code) !== Boolean(value.totpCode), {
  message: "Indique apenas o código de recuperação apropriado.",
});

export const enableMfaSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, "Código MFA inválido."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
