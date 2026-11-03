import { describe, it, expect } from "vitest";
import {
  createBatchSchema,
  createTicketTypeSchema,
  holdRequestSchema,
  updateTicketTypeQuantitySchema,
} from "../src/modules/inventory/schemas";
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
  it("aceita lotes contínuos sem datas de venda", () => {
    expect(createBatchSchema.safeParse({
      ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
      sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
      name: "Venda contínua",
      quantity: 100,
    }).success).toBe(true);
  });

  it("ignora datas antigas de lote enviadas por clientes desatualizados", () => {
    const result = createBatchSchema.safeParse({
      ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
      sessionId: "b3f1c0a0-0000-4000-8000-000000000001",
      name: "Lote legado",
      quantity: 100,
      startsAt: "2026-11-10",
      endsAt: "2026-11-10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("startsAt");
      expect(result.data).not.toHaveProperty("endsAt");
    }
  });
});

describe("createTicketTypeSchema", () => {
  const ticketType = {
    eventId: "b3f1c0a0-0000-4000-8000-000000000001",
    name: "Entrada geral",
    basePriceCents: 500000,
  };

  it("exige a quantidade disponível para ativar a venda", () => {
    expect(createTicketTypeSchema.safeParse(ticketType).success).toBe(false);
    expect(createTicketTypeSchema.safeParse({ ...ticketType, quantity: 100 }).success).toBe(true);
  });
});

describe("updateTicketTypeQuantitySchema", () => {
  it("valida quantidade positiva e identificador do tipo", () => {
    const ticketTypeId = "b3f1c0a0-0000-4000-8000-000000000001";
    expect(updateTicketTypeQuantitySchema.safeParse({ ticketTypeId, quantity: 100 }).success).toBe(true);
    expect(updateTicketTypeQuantitySchema.safeParse({ ticketTypeId, quantity: 0 }).success).toBe(false);
    expect(updateTicketTypeQuantitySchema.safeParse({ ticketTypeId: "invalid", quantity: 100 }).success).toBe(false);
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
          documentType: "PASSAPORTE",
          documentNumber: "AB123456",
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
        {
          ticketTypeId: "b3f1c0a0-0000-4000-8000-000000000002",
          fullName: "Titular Y",
          documentType: "PASSAPORTE",
          documentNumber: "AB123456",
        },
      ],
    });
    expect(r.buyerEmail).toBe("compra@dor.com");
  });
});
