import { describe, expect, it } from "vitest";
import { getCountryOptions, getCurrencyOptions } from "../src/shared/lib/locale-options";

describe("organization locale options", () => {
  it("includes the full country selector with localized common countries", () => {
    const countries = getCountryOptions();
    expect(countries.length).toBeGreaterThan(240);
    expect(countries).toContainEqual({ code: "GW", name: "Guiné-Bissau" });
    expect(countries).toContainEqual({ code: "AO", name: "Angola" });
  });

  it("includes supported currencies with localized names", () => {
    const currencies = getCurrencyOptions();
    expect(currencies.length).toBeGreaterThan(100);
    expect(currencies.find(({ code }) => code === "XOF")?.name).toMatch(/CFA/i);
    expect(currencies.find(({ code }) => code === "AOA")?.name).toBeTruthy();
  });
});
