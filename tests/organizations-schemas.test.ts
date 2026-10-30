import { describe, it, expect } from "vitest";
import {
  createOrgSchema,
  slugSchema,
  inviteMemberSchema,
} from "../src/modules/organizations/schemas";

describe("slugSchema", () => {
  it("aceita slug válido", () => {
    expect(slugSchema.safeParse("meus-eventos").success).toBe(true);
  });

  it("normaliza para minúsculas", () => {
    expect(slugSchema.parse("MeusEventos")).toBe("meuseventos");
  });

  it("rejeita espaços e caracteres especiais", () => {
    expect(slugSchema.safeParse("meus eventos!").success).toBe(false);
  });

  it("rejeita slug curto", () => {
    expect(slugSchema.safeParse("ab").success).toBe(false);
  });
});

describe("createOrgSchema", () => {
  it("aplica defaults de país e moeda", () => {
    const result = createOrgSchema.parse({ name: "Produtora X", slug: "produtora-x" });
    expect(result.country).toBe("AO");
    expect(result.currency).toBe("AOA");
  });

  it("rejeita país com mais de 2 caracteres", () => {
    expect(
      createOrgSchema.safeParse({ name: "X", slug: "abc", country: "ANG" }).success
    ).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  it("exige email e papel", () => {
    expect(
      inviteMemberSchema.safeParse({ email: "a@b.co", roleName: "ORGANIZER" }).success
    ).toBe(true);
  });

  it("rejeita email inválido", () => {
    expect(inviteMemberSchema.safeParse({ email: "nope", roleName: "ORGANIZER" }).success).toBe(false);
  });
});
