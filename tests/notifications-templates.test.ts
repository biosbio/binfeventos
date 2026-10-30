import { describe, it, expect } from "vitest";
import { renderTemplate } from "../src/modules/notifications/service";

// Testes de caracterização dos templates (Parte 21).
// Os templates são montados 100% no servidor; protegemos contra
// regressões de texto-chave e interpolação.

describe("renderTemplate", () => {
  it("ORDER_CONFIRMED interpola o número da encomenda", () => {
    const r = renderTemplate("ORDER_CONFIRMED", { orderNumber: "ORD-42" });
    expect(r.subject).toContain("ORD-42");
    expect(r.body).toContain("ORD-42");
  });

  it("MEMBER_INVITED inclui organização e papel (convite por email)", () => {
    const r = renderTemplate("MEMBER_INVITED", {
      orgName: "Produtora X",
      roleName: "TICKET_VALIDATOR",
    });
    expect(r.subject).toContain("Produtora X");
    expect(r.body).toContain("Produtora X");
    expect(r.body).toContain("TICKET_VALIDATOR");
  });

  it("TICKETS_ISSUED inclui o nome do evento", () => {
    const r = renderTemplate("TICKETS_ISSUED", { eventName: "Show E2E" });
    expect(r.subject).toContain("Show E2E");
    expect(r.body).toContain("QR");
  });

  it("EVENT_CANCELLED orienta para instruções de reembolso", () => {
    const r = renderTemplate("EVENT_CANCELLED", { eventName: "Show Y" });
    expect(r.body).toContain("reembolso");
  });

  it("dados ausentes não quebram o template (string vazia)", () => {
    const r = renderTemplate("ORDER_CONFIRMED", {});
    expect(r.subject).toBeTruthy();
    expect(typeof r.body).toBe("string");
  });

  it("SECURITY_ALERT inclui o detalhe fornecido", () => {
    const r = renderTemplate("SECURITY_ALERT", { detail: "login de novo dispositivo" });
    expect(r.body).toContain("login de novo dispositivo");
  });
});
