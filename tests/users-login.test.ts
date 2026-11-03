import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  updateUser: vi.fn(),
  findMembership: vi.fn(),
  rateLimit: vi.fn(),
  verifyPassword: vi.fn(),
  encryptMfaSecret: vi.fn(),
  decryptMfaSecret: vi.fn(),
  isEncryptedMfaSecret: vi.fn(),
  createSession: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser, update: mocks.updateUser },
    orgMembership: { findFirst: mocks.findMembership },
  },
}));

vi.mock("@/shared/lib/security", () => ({
  hashPassword: vi.fn(),
  verifyPassword: mocks.verifyPassword,
  rateLimit: mocks.rateLimit,
  encryptMfaSecret: mocks.encryptMfaSecret,
  decryptMfaSecret: mocks.decryptMfaSecret,
  isEncryptedMfaSecret: mocks.isEncryptedMfaSecret,
}));

vi.mock("@/shared/auth", () => ({
  createSession: mocks.createSession,
  revokeCurrentSession: vi.fn(),
}));

vi.mock("otplib", () => ({
  authenticator: { verify: mocks.verifyTotp },
}));

import { loginUser } from "../src/modules/users/service";

describe("login MFA policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(false);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.findMembership.mockResolvedValue(null);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.decryptMfaSecret.mockReturnValue("authenticator-secret");
    mocks.isEncryptedMfaSecret.mockReturnValue(true);
    mocks.verifyTotp.mockReturnValue(true);
    vi.stubEnv("MFA_ENCRYPTION_KEY", "a".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not require MFA for a non-admin, even if an old MFA flag is set", async () => {
    mocks.findUser.mockResolvedValue({
      id: "customer-1",
      email: "customer@example.com",
      passwordHash: "hash",
      status: "ACTIVE",
      platformRole: "USER",
      mfaEnabled: true,
      mfaSecret: "legacy-secret",
    });

    await expect(loginUser({ email: "customer@example.com", password: "pass" })).resolves.toEqual({
      mfaRequired: false,
    });

    expect(mocks.verifyTotp).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith("customer-1", null, false);
  });

  it("requires a TOTP code for administrators", async () => {
    mocks.findUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      passwordHash: "hash",
      status: "ACTIVE",
      platformRole: "PLATFORM_ADMIN",
      mfaEnabled: true,
      mfaSecret: "encrypted-secret",
    });

    await expect(loginUser({ email: "admin@example.com", password: "pass" })).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("marks the admin panel as verified after successful login MFA", async () => {
    mocks.findUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      passwordHash: "hash",
      status: "ACTIVE",
      platformRole: "PLATFORM_ADMIN",
      mfaEnabled: true,
      mfaSecret: "encrypted-secret",
    });

    await loginUser({ email: "admin@example.com", password: "pass", totpCode: "123456" });

    expect(mocks.verifyTotp).toHaveBeenCalledWith({ token: "123456", secret: "authenticator-secret" });
    expect(mocks.createSession).toHaveBeenCalledWith("admin-1", null, true);
  });
});
