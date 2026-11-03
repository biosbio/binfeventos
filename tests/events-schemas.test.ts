import { describe, it, expect } from "vitest";
import {
  createEventSchema,
  createOrganizerEventSchema,
  createPlatformEventSchema,
  sessionSchema,
  venueSchema,
  eventSlugSchema,
  updateEventSchema,
} from "../src/modules/events/schemas";

describe("eventSlugSchema", () => {
  it("aceita slug válido", () => {
    expect(eventSlugSchema.safeParse("show-de-ano-novo").success).toBe(true);
  });

  it("normaliza para minúsculas", () => {
    expect(eventSlugSchema.parse("ShowDeAnoNovo")).toBe("showdeanonovo");
  });

  it("rejeita acentos e caracteres especiais", () => {
    expect(eventSlugSchema.safeParse("show-de-ão!").success).toBe(false);
  });
});

describe("createEventSchema", () => {
  it("exige nome, permite slug opcional e define category OTHER por omissão", () => {
    const r = createEventSchema.parse({ name: "Show BINF", slug: "show-binf" });
    expect(r.category).toBe("OTHER");
    expect(createEventSchema.parse({ name: "Outro evento" }).slug).toBeUndefined();
  });

  it("rejeita URL de capa inválida", () => {
    expect(
      createEventSchema.safeParse({ name: "X", slug: "abc", coverImageUrl: "nope" }).success
    ).toBe(false);
  });

  it("aceita o caminho gerado pelo carregamento de imagem", () => {
    expect(
      createEventSchema.safeParse({
        name: "Show BINF",
        coverImageUrl: "/uploads/event-covers/2d9bf441-6408-4efb-9eb3-9cb1226bd2ef.webp",
      }).success
    ).toBe(true);
  });
});

describe("createOrganizerEventSchema", () => {
  const venue = {
    name: "Arena BINF",
    city: "Bissau",
    country: "GW",
  };
  const normalTicket = { basePriceCents: 5000, quantity: 100 };

  it("exige a data do evento e um fim posterior ao início", () => {
    expect(createOrganizerEventSchema.safeParse({ name: "Show BINF" }).success).toBe(false);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      venue,
      normalTicket,
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(true);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(false);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      startsAt: "2027-01-02T23:59:59.999Z",
      endsAt: "2027-01-02T00:00:00.000Z",
    }).success).toBe(false);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      venue,
      normalTicket,
      startsAt: "2027-01-02T18:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(false);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      venue,
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(false);
    expect(createOrganizerEventSchema.safeParse({
      name: "Show BINF",
      venue,
      normalTicket: { basePriceCents: -1, quantity: 0 },
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(false);
  });
});

describe("updateEventSchema", () => {
  it("aceita uma data para um dia ou início e fim para vários dias", () => {
    expect(updateEventSchema.safeParse({
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    }).success).toBe(true);
    expect(updateEventSchema.safeParse({
      startsAt: "2027-01-02T00:00:00.000Z",
    }).success).toBe(false);
    expect(updateEventSchema.safeParse({
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-03T23:59:59.999Z",
    }).success).toBe(true);
  });
});

describe("sessionSchema", () => {
  const base = { eventId: "b3f1c0a0-0000-4000-8000-000000000001" };

  it("exige endsAt posterior a startsAt", () => {
    expect(
      sessionSchema.safeParse({
        ...base,
        startsAt: "2026-12-31T20:00:00Z",
        endsAt: "2026-12-31T19:00:00Z",
      }).success
    ).toBe(false);
  });

  describe("createPlatformEventSchema", () => {
    const venue = {
      name: "Arena BINF",
      city: "Bissau",
      country: "GW",
    };
    const session = {
      startsAt: "2027-01-02T00:00:00.000Z",
      endsAt: "2027-01-02T23:59:59.999Z",
    };

    it("requires a valid initial session", () => {
      expect(createPlatformEventSchema.safeParse({
        name: "Evento central",
        venue,
        normalTicket: { basePriceCents: 0, quantity: 50 },
        ...session,
      }).success).toBe(true);
      expect(createPlatformEventSchema.safeParse({
        name: "Evento central",
        venue,
        normalTicket: { basePriceCents: 0, quantity: 50 },
        startsAt: session.endsAt,
        endsAt: session.startsAt,
      }).success).toBe(false);
      expect(createPlatformEventSchema.safeParse({ name: "Evento central", ...session }).success).toBe(false);
    });
  });

  it("aceita sessão válida e converte datas", () => {
    const r = sessionSchema.parse({
      ...base,
      startsAt: "2026-12-31T20:00:00Z",
      endsAt: "2026-12-31T23:00:00Z",
    });
    expect(r.startsAt).toBeInstanceOf(Date);
  });

  it("rejeita eventId não-UUID", () => {
    expect(
      sessionSchema.safeParse({
        eventId: "abc",
        startsAt: "2026-12-31T20:00:00Z",
        endsAt: "2026-12-31T23:00:00Z",
      }).success
    ).toBe(false);
  });
});

describe("venueSchema", () => {
  it("capacidade deve ser inteiro positivo", () => {
    expect(venueSchema.safeParse({ name: "Arena", capacity: -5 }).success).toBe(false);
    expect(venueSchema.safeParse({ name: "Arena", capacity: 5000 }).success).toBe(true);
  });

  it("país default AO", () => {
    expect(venueSchema.parse({ name: "Arena" }).country).toBe("AO");
  });
});
