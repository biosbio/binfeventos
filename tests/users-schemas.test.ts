import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  passwordSchema,
} from "../src/modules/users/schemas";

// Testes de caracterização dos schemas (SEC-09: validação no servidor)
// Requer apenas o pacote zod — sem base de dados.

describe("passwordSchema", () => {
  it("aceita password forte (12+, minúscula, maiúscula, número)", () => {
    expect(passwordSchema.safeParse("SenhaF0rte2026").success).toBe(true);
  });

  it("rejeita password curta", () => {
    expect(passwordSchema.safeParse("Aa1").success).toBe(false);
  });

  it("rejeita sem maiúscula", () => {
    expect(passwordSchema.safeParse("senhaforte2026x").success).toBe(false);
  });

  it("rejeita sem número", () => {
    expect(passwordSchema.safeParse("SenhaFortezinha").success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("normaliza email para minúsculas", () => {
    const result = registerSchema.parse({
      fullName: "Ana Silva",
      email: "Ana.Silva@Example.COM",
      password: "SenhaF0rte2026",
    });
    expect(result.email).toBe("ana.silva@example.com");
  });

  it("rejeita nome curto", () => {
    expect(
      registerSchema.safeParse({ fullName: "An", email: "a@b.co", password: "SenhaF0rte2026" }).success
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("aceita login simples", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x" }).success
    ).toBe(true);
  });

  it("aceita código MFA de 6 dígitos", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x", totpCode: "123456" }).success
    ).toBe(true);
  });

  it("rejeita código MFA não numérico", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x", totpCode: "12ab56" }).success
    ).toBe(false);
  });
});
