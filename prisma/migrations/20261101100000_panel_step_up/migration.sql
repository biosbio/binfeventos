-- Step-up authentication for organizer and platform-admin panels
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');
CREATE TYPE "VerificationChannel" AS ENUM ('EMAIL', 'SMS');

ALTER TABLE "users"
  ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

ALTER TABLE "sessions"
  ADD COLUMN "panelVerifiedUntil" TIMESTAMP(3);

CREATE TABLE "panel_verification_codes" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "channel" "VerificationChannel" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "panel_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "panel_verification_codes_userId_expiresAt_idx"
  ON "panel_verification_codes"("userId", "expiresAt");

ALTER TABLE "panel_verification_codes"
  ADD CONSTRAINT "panel_verification_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
