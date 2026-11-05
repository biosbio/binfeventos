import { describe, expect, it } from "vitest";
import {
  claimEventStaffInviteSchema,
  createEventStaffInviteSchema,
  eventStaffMemberSchema,
} from "../src/modules/event-staff/schemas";

describe("event staff invite schemas", () => {
  const eventId = "b3f1c0a0-0000-4000-8000-000000000001";

  it("accepts seller and gate roles scoped to an event", () => {
    expect(createEventStaffInviteSchema.safeParse({ eventId, role: "SELLER" }).success).toBe(true);
    expect(createEventStaffInviteSchema.safeParse({ eventId, role: "GATE" }).success).toBe(true);
    expect(createEventStaffInviteSchema.safeParse({ eventId, role: "ORG_ADMIN" }).success).toBe(false);
  });

  it("requires a token with the generated invite format", () => {
    expect(claimEventStaffInviteSchema.safeParse({ token: "A".repeat(43) }).success).toBe(true);
    expect(claimEventStaffInviteSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(claimEventStaffInviteSchema.safeParse({ token: `${"A".repeat(42)}!` }).success).toBe(false);
  });

  it("requires both event and member ids for organizer decisions", () => {
    expect(eventStaffMemberSchema.safeParse({
      eventId,
      memberId: "b3f1c0a0-0000-4000-8000-000000000002",
    }).success).toBe(true);
    expect(eventStaffMemberSchema.safeParse({ eventId, memberId: "not-a-uuid" }).success).toBe(false);
  });
});
