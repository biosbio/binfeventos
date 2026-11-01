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
}).refine((value) =>
  value.fullName !== undefined || value.phone !== undefined || value.status !== undefined,
  { message: "Indique pelo menos um campo para atualizar." },
);

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

    // Contas com privilégios de plataforma são protegidas contra alterações por este módulo.
    if (existing.platformRole === "PLATFORM_ADMIN") {
      throw new AppError("PROTECTED_PLATFORM_ADMIN", 403, "Contas de administrador da plataforma não podem ser alteradas neste módulo.");
    }

    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    const updated = await prisma.user.update({
      where: { id: input.userId },
      data,
      select: { id: true, fullName: true, email: true, phone: true, status: true, platformRole: true, createdAt: true },
    });

    // AuditLog exige organizationId. A organização de referência é apenas o escopo
    // técnico do registo; não altera nem concede pertença organizacional ao utilizador.
    const auditOrganization = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!auditOrganization) {
      console.error("[admin-user-audit] No organization available for required audit context.");
    } else {
      const statusChanged = input.status !== undefined && input.status !== existing.status;
      await writeAudit({
        organizationId: auditOrganization.id,
        actorUserId: actor.userId,
        action: statusChanged ? "admin.user.status_changed" : "admin.user.updated",
        before: { userId: existing.id, fullName: existing.fullName, email: existing.email, phone: existing.phone, status: existing.status },
        after: { userId: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, status: updated.status },
      });
    }

    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
