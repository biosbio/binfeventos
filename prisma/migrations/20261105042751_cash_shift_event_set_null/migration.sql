-- DropForeignKey
ALTER TABLE "cash_shifts" DROP CONSTRAINT "cash_shifts_eventId_fkey";

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
