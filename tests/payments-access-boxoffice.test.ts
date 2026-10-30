import { describe, it, expect } from "vitest";
import {
  validateQrSchema,
  issueTransferSchema,
  approveTransferSchema,
  createGateSchema,
} from "../src/modules/access/schemas";
import {
  initiatePaymentSchema,
  manualReviewSchema,
} from "../src/modules/payments/schemas";
import {
  openShiftSchema,
  closeShiftSchema,
  boxOfficeSaleSchema,
} from "../src/modules/boxoffice/schemas";

describe("payments: initiatePaymentSchema", () => {
  it("não aceita montante do cliente", () => {
    const r = initiatePaymentSchema.safeParse({
      orderId: "b3f1c0a0-0000-4000-8000-000000000020",
      providerCode: "multicaixa",
      method: "MOBILE_MONEY",
      amountCents: 1, // tentativa de manipulação
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("amountCents");
    }
  });

  it("rejeita método inválido", () => {
    expect(
      initiatePaymentSchema.safeParse({
        orderId: "b3f1c0a0-0000-4000-8000-000000000020",
        providerCode: "multicaixa",
        method: "CRYPTO",
      }).success
    ).toBe(false);
  });
});

describe("payments: manualReviewSchema (Opção C)", () => {
  it("exige evidência escrita (mín. 10 caracteres)", () => {
    expect(
      manualReviewSchema.safeParse({
        paymentId: "b3f1c0a0-0000-4000-8000-000000000021",
        decision: "CONFIRM",
        evidenceNotes: "curta",
      }).success
    ).toBe(false);
  });

  it("aceita revisão com evidência", () => {
    expect(
      manualReviewSchema.safeParse({
        paymentId: "b3f1c0a0-0000-4000-8000-000000000021",
        decision: "CONFIRM",
        evidenceNotes: "Comprovativo bancário verificado no portal do prestador.",
      }).success
    ).toBe(true);
  });
});

describe("access: validateQrSchema", () => {
  it("exige QR token e porta", () => {
    expect(
      validateQrSchema.safeParse({ qrToken: "short", gateCode: "A" }).success
    ).toBe(false);
  });

  it("aceita token válido com conferência de identidade", () => {
    const r = validateQrSchema.parse({
      qrToken: "a".repeat(40),
      gateCode: "PORTA-A",
      identityVerified: true,
    });
    expect(r.identityVerified).toBe(true);
  });
});

describe("access: transferências", () => {
  it("solicitação exige nome do novo titular", () => {
    expect(
      issueTransferSchema.safeParse({
        ticketId: "b3f1c0a0-0000-4000-8000-000000000030",
        newHolderFullName: "Jo",
      }).success
    ).toBe(false);
  });

  it("decisão de rejeição aceita sem motivo (opcional)", () => {
    const r = approveTransferSchema.parse({
      requestId: "b3f1c0a0-0000-4000-8000-000000000031",
      decision: "REJECT",
    });
    expect(r.rejectionReason).toBeUndefined();
  });
});

describe("boxoffice: turnos", () => {
  it("fundo inicial não pode ser negativo", () => {
    expect(
      openShiftSchema.safeParse({ stationCode: "GUICHE-01", openingFloatCents: -1 }).success
    ).toBe(false);
  });

  it("fecho exige contagem e notas", () => {
    expect(
      closeShiftSchema.safeParse({
        shiftId: "b3f1c0a0-0000-4000-8000-000000000040",
        countedCents: 5000,
        differenceNotes: "Falta de troco justificada pelo operador.",
      }).success
    ).toBe(true);
  });

  it("venda presencial exige hold + comprador + titulares", () => {
    expect(
      boxOfficeSaleSchema.safeParse({
        stationCode: "GUICHE-01",
        holdId: "b3f1c0a0-0000-4000-8000-000000000041",
        buyerName: "A",
        buyerEmail: "a@b.co",
        attendees: [],
      }).success
    ).toBe(false);
  });
});

describe("access: createGateSchema", () => {
  it("tipo de porta padrão é ENTRY", () => {
    const r = createGateSchema.parse({
      venueId: "b3f1c0a0-0000-4000-8000-000000000050",
      code: "PORTA-A",
      name: "Porta principal",
    });
    expect(r.gateType).toBe("ENTRY");
  });
});
