ALTER TABLE "ticket_batches"
  ALTER COLUMN "startsAt" DROP NOT NULL,
  ALTER COLUMN "endsAt" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'OPEN';

UPDATE "ticket_batches"
SET "startsAt" = NULL, "endsAt" = NULL
WHERE "status" IN ('OPEN', 'SCHEDULED', 'PAUSED');

UPDATE "ticket_batches"
SET "status" = 'OPEN'
WHERE "status" = 'SCHEDULED';
