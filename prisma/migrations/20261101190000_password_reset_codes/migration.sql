-- One-time, short-lived password recovery codes (separate from panel step-up codes).
CREATE TABLE "password_reset_codes" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "channel" "VerificationChannel" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_reset_codes_userId_expiresAt_idx"
  ON "password_reset_codes"("userId", "expiresAt");

ALTER TABLE "password_reset_codes"
  ADD CONSTRAINT "password_reset_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
