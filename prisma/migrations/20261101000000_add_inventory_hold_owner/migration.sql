ALTER TABLE "inventory_holds"
ADD COLUMN "userId" UUID;

CREATE INDEX "inventory_holds_userId_status_idx"
ON "inventory_holds"("userId", "status");
