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
