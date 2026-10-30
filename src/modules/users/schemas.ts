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

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, "Nome completo obrigatório.").max(120),
  email: emailSchema,
  phone: z.string().trim().min(7).max(20).optional(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password obrigatória."),
  totpCode: z.string().regex(/^\d{6}$/, "Código MFA inválido.").optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const enableMfaSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, "Código MFA inválido."),
});

export const disableMfaSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, "Código MFA inválido."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
