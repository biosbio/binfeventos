ALTER TABLE "cash_deposits"
  ADD COLUMN "outstandingCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "receivedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "differenceNotes" TEXT;

UPDATE "cash_deposits" SET "outstandingCents" = "amountCents";
