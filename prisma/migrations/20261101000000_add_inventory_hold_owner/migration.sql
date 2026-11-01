ALTER TABLE "inventory_holds"
ADD COLUMN "userId" UUID;

-- Recupera o proprietário das reservas já convertidas em encomendas.
UPDATE "inventory_holds" AS h
SET "userId" = o."buyerUserId"
FROM "orders" AS o
WHERE o."holdId" = h."id"
  AND o."buyerUserId" IS NOT NULL;

CREATE INDEX "inventory_holds_userId_status_idx"
ON "inventory_holds"("userId", "status");
