import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePanelAuth } from "@/shared/auth";
import { errorResponse, AppError, ValidationError, NotFoundError, ForbiddenError } from "@/shared/errors";
import { writeAudit } from "@/shared/audit";
import { prisma } from "@/shared/lib/prisma";
import { isPrimaryPlatformAdmin } from "@/modules/users/platform-admin";

const updateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(3).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  platformRole: z.enum(["USER", "PLATFORM_ADMIN"]).optional(),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
}).refine((value) =>
  value.fullName !== undefined || value.phone !== undefined || value.status !== undefined || value.platformRole !== undefined,
  { message: "Indique pelo menos um campo para atualizar." },
);

const sellerMembershipActionSchema = z.object({
  membershipId: z.string().uuid(),
  action: z.enum(["approve", "revoke"]),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePanelAuth();
    if (actor.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError();
    const parsed = sellerMembershipActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
    }

    const membership = await prisma.orgMembership.findFirst({
      where: {
        id: parsed.data.membershipId,
        role: { name: "BOX_OFFICE_OPERATOR", isSystem: true },
      },
      select: {
        id: true,
        organizationId: true,
        acceptedAt: true,
        user: { select: { id: true, status: true } },
      },
    });
    if (!membership) throw new NotFoundError("Associação de vendedor");

    if (parsed.data.action === "approve") {
      if (membership.acceptedAt) {
        throw new AppError("ALREADY_APPROVED", 409, "Este vendedor já está autorizado.");
      }
      if (membership.user.status !== "ACTIVE") {
        throw new AppError("USER_NOT_ACTIVE", 422, "Não é possível autorizar uma conta suspensa ou encerrada.");
      }
      await prisma.orgMembership.update({
        where: { id: membership.id },
        data: { acceptedAt: new Date() },
      });
    } else {
      await prisma.orgMembership.delete({ where: { id: membership.id } });
    }

    await writeAudit({
      organizationId: membership.organizationId,
      actorUserId: actor.userId,
      action: parsed.data.action === "approve"
        ? "admin.boxoffice_seller_approved"
        : "admin.boxoffice_seller_revoked",
      after: { membershipId: membership.id, userId: membership.user.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requirePanelAuth();
    if (actor.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError();

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    const input = parsed.data;

    if (input.userId === actor.userId && input.status && input.status !== "ACTIVE") {
      throw new AppError("SELF_SUSPENSION_BLOCKED", 422, "Não pode suspender ou encerrar a sua própria conta.");
    }

    const existing = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, fullName: true, email: true, phone: true, status: true, platformRole: true, mfaEnabled: true },
    });
    if (!existing) throw new NotFoundError("Utilizador");

    const roleChanged = input.platformRole !== undefined && input.platformRole !== existing.platformRole;
    if (roleChanged && input.userId === actor.userId) {
      throw new AppError("SELF_ROLE_CHANGE_BLOCKED", 422, "Não pode alterar o seu próprio acesso de administrador.");
    }
    if (roleChanged && input.platformRole === "PLATFORM_ADMIN") {
      if (existing.status !== "ACTIVE") {
        throw new AppError("USER_NOT_ACTIVE", 422, "Só é possível promover uma conta ativa.");
      }
    }
    if (roleChanged && input.platformRole === "USER" && existing.platformRole === "PLATFORM_ADMIN") {
      if (isPrimaryPlatformAdmin(existing.email)) {
        throw new AppError("PRIMARY_ADMIN_PROTECTED", 403, "A conta do administrador principal não pode ser removida por esta ação.");
      }
      if (!isPrimaryPlatformAdmin(actor.email)) {
        throw new AppError("PRIMARY_ADMIN_ONLY", 403, "Apenas o administrador principal pode remover acesso de administrador.");
      }
      const adminCount = await prisma.user.count({ where: { platformRole: "PLATFORM_ADMIN", status: "ACTIVE" } });
      if (adminCount <= 1) {
        throw new AppError("LAST_PLATFORM_ADMIN", 422, "Não é possível remover o último administrador ativo da plataforma.");
      }
    }

    // Administradores podem corrigir os próprios dados, mas o estado da conta fica protegido.
    if (existing.platformRole === "PLATFORM_ADMIN" && input.status !== undefined) {
      throw new AppError("PROTECTED_PLATFORM_ADMIN", 403, "O estado das contas de administrador da plataforma não pode ser alterado neste módulo.");
    }
    if (existing.platformRole === "PLATFORM_ADMIN" || roleChanged) {
      if (!input.totpCode) {
        throw new ValidationError("Código MFA obrigatório para alterar acesso de administrador ou editar essa conta.");
      }
      const { verifyAdminActionMfa } = await import("@/modules/users/panel-auth");
      await verifyAdminActionMfa(actor, input.totpCode);
    }

    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.platformRole !== undefined ? { platformRole: input.platformRole } : {}),
      ...(roleChanged && input.platformRole === "PLATFORM_ADMIN" && !existing.mfaEnabled ? { mfaEnabled: false } : {}),
      // Despromover remove o segredo MFA anterior. Se a conta voltar a ser
      // designada administradora, terá de registar um novo autenticador.
      ...(roleChanged && input.platformRole === "USER" && existing.platformRole === "PLATFORM_ADMIN"
        ? { mfaEnabled: false, mfaSecret: null }
        : {}),
    };

    const auditOrganization = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!auditOrganization) {
      throw new AppError("AUDIT_CONTEXT_UNAVAILABLE", 503, "Não foi possível estabelecer o contexto de auditoria.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: input.userId },
        data,
        select: { id: true, fullName: true, email: true, phone: true, status: true, platformRole: true, mfaEnabled: true, createdAt: true },
      });

      if (roleChanged && existing.platformRole === "PLATFORM_ADMIN" && input.platformRole === "USER") {
        const activeAdmins = await tx.user.count({ where: { platformRole: "PLATFORM_ADMIN", status: "ACTIVE" } });
        if (activeAdmins < 1) {
          throw new AppError("LAST_PLATFORM_ADMIN", 422, "Não é possível remover o último administrador ativo da plataforma.");
        }
      }

      // Alterações de função ou suspensão encerram sessões antigas imediatamente.
      if (roleChanged || (input.status && input.status !== "ACTIVE")) {
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return user;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const statusChanged = input.status !== undefined && input.status !== existing.status;
    await writeAudit({
      organizationId: auditOrganization.id,
      actorUserId: actor.userId,
      action: roleChanged ? "admin.user.role_changed" : statusChanged ? "admin.user.status_changed" : "admin.user.updated",
      before: { userId: existing.id, fullName: existing.fullName, email: existing.email, phone: existing.phone, status: existing.status, platformRole: existing.platformRole, mfaEnabled: existing.mfaEnabled },
      after: { userId: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, status: updated.status, platformRole: updated.platformRole, mfaEnabled: updated.mfaEnabled },
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
