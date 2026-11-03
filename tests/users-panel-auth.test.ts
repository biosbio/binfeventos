import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  rateLimit: vi.fn(),
  verifyPassword: vi.fn(),
  markPanelVerified: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));

vi.mock("@/shared/lib/security", () => ({
  verifyPassword: mocks.verifyPassword,
  rateLimit: mocks.rateLimit,
  decryptMfaSecret: vi.fn(),
  encryptMfaSecret: vi.fn(),
  isEncryptedMfaSecret: vi.fn(),
}));

vi.mock("@/shared/auth", () => ({
  markPanelVerified: mocks.markPanelVerified,
}));

import { verifyOrganizerPanelPassword } from "../src/modules/users/panel-auth";
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

describe("organizer panel password confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(false);
    mocks.findUser.mockResolvedValue({ passwordHash: "hashed-password" });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.markPanelVerified.mockResolvedValue(undefined);
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
