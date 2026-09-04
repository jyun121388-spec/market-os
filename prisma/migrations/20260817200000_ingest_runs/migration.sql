-- Records one real ingestion run so completeness is auditable after the fact.
--
-- Every adapter now returns a `truncated` flag and the provider's own claimed total, because
-- each of them was at some point silently storing a partial result (docs/DECISIONS.md,
-- 2026-08-17: EDGAR's 1000-filing cap, FRED's ignored `count`, ECOS's fixed window, DART's
-- ignored `total_page`). A flag that nothing persists is barely better than no flag — the
-- question an operator asks is "is the data I am looking at complete?", and answering it needs
-- what the last run fetched versus what the provider said existed.
--
-- Purely additive: a new enum, a new table, one index, one FK. No existing table is altered and
-- no existing row is touched, so this is safe to apply to a populated database.

-- CreateEnum
CREATE TYPE "IngestRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "ingest_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "IngestRunStatus" NOT NULL,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "revised" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "providerTotal" INTEGER,
    "fetched" INTEGER,
    "requestsMade" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "ingest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingest_runs_sourceId_startedAt_idx" ON "ingest_runs"("sourceId", "startedAt");

-- AddForeignKey
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
