import { describe, it, expect } from "vitest";
import {
  createEventSchema,
  sessionSchema,
  venueSchema,
  eventSlugSchema,
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
