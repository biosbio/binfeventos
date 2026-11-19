ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'SELLER_REVIEW';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'ORGANIZER_REVIEW';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'PLATFORM_REVIEW';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'REFUND_AWAITING_PLATFORM_CONFIRMATION';

ALTER TABLE "refunds"
  ADD COLUMN "ticketId" UUID,
  ADD COLUMN "sellerReviewedByUserId" UUID,
  ADD COLUMN "sellerReviewedAt" TIMESTAMP(3),
  ADD COLUMN "sellerNotes" TEXT,
  ADD COLUMN "organizerApprovedByUserId" UUID,
  ADD COLUMN "organizerApprovedAt" TIMESTAMP(3),
  ADD COLUMN "organizerNotes" TEXT,
  ADD COLUMN "organizerAssumesRefund" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "platformApprovedByUserId" UUID,
  ADD COLUMN "platformApprovedAt" TIMESTAMP(3),
  ADD COLUMN "platformNotes" TEXT,
  ADD COLUMN "platformOverride" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "refundExecutedByUserId" UUID,
  ADD COLUMN "refundRecipient" TEXT,
  ADD COLUMN "refundMethod" TEXT,
  ADD COLUMN "refundPaidAt" TIMESTAMP(3),
  ADD COLUMN "refundEvidenceRef" TEXT,
  ADD COLUMN "refundEvidenceNotes" TEXT,
  ADD COLUMN "platformConfirmedByUserId" UUID,
  ADD COLUMN "platformConfirmedAt" TIMESTAMP(3);

CREATE INDEX "refunds_ticketId_idx" ON "refunds"("ticketId");
CREATE INDEX "refunds_organizationId_status_idx" ON "refunds"("organizationId", "status");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
