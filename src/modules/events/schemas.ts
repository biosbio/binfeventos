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

const coverImageUrlSchema = z.string().max(2000).refine((value) => {
  if (/^\/uploads\/event-covers\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "URL de capa inválida.");

export const createEventSchema = z.object({
  name: z.string().trim().min(3, "Nome do evento obrigatório.").max(150),
  slug: eventSlugSchema.optional(),
  description: z.string().trim().max(5000).optional(),
  category: eventCategorySchema.default("OTHER"),
  coverImageUrl: coverImageUrlSchema.optional(),
  entryRules: z.string().trim().max(3000).optional(),
  terms: z.string().trim().max(10000).optional(),
  additionalOrganizerLimit: z.coerce.number().int().min(1).max(3).default(1),
});

const eventVenueSchema = z.object({
  name: z.string().trim().min(2, "Nome do local obrigatório.").max(150),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().min(2, "Cidade obrigatória.").max(100),
  country: z.string().trim().length(2, "Código ISO do país.").default("AO"),
});

const normalTicketSchema = z.object({
  basePriceCents: z.number().int().min(0).max(100_000_000),
  quantity: z.number().int().positive().max(1_000_000),
  maxPerBuyer: z.number().int().min(1).max(1_000_000).default(10),
});

const calendarStartSchema = z.coerce.date().refine(
  (date) => date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0,
  "A data de início deve ser informada sem hora.",
);

const calendarEndSchema = z.coerce.date().refine(
  (date) => date.getUTCHours() === 23 && date.getUTCMinutes() === 59 &&
    date.getUTCSeconds() === 59 && date.getUTCMilliseconds() === 999,
  "A data de fim deve ser informada sem hora.",
);

export const createOrganizerEventSchema = createEventSchema.extend({
  venue: eventVenueSchema,
  startsAt: calendarStartSchema,
  endsAt: calendarEndSchema,
  normalTicket: normalTicketSchema,
}).refine(
  (event) => event.endsAt > event.startsAt,
  { message: "O fim do evento deve ser posterior ao início.", path: ["endsAt"] },
);

export const updateEventSchema = createEventSchema.partial().extend({
  venue: eventVenueSchema.optional(),
  startsAt: calendarStartSchema.optional(),
  endsAt: calendarEndSchema.optional(),
}).refine(
  (event) => Boolean(event.startsAt) === Boolean(event.endsAt),
  { message: "Informe a data de início e a data de fim.", path: ["endsAt"] },
).refine(
  (event) => !event.startsAt || !event.endsAt || event.endsAt > event.startsAt,
  { message: "O fim do evento deve ser posterior ao início.", path: ["endsAt"] },
).refine(
  (event) => Object.keys(event).length > 0,
  { message: "Nada para atualizar." },
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

export const createPlatformEventSchema = createEventSchema.extend({
  venue: eventVenueSchema,
  startsAt: calendarStartSchema,
  endsAt: calendarEndSchema,
  normalTicket: normalTicketSchema,
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
export type CreateOrganizerEventInput = z.infer<typeof createOrganizerEventSchema>;
export type CreatePlatformEventInput = z.infer<typeof createPlatformEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type VenueInput = z.infer<typeof venueSchema>;
