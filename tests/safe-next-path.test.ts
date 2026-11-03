import { describe, expect, it } from "vitest";
import { safeNextPath } from "../src/app/_lib/safe-next-path";

describe("safeNextPath", () => {
  it("preserves internal destinations", () => {
    expect(safeNextPath("/painel/eventos/novo")).toBe("/painel/eventos/novo");
    expect(safeNextPath("/painel?tab=events")).toBe("/painel?tab=events");
  });

  it("falls back for external or malformed destinations", () => {
    for (const value of [undefined, "", "https://example.com", "//example.com", "/\\example.com", "/bad\npath"]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });
});
