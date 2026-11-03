CREATE TABLE "box_office_seller_invites" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "box_office_seller_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "box_office_seller_invites_tokenHash_key" ON "box_office_seller_invites"("tokenHash");
CREATE INDEX "box_office_seller_invites_organizationId_expiresAt_idx" ON "box_office_seller_invites"("organizationId", "expiresAt");

ALTER TABLE "box_office_seller_invites" ADD CONSTRAINT "box_office_seller_invites_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "box_office_seller_invites" ADD CONSTRAINT "box_office_seller_invites_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "domain", "description")
SELECT gen_random_uuid(), 'org:invite', 'users', 'Gerir convites de vendedores'
WHERE NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'org:invite'
);

UPDATE "permissions"
SET "description" = 'Gerir convites de vendedores'
WHERE "code" = 'org:invite';

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."name" = 'ORGANIZER'
  AND role."isSystem" = true
  AND role."organizationId" IS NULL
  AND permission."code" = 'org:invite'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" existing
    WHERE existing."roleId" = role."id"
      AND existing."permissionId" = permission."id"
  );
