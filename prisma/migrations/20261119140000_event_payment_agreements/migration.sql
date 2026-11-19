-- Acordo comercial por evento, configurado pela administração central.
CREATE TYPE "EventPaymentMode" AS ENUM ('FIXED_PACKAGE', 'PERCENTAGE', 'TICKET_DISCOUNT');

CREATE TABLE "event_payment_agreements" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "mode" "EventPaymentMode" NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "definedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_payment_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_payment_agreements_eventId_key" ON "event_payment_agreements"("eventId");
ALTER TABLE "event_payment_agreements" ADD CONSTRAINT "event_payment_agreements_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
