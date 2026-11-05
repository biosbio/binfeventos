import { z } from "zod";

const inviteToken = z.string().min(40).max(50).regex(/^[A-Za-z0-9_-]+$/);

export const createEventStaffInviteSchema = z.object({
  eventId: z.string().uuid(),
  role: z.enum(["SELLER", "GATE"]),
});

export const claimEventStaffInviteSchema = z.object({ token: inviteToken });

export const eventStaffMemberSchema = z.object({
  eventId: z.string().uuid(),
  memberId: z.string().uuid(),
});

export const eventStaffInviteIdSchema = z.object({ inviteId: z.string().uuid() });

export { inviteToken as eventStaffInviteTokenSchema };
