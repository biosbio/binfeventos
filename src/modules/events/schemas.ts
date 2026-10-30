import { z } from "zod";

// ============================================================
// Módulo events — validação de entrada (SEC-09)
// ============================================================

export const eventSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: minúsculas, números e hífenes.")
  .min(3)
  .max(80);

export const eventCategorySchema = z.enum([
  "CONCERT",
  "CONFERENCE",
  "SPORT",
  "THEATER",
  "FESTIVAL",
  "WORKSHOP",
  "OTHER",
]);

export const createEventSchema = z.object({
  name: z.string().trim().min(3, "Nome do evento obrigatório.").max(150),
  slug: eventSlugSchema,
  description: z.string().trim().max(5000).optional(),
  category: eventCategorySchema.default("OTHER"),
  coverImageUrl: z.string().url("URL de capa inválida.").max(2000).optional(),
  entryRules: z.string().trim().max(3000).optional(),
  terms: z.string().trim().max(10000).optional(),
});

export const updateEventSchema = createEventSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Nada para atualizar." }
);

export const sessionSchema = z.object({
  eventId: z.string().uuid(),
  venueId: z.string().uuid().optional(),
  name: z.string().trim().max(120).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  doorsOpenAt: z.coerce.date().optional(),
}).refine((v) => v.endsAt > v.startsAt, {
  message: "endsAt deve ser posterior a startsAt.",
  path: ["endsAt"],
});

export const venueSchema = z.object({
  name: z.string().trim().min(2, "Nome do recinto obrigatório.").max(150),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2, "Código ISO do país.").default("AO"),
  capacity: z.number().int().positive().max(1_000_000).optional(),
  mapUrl: z.string().url("URL do mapa inválida.").max(2000).optional(),
});

export const eventIdSchema = z.object({ eventId: z.string().uuid() });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type VenueInput = z.infer<typeof venueSchema>;
