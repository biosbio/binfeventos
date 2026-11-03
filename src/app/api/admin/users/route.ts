import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePanelAuth } from "@/shared/auth";
import { errorResponse, AppError, ValidationError, NotFoundError, ForbiddenError } from "@/shared/errors";
import { writeAudit } from "@/shared/audit";
import { prisma } from "@/shared/lib/prisma";

const updateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(3).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
}).refine((value) =>
  value.fullName !== undefined || value.phone !== undefined || value.status !== undefined,
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
      select: { id: true, fullName: true, email: true, phone: true, status: true, platformRole: true },
    });
    if (!existing) throw new NotFoundError("Utilizador");

    // Administradores podem corrigir os próprios dados, mas o estado da conta fica protegido.
    if (existing.platformRole === "PLATFORM_ADMIN" && input.status !== undefined) {
      throw new AppError("PROTECTED_PLATFORM_ADMIN", 403, "O estado das contas de administrador da plataforma não pode ser alterado neste módulo.");
    }
    if (existing.platformRole === "PLATFORM_ADMIN") {
      if (!input.totpCode) {
        throw new ValidationError("Código MFA obrigatório para editar a conta de administrador.");
      }
      const { verifyAdminActionMfa } = await import("@/modules/users/panel-auth");
      await verifyAdminActionMfa(actor, input.totpCode);
    }

    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
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
        select: { id: true, fullName: true, email: true, phone: true, status: true, platformRole: true, createdAt: true },
      });

      // Suspensão/encerramento revoga imediatamente todas as sessões existentes.
      if (input.status && input.status !== "ACTIVE") {
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return user;
    });

    const statusChanged = input.status !== undefined && input.status !== existing.status;
    await writeAudit({
      organizationId: auditOrganization.id,
      actorUserId: actor.userId,
      action: statusChanged ? "admin.user.status_changed" : "admin.user.updated",
      before: { userId: existing.id, fullName: existing.fullName, email: existing.email, phone: existing.phone, status: existing.status },
      after: { userId: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, status: updated.status },
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
