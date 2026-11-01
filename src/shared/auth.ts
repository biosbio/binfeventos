import { cookies } from "next/headers";
import { prisma } from "@/shared/lib/prisma";
import { sha256 } from "@/shared/lib/security";
import { assertOrgActive } from "@/shared/audit";
import { AppError, ForbiddenError, UnauthorizedError } from "@/shared/errors";
import type { PermissionCode } from "@/shared/permissions";

// ============================================================
// Sessão + Guards de autorização (SEC-01, SEC-02, SEC-03)
//
// - Sessão opaca: cookie HttpOnly/Secure/SameSite guarda o token PLANO;
//   a base guarda apenas o SHA-256 (tokenHash).
// - Contexto organizacional obrigatório para operações multiempresa.
// - requirePermission valida ABAC: permissão + pertença à organização.
// ============================================================

export const SESSION_COOKIE = "binf_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

export interface AuthContext {
  userId: string;
  email: string;
  organizationId: string | null;
  permissions: Set<string>;
  mfaEnabled: boolean;
  platformRole: "USER" | "PLATFORM_ADMIN";
  sessionId: string;
  panelVerifiedUntil: Date | null;
}

/** Cria a sessão e define o cookie seguro. */
export async function createSession(userId: string, organizationId: string | null): Promise<void> {
  const token = crypto.randomUUID() + "." + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      organizationId,
      tokenHash: sha256(token),
      expiresAt,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // SEC-03: inacessível a JavaScript
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Revoga a sessão atual (logout / suspeita de abuso). */
export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  store.delete(SESSION_COOKIE);
}

/** Carrega o contexto de autenticação da sessão atual ou null. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;

  // Permissões limitadas à organização ativa da sessão (ABAC).
  // Nunca agregar permissões de organizações diferentes.
  const permissions = new Set<string>();
  if (session.organizationId) {
    const memberships = await prisma.orgMembership.findMany({
      where: {
        userId: session.userId,
        organizationId: session.organizationId,
        acceptedAt: { not: null },
      },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });
    for (const membership of memberships) {
      for (const rolePermission of membership.role.rolePermissions) {
        const code = rolePermission.permission.code;
        // Platform-wide permissions derive only from User.platformRole,
        // never from an organization membership or a custom organization role.
        if (code !== "admin:platform" && code !== "subscription:manage") {
          permissions.add(code);
        }
      }
    }
  }

  if (session.user.platformRole === "PLATFORM_ADMIN") {
    permissions.add("admin:platform");
    permissions.add("subscription:manage");
    permissions.add("audit:read");
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    organizationId: session.organizationId,
    permissions,
    mfaEnabled: session.user.mfaEnabled,
    platformRole: session.user.platformRole,
    sessionId: session.id,
    panelVerifiedUntil: session.panelVerifiedUntil,
  };
}

/** Exige sessão válida. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

/**
 * Exige sessão + permissão + contexto organizacional (ABAC).
 * A permissão só vale DENTRO da organização ativa da sessão.
 */
export async function requirePermission(permission: PermissionCode): Promise<AuthContext> {
  const ctx = await requirePanelAuth();
  if (!ctx.organizationId && !ctx.permissions.has("admin:platform")) {
    throw new ForbiddenError("no-active-organization");
  }
  if (!ctx.permissions.has(permission)) {
    throw new ForbiddenError(permission);
  }
  return ctx;
}

/** Utilizador autenticado pertence à organização indicada? */
export async function isMemberOf(ctx: AuthContext, organizationId: string): Promise<boolean> {
  // Nunca confiar apenas no organizationId guardado na sessão: a
  // associação pode ter sido revogada depois da criação da sessão.
  const membership = await prisma.orgMembership.findFirst({
    where: {
      userId: ctx.userId,
      organizationId,
      acceptedAt: { not: null },
    },
    select: { id: true },
  });
  return membership !== null;
}

/** Exige autenticação reforçada recente para qualquer rota sob /painel. */
export async function requirePanelAuth(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }
  return ctx;
}

/** Marca apenas a sessão atual como validada, por uma janela curta. */
export async function markPanelVerified(sessionId: string): Promise<void> {
  const { prisma } = await import("@/shared/lib/prisma");
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { panelVerifiedUntil: new Date(Date.now() + 10 * 60 * 1000) },
  });
}
