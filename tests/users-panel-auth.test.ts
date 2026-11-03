import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  rateLimit: vi.fn(),
  verifyPassword: vi.fn(),
  markPanelVerified: vi.fn(),
  decryptMfaSecret: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));

vi.mock("@/shared/lib/security", () => ({
  verifyPassword: mocks.verifyPassword,
  rateLimit: mocks.rateLimit,
  decryptMfaSecret: mocks.decryptMfaSecret,
  encryptMfaSecret: vi.fn(),
  isEncryptedMfaSecret: vi.fn(),
}));

vi.mock("otplib", () => ({
  authenticator: { verify: mocks.verifyTotp },
}));

vi.mock("@/shared/auth", () => ({
  markPanelVerified: mocks.markPanelVerified,
}));

import { verifyAdminActionMfa, verifyOrganizerPanelPassword } from "../src/modules/users/panel-auth";
import type { AuthContext } from "../src/shared/auth";

const organizerContext: AuthContext = {
  userId: "organizer-1",
  email: "organizer@example.com",
  organizationId: "organization-1",
  permissions: new Set(["event:read", "event:update"]),
  mfaEnabled: false,
  platformRole: "USER",
  sessionId: "session-1",
  panelVerifiedUntil: null,
};

const adminContext: AuthContext = {
  ...organizerContext,
  userId: "admin-1",
  email: "admin@example.com",
  organizationId: null,
  permissions: new Set(["admin:platform"]),
  mfaEnabled: true,
  platformRole: "PLATFORM_ADMIN",
};

describe("organizer panel password confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(false);
    mocks.findUser.mockResolvedValue({ passwordHash: "hashed-password" });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.markPanelVerified.mockResolvedValue(undefined);
  });

  describe("admin MFA confirmation for protected account edits", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.rateLimit.mockResolvedValue(false);
      mocks.findUser.mockResolvedValue({ mfaEnabled: true, mfaSecret: "encrypted-secret" });
      mocks.decryptMfaSecret.mockReturnValue("base32-secret");
      mocks.verifyTotp.mockReturnValue(true);
      vi.stubEnv("MFA_ENCRYPTION_KEY", "a".repeat(64));
    });

    it("accepts a valid TOTP for an administrator", async () => {
      await expect(verifyAdminActionMfa(adminContext, "123456")).resolves.toBeUndefined();
      expect(mocks.verifyTotp).toHaveBeenCalledWith({ token: "123456", secret: "base32-secret" });
    });

    it("rejects a user who is not a platform administrator", async () => {
      await expect(verifyAdminActionMfa(organizerContext, "123456")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocks.findUser).not.toHaveBeenCalled();
    });

    it("rejects an invalid TOTP", async () => {
      mocks.verifyTotp.mockReturnValue(false);
      await expect(verifyAdminActionMfa(adminContext, "123456")).rejects.toMatchObject({
        code: "INVALID_MFA",
      });
    });
  });

  it("verifies the password and elevates only the current session", async () => {
    await verifyOrganizerPanelPassword(organizerContext, "correct-password");

    expect(mocks.verifyPassword).toHaveBeenCalledWith("hashed-password", "correct-password");
    expect(mocks.markPanelVerified).toHaveBeenCalledWith("session-1");
  });

  it("does not elevate the session when the password is wrong", async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    await expect(verifyOrganizerPanelPassword(organizerContext, "wrong-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(mocks.markPanelVerified).not.toHaveBeenCalled();
  });
});
