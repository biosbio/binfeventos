import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requireAuth, requirePermission } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Módulo organizations — rotas API
//   POST /api/organizations          — criar organização (autenticado)
//   GET  /api/organizations/members   — listar membros (org ativa)
//   POST /api/organizations/members  — convidar membro (org:invite)
//   POST /api/organizations/members/accept — aceitar convite
//   POST /api/organizations/members/role    — mudar papel (org:role:assign)
// ============================================================

function parseBody<TSchema extends z.ZodType>(schema: TSchema, data: unknown): z.output<TSchema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => `${i.path.map((part) => String(part)).join(".")}: ${i.message}`).join("; ")
    );
  }
  return result.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "create") {
      const auth = await requireAuth();
      const body = parseBody((await import("@/modules/organizations/schemas")).createOrgSchema, await req.json());
      const { createOrganization } = await import("@/modules/organizations/service");
      const org = await createOrganization(auth, body);
      return NextResponse.json({ ok: true, organization: org }, { status: 201 });
    }

    if (path === "members/invite") {
      const auth = await requirePermission("org:invite");
      const body = parseBody((await import("@/modules/organizations/schemas")).inviteMemberSchema, await req.json());
      const { inviteMember } = await import("@/modules/organizations/service");
      const result = await inviteMember(auth, body);
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    }

    if (path === "members/accept") {
      const auth = await requireAuth();
      const body = parseBody(z.object({ organizationId: z.string().uuid() }), await req.json());
      const { acceptInvitation } = await import("@/modules/organizations/service");
      await acceptInvitation(auth, body.organizationId);
      return NextResponse.json({ ok: true });
    }

    if (path === "members/role") {
      const auth = await requirePermission("org:role:assign");
      const body = parseBody((await import("@/modules/organizations/schemas")).assignRoleSchema, await req.json());
      const { assignRole } = await import("@/modules/organizations/service");
      await assignRole(auth, body.memberId, body.roleName);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "members") {
      const auth = await requirePermission("org:manage");
      const { listMembers } = await import("@/modules/organizations/service");
      const members = await listMembers(auth);
      return NextResponse.json({ ok: true, members });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
