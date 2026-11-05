DROP INDEX "event_staff_memberships_eventId_userId_key";
CREATE UNIQUE INDEX "event_staff_memberships_eventId_userId_role_key"
ON "event_staff_memberships"("eventId", "userId", "role");
