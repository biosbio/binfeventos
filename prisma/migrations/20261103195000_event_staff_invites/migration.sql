CREATE TYPE "EventStaffRole" AS ENUM ('SELLER', 'GATE');

CREATE TABLE "event_staff_invites" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "role" "EventStaffRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "event_staff_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_staff_memberships" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inviteId" UUID,
    "role" "EventStaffRole" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "event_staff_memberships_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cash_shifts" ADD COLUMN "eventId" UUID;

CREATE UNIQUE INDEX "event_staff_invites_tokenHash_key" ON "event_staff_invites"("tokenHash");
CREATE INDEX "event_staff_invites_eventId_expiresAt_idx" ON "event_staff_invites"("eventId", "expiresAt");
CREATE UNIQUE INDEX "event_staff_memberships_eventId_userId_key" ON "event_staff_memberships"("eventId", "userId");
CREATE INDEX "event_staff_memberships_eventId_role_approvedAt_idx" ON "event_staff_memberships"("eventId", "role", "approvedAt");
CREATE INDEX "cash_shifts_eventId_operatorUserId_status_idx" ON "cash_shifts"("eventId", "operatorUserId", "status");

ALTER TABLE "event_staff_invites" ADD CONSTRAINT "event_staff_invites_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_staff_invites" ADD CONSTRAINT "event_staff_invites_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "event_staff_memberships" ADD CONSTRAINT "event_staff_memberships_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_staff_memberships" ADD CONSTRAINT "event_staff_memberships_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_staff_memberships" ADD CONSTRAINT "event_staff_memberships_inviteId_fkey"
FOREIGN KEY ("inviteId") REFERENCES "event_staff_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
