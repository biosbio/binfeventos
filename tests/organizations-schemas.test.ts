import { describe, it, expect } from "vitest";
import {
  createOrgSchema,
  slugSchema,
  inviteMemberSchema,
  sellerInviteClaimSchema,
  sellerMembershipSchema,
  sellerInviteIdSchema,
} from "../src/modules/organizations/schemas";
import { SYSTEM_ROLES } from "../src/shared/permissions";

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

describe("seller invite schemas", () => {
  it("validates request tokens and organizer actions", () => {
    const uuid = "b3f1c0a0-0000-4000-8000-000000000001";
    expect(sellerInviteClaimSchema.safeParse({ token: "A".repeat(43) }).success).toBe(true);
    expect(sellerInviteClaimSchema.safeParse({ token: "invalid" }).success).toBe(false);
    expect(sellerMembershipSchema.safeParse({ memberId: uuid }).success).toBe(true);
    expect(sellerInviteIdSchema.safeParse({ inviteId: uuid }).success).toBe(true);
  });

  describe("seller role permissions", () => {
    it("keeps vendor access limited and reserves approval management for organizers", () => {
      expect(SYSTEM_ROLES.ORGANIZER).toContain("org:invite");
      expect(SYSTEM_ROLES.BOX_OFFICE_OPERATOR).toContain("boxoffice:sell");
      expect(SYSTEM_ROLES.BOX_OFFICE_OPERATOR).not.toContain("org:invite");
      expect(SYSTEM_ROLES.BOX_OFFICE_OPERATOR).not.toContain("event:create");
    });
  });
});
