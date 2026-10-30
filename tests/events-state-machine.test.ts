import { describe, it, expect } from "vitest";
import {
  EVENT_TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
} from "../src/modules/events/state-machine";

// Testes de caracterização da máquina de estados (Domínio 2).
// Estes testes protegem o comportamento contra regressões futuras.

describe("máquina de estados do evento", () => {
  it("DRAFT só pode ir para PUBLISHED ou CANCELLED", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition("DRAFT", "SUSPENDED")).toBe(false);
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
  });

  it("PUBLISHED pode suspender, esgotar, adiar, cancelar ou concluir", () => {
    expect(canTransition("PUBLISHED", "SUSPENDED")).toBe(true);
    expect(canTransition("PUBLISHED", "SOLD_OUT")).toBe(true);
    expect(canTransition("PUBLISHED", "POSTPONED")).toBe(true);
    expect(canTransition("PUBLISHED", "CANCELLED")).toBe(true);
    expect(canTransition("PUBLISHED", "COMPLETED")).toBe(true);
  });

  it("SUSPENDED volta a PUBLISHED ou cancela", () => {
    expect(canTransition("SUSPENDED", "PUBLISHED")).toBe(true);
    expect(canTransition("SUSPENDED", "CANCELLED")).toBe(true);
    expect(canTransition("SUSPENDED", "SOLD_OUT")).toBe(false);
  });

  it("SOLD_OUT volta a PUBLISHED quando inventário libertado", () => {
    expect(canTransition("SOLD_OUT", "PUBLISHED")).toBe(true);
    expect(canTransition("SOLD_OUT", "CANCELLED")).toBe(false);
  });

  it("POSTPONED volta a PUBLISHED ou cancela", () => {
    expect(canTransition("POSTPONED", "PUBLISHED")).toBe(true);
    expect(canTransition("POSTPONED", "CANCELLED")).toBe(true);
  });

  it("estados terminais não transicionam", () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(EVENT_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });

  it("não permite transição para si mesmo", () => {
    for (const status of Object.keys(EVENT_TRANSITIONS) as (keyof typeof EVENT_TRANSITIONS)[]) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});
