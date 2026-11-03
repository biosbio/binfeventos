import { z } from "zod";

// ============================================================
// Módulo organizations — validação de entrada (SEC-09)
// ============================================================

/** Slug: minúsculas, números e hífenes; único por organização. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: minúsculas, números e hífenes.")
  .min(3)
  .max(60);

export const createOrgSchema = z.object({
  name: z.string().trim().min(3, "Nome obrigatório.").max(120),
  slug: slugSchema,
  country: z.string().trim().length(2, "Código ISO do país (ex: AO).").default("AO"),
  currency: z.string().trim().length(3, "Moeda ISO (ex: AOA).").default("AOA"),
});

export const onboardOrganizerSchema = createOrgSchema.extend({
  password: z.string().min(1, "Password obrigatória."),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleName: z.string().trim().min(3).max(60),
});

export const assignRoleSchema = z.object({
  memberId: z.string().uuid(),
  roleName: z.string().trim().min(3).max(60),
});

export const suspendOrgSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(3, "Motivo obrigatório.").max(500),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
