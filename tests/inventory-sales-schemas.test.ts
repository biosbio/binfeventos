import { describe, it, expect } from "vitest";
import { holdRequestSchema, createBatchSchema } from "../src/modules/inventory/schemas";
import { createOrderSchema } from "../src/modules/sales/schemas";

// Testes de caracterização: o cliente NUNCA pode enviar valores monetários
// para o checkout — o schema os rejeita por não os conhecer (strict por omissão).

describe("holdRequestSchema", () => {
  it("aceita apenas identificadores + quantidade", () => {
    const ok = holdRequestSchema.safeParse({
      sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
      ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
      batchId: "b3f1c0a0-0000-4000-8000-000000000003",
      quantity: 2,
    });
    expect(ok.success).toBe(true);
  });

  it("ignora campos monetários enviados pelo cliente (nunca usados)", () => {
    const r = holdRequestSchema.safeParse({
      sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
      ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
      batchId: "b3f1c0a0-0000-4000-8000-000000000003",
      quantity: 2,
      priceCents: 1,       // tentativa de manipulação
      totalCents: 1,      // ignorado — servidor recalcula
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("priceCents");
      expect(r.data).not.toHaveProperty("totalCents");
    }
  });

  it("rejeita quantidade 0 ou negativa", () => {
    expect(
      holdRequestSchema.safeParse({
        sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
        ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
        batchId: "b3f1c0a0-0000-4000-8000-000000000003",
        quantity: 0,
      }).success
    ).toBe(false);
  });
});

describe("createBatchSchema", () => {
  it("exige janela de comercialização válida", () => {
    expect(
      createBatchSchema.safeParse({
        ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
        sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
        name: "Lote 1",
        quantity: 100,
        startsAt: "2026-11-01T00:00:00Z",
        endsAt: "2026-11-10T00:00:00Z",
      }).success
    ).toBe(true);

    expect(
      createBatchSchema.safeParse({
        ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
        sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
        name: "Lote 1",
        quantity: 100,
        startsAt: "2026-11-10T00:00:00Z",
        endsAt: "2026-11-01T00:00:00Z",
      }).success
    ).toBe(false);
  });
});

describe("createOrderSchema (checkout)", () => {
  const base = {
    holdId: "b3f1c0a0-0000-4000-8000-000000000010",
    buyerName: "Comprador X",
    buyerEmail: "comprador@example.com",
  };

  it("exige pelo menos um titular identificado", () => {
    expect(createOrderSchema.safeParse({ ...base, attendees: [] }).success).toBe(false);
  });

  it("não contém NENHUM campo monetário", () => {
    const r = createOrderSchema.safeParse({
      ...base,
      attendees: [
        {
          ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
          fullName: "Titular Y",
        },
      ],
      totalCents: 1, // tentativa — campo inexistente no schema
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("totalCents");
      expect(r.data).not.toHaveProperty("priceCents");
    }
  });

  it("normaliza email do comprador", () => {
    const r = createOrderSchema.parse({
      ...base,
      buyerEmail: "COMPRA@DOR.com",
      attendees: [
        { ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002", fullName: "Titular Y" },
      ],
    });
    expect(r.buyerEmail).toBe("compra@dor.com");
  });
});
