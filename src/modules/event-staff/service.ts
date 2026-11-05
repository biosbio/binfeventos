import { randomBytes } from "node:crypto";
import { prisma } from "@/shared/lib/prisma";
import { ForbiddenError, NotFoundError, ConflictError, UnauthorizedError } from "@/shared/errors";
import { writeAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import { sha256 } from "@/shared/lib/security";

export type EventStaffRole = "SELLER" | "GATE";

async function assertEventOrganizer(ctx: AuthContext, eventId: string) {
  if (!ctx.organizationId || !ctx.permissions.has("event:update")) {
    throw new ForbiddenError("event:update");
  }
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      organizationId: ctx.organizationId,
      responsibleUserId: ctx.userId,
      organization: { status: "ACTIVE" },
    },
    select: { id: true, organizationId: true, name: true },
  });
  if (!event) throw new NotFoundError("Evento");
  return event;
}

export async function createEventStaffInvite(
  ctx: AuthContext,
  eventId: string,
  role: EventStaffRole,
) {
  const event = await assertEventOrganizer(ctx, eventId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const invite = await prisma.eventStaffInvite.create({
    data: {
      eventId: event.id,
      createdByUserId: ctx.userId,
      role,
      tokenHash: sha256(token),
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "event.staff_invite_created",
    after: { eventId, inviteId: invite.id, role },
  });
  return { ...invite, token };
}

export async function getEventStaffInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new NotFoundError("Convite");
  const invite = await prisma.eventStaffInvite.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      eventId: true,
      role: true,
      expiresAt: true,
      revokedAt: true,
      event: {
        select: {
          name: true,
          status: true,
          organization: { select: { id: true, status: true } },
        },
      },
    },
  });
  if (
    !invite ||
    invite.revokedAt ||
    invite.expiresAt <= new Date() ||
    ["CANCELLED", "COMPLETED", "CLOSED"].includes(invite.event.status) ||
    invite.event.organization.status !== "ACTIVE"
  ) {
    throw new NotFoundError("Convite");
  }
  return {
    id: invite.id,
    eventId: invite.eventId,
    eventName: invite.event.name,
    role: invite.role,
    organizationId: invite.event.organization.id,
    expiresAt: invite.expiresAt,
  };
}

export async function claimEventStaffInvite(ctx: AuthContext, token: string) {
  const invite = await getEventStaffInvite(token);
  const membership = await prisma.$transaction(async (tx) => {
    const session = await tx.session.updateMany({
      where: {
        id: ctx.sessionId,
        userId: ctx.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { organizationId: invite.organizationId },
    });
    if (session.count !== 1) throw new UnauthorizedError();

    const result = await tx.eventStaffMembership.upsert({
      where: { eventId_userId: { eventId: invite.eventId, userId: ctx.userId } },
      update: {},
      create: {
        eventId: invite.eventId,
        userId: ctx.userId,
        inviteId: invite.id,
        role: invite.role,
      },
      select: { id: true, role: true, approvedAt: true },
    });
    if (result.role !== invite.role) {
      throw new ConflictError("Já existe um pedido com outra função para este evento.");
    }
    return result;
  });

  if (!membership.approvedAt) {
    await writeAudit({
      organizationId: invite.organizationId,
      actorUserId: ctx.userId,
      action: "event.staff_access_requested",
      after: { eventId: invite.eventId, inviteId: invite.id, role: invite.role },
    });
  }
  return membership.approvedAt ? "approved" : "pending";
}

export async function approveEventStaffMember(
  ctx: AuthContext,
  eventId: string,
  memberId: string,
) {
  const event = await assertEventOrganizer(ctx, eventId);
  const updated = await prisma.eventStaffMembership.updateMany({
    where: {
      id: memberId,
      eventId,
      approvedAt: null,
      user: { status: "ACTIVE" },
    },
    data: { approvedAt: new Date() },
  });
  if (updated.count !== 1) throw new NotFoundError("Pedido de acesso");
  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "event.staff_access_approved",
    after: { eventId, memberId },
  });
}

export async function rejectEventStaffMember(
  ctx: AuthContext,
  eventId: string,
  memberId: string,
) {
  const event = await assertEventOrganizer(ctx, eventId);
  const deleted = await prisma.eventStaffMembership.deleteMany({
    where: { id: memberId, eventId, approvedAt: null },
  });
  if (deleted.count !== 1) throw new NotFoundError("Pedido de acesso");
  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "event.staff_access_rejected",
    after: { eventId, memberId },
  });
}

export async function revokeEventStaffMember(
  ctx: AuthContext,
  eventId: string,
  memberId: string,
) {
  const event = await assertEventOrganizer(ctx, eventId);
  const deleted = await prisma.eventStaffMembership.deleteMany({
    where: { id: memberId, eventId, approvedAt: { not: null } },
  });
  if (deleted.count !== 1) throw new NotFoundError("Acesso da equipa");
  await writeAudit({
    organizationId: event.organizationId,
    actorUserId: ctx.userId,
    action: "event.staff_access_revoked",
    after: { eventId, memberId },
  });
}

export async function revokeEventStaffInvite(ctx: AuthContext, inviteId: string) {
  if (!ctx.organizationId || !ctx.permissions.has("event:update")) {
    throw new ForbiddenError("event:update");
  }
  const invite = await prisma.eventStaffInvite.findFirst({
    where: {
      id: inviteId,
      event: {
        organizationId: ctx.organizationId,
        responsibleUserId: ctx.userId,
      },
    },
    select: { id: true, eventId: true, event: { select: { organizationId: true } } },
  });
  if (!invite) throw new NotFoundError("Convite");
  const updated = await prisma.eventStaffInvite.updateMany({
    where: { id: invite.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count !== 1) throw new NotFoundError("Convite");
  await writeAudit({
    organizationId: invite.event.organizationId,
    actorUserId: ctx.userId,
    action: "event.staff_invite_revoked",
    after: { eventId: invite.eventId, inviteId },
  });
}

export async function hasApprovedEventStaffRole(
  ctx: AuthContext,
  eventId: string,
  role: EventStaffRole,
) {
  if (!ctx.organizationId) return false;
  const membership = await prisma.eventStaffMembership.findFirst({
    where: {
      eventId,
      userId: ctx.userId,
      role,
      approvedAt: { not: null },
      event: { organizationId: ctx.organizationId, organization: { status: "ACTIVE" } },
      user: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  return membership !== null;
}
