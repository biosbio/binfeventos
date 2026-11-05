import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/shared/auth";
import { errorResponse, ValidationError } from "@/shared/errors";

function parse<TSchema extends z.ZodType>(schema: TSchema, data: unknown): z.output<TSchema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const { action } = await context.params;
  const path = action.join("/");

  try {
    if (path === "invites/create") {
      const auth = await requirePermission("event:update");
      const body = parse(
        (await import("@/modules/event-staff/schemas")).createEventStaffInviteSchema,
        await req.json(),
      );
      const { createEventStaffInvite } = await import("@/modules/event-staff/service");
      const invite = await createEventStaffInvite(auth, body.eventId, body.role);
      return NextResponse.json({ ok: true, invite }, { status: 201 });
    }

    if (path === "invites/claim") {
      const auth = await requireAuth();
      const body = parse(
        (await import("@/modules/event-staff/schemas")).claimEventStaffInviteSchema,
        await req.json(),
      );
      const { claimEventStaffInvite } = await import("@/modules/event-staff/service");
      const status = await claimEventStaffInvite(auth, body.token);
      return NextResponse.json({ ok: true, status });
    }

    if (path === "members/approve" || path === "members/reject" || path === "members/revoke") {
      const auth = await requirePermission("event:update");
      const body = parse(
        (await import("@/modules/event-staff/schemas")).eventStaffMemberSchema,
        await req.json(),
      );
      const { approveEventStaffMember, rejectEventStaffMember, revokeEventStaffMember } =
        await import("@/modules/event-staff/service");
      if (path === "members/approve") {
        await approveEventStaffMember(auth, body.eventId, body.memberId);
      } else if (path === "members/reject") {
        await rejectEventStaffMember(auth, body.eventId, body.memberId);
      } else {
        await revokeEventStaffMember(auth, body.eventId, body.memberId);
      }
      return NextResponse.json({ ok: true });
    }

    if (path === "invites/revoke") {
      const auth = await requirePermission("event:update");
      const body = parse(
        (await import("@/modules/event-staff/schemas")).eventStaffInviteIdSchema,
        await req.json(),
      );
      const { revokeEventStaffInvite } = await import("@/modules/event-staff/service");
      await revokeEventStaffInvite(auth, body.inviteId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
