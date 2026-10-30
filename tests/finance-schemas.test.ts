import { describe, it, expect } from "vitest";
import {
  requestRefundSchema,
  approveRefundSchema,
  prepareSettlementSchema,
  adjustLedgerSchema,
  reserveSchema,
} from "../src/modules/finance/schemas";

describe("finance: requestRefundSchema", () => {
  it("exige motivo com pelo menos 5 caracteres", () => {
    expect(
      requestRefundSchema.safeParse({
        orderId: "b3f1c0a0-0000-4000-8000-000000000060",
        amountCents: 1000,
        reason: "oi",
      }).success
    ).toBe(false);
  });

  it("rejeita valor negativo ou zero", () => {
    expect(
      requestRefundSchema.safeParse({
        orderId: "b3f1c0a0-0000-4000-8000-000000000060",
        amountCents: 0,
        reason: "evento cancelado",
      }).success
    ).toBe(false);
  });
});

describe("finance: prepareSettlementSchema", () => {
  it("exige período válido", () => {
    expect(
      prepareSettlementSchema.safeParse({
        periodStart: "2026-11-01",
        periodEnd: "2026-10-01",
      }).success
    ).toBe(false);
  });

  it("aceita período válido", () => {
    const r = prepareSettlementSchema.parse({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    expect(r.periodStart).toBeInstanceOf(Date);
  });
});

describe("finance: adjustLedgerSchema (compensatório)", () => {
  it("não pode ser zero", () => {
    expect(
      adjustLedgerSchema.safeParse({
        compensatesEntryId: "b3f1c0a0-0000-4000-8000-000000000061",
        description: "Correção de lançamento duplicado",
        amountCents: 0,
      }).success
    ).toBe(false);
  });

  it("aceita compensação negativa (estorno)", () => {
    expect(
      adjustLedgerSchema.safeParse({
        compensatesEntryId: "b3f1c0a0-0000-4000-8000-000000000061",
        description: "Estorno de lançamento indevido",
        amountCents: -5000,
      }).success
    ).toBe(true);
  });
});

describe("finance: reserveSchema", () => {
  it("exige motivo e valor positivo", () => {
    expect(
      reserveSchema.safeParse({ amountCents: 100, reason: "risco de chargeback" }).success
    ).toBe(true);
    expect(reserveSchema.safeParse({ amountCents: -1, reason: "x".repeat(6) }).success).toBe(false);
  });
});
