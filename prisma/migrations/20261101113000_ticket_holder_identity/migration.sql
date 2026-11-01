ALTER TABLE "tickets"
  ADD COLUMN "holderUserId" UUID,
  ADD COLUMN "holderEmail" TEXT,
  ADD COLUMN "holderName" TEXT;

-- Inicialmente, o comprador atual é o titular até uma transferência aprovada.
UPDATE "tickets" AS t
SET "holderUserId" = o."buyerUserId"
FROM "orders" AS o
WHERE t."orderId" = o."id";

UPDATE "tickets" AS t
SET "holderEmail" = a."email", "holderName" = a."fullName"
FROM "order_attendees" AS a
WHERE t."orderAttendeeId" = a."id";

UPDATE "tickets" AS t
SET "holderEmail" = o."buyerEmail"
FROM "orders" AS o
WHERE t."orderId" = o."id"
  AND t."holderEmail" IS NULL
  AND o."buyerEmail" IS NOT NULL;

-- Bilhetes já transferidos pertencem ao titular atual, não ao comprador original.
-- Se o titular ainda não tiver conta, o email fica como mecanismo de associação.
UPDATE "tickets" AS t
SET "holderUserId" = (
  SELECT u."id"
  FROM "order_attendees" AS a
  JOIN "users" AS u ON lower(u."email") = lower(a."email")
  WHERE a."id" = t."orderAttendeeId"
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "ticket_transfer_requests" AS tr
  WHERE tr."ticketId" = t."id"
    AND tr."status" = 'COMPLETED'
);

CREATE INDEX "tickets_holderUserId_status_idx"
ON "tickets"("holderUserId", "status");

CREATE INDEX "tickets_holderEmail_status_idx"
ON "tickets"("holderEmail", "status");
