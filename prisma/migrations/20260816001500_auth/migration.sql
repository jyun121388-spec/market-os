-- H1 fix (see docs/DECISIONS.md): the original version of this migration did
--   ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL, ADD COLUMN "passwordHash" TEXT NOT NULL;
-- with no DEFAULT. Postgres rejects ADD COLUMN ... NOT NULL without a DEFAULT on any table that
-- already has rows — this migration could only ever succeed against an EMPTY `users` table,
-- which is not a safe assumption for a real upgrade (M19's Watchlist shipped before Auth and
-- could have real pre-existing User rows, e.g. from WatchlistItem FK references).
--
-- Fixed as a staged migration: add nullable -> backfill legacy rows with a synthetic,
-- unguessable identity (never a fake credential presented as real) -> tighten to NOT NULL/
-- UNIQUE. This succeeds identically whether "users" is empty or has existing rows.

-- Stage 1: add columns nullable (isLegacyAccount can be NOT NULL immediately since it has a
-- real default that's valid for every existing row).
ALTER TABLE "users" ADD COLUMN     "email" TEXT;
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT;
ALTER TABLE "users" ADD COLUMN     "isLegacyAccount" BOOLEAN NOT NULL DEFAULT false;

-- Stage 2: backfill any pre-existing rows (email IS NULL means "existed before this migration").
-- Email is a synthetic, per-row-unique placeholder (`legacy+<id>@market-os.invalid`) — derived
-- from the row's own primary key, which is already guaranteed unique, so no collision risk.
-- passwordHash is a sentinel that is NOT a valid "<N>:<r>:<p>:<saltHex>:<hashHex>" scrypt record
-- and is never evaluated as one: src/server/domain/auth.ts's signIn() checks isLegacyAccount
-- BEFORE ever attempting to verify a password against passwordHash for these rows, so this
-- value is never treated as a real, checkable credential.
UPDATE "users"
SET
  "email" = 'legacy+' || "id" || '@market-os.invalid',
  "passwordHash" = 'LEGACY_ACCOUNT_NO_CREDENTIALS',
  "isLegacyAccount" = true
WHERE "email" IS NULL;

-- Stage 3: tighten to the real constraints now that every row has a non-null value.
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" SET NOT NULL;

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
