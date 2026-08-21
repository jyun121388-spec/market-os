-- Records whether an ingest run re-fetched a target's entire history or only appended to it.
--
-- Without this, `assessCompleteness` could not tell whether a later successful run had actually
-- repaired an earlier truncated one. It reduced to "the most recent run per target" and reported
-- COMPLETE whenever that run neither failed nor truncated — so a 2026-only incremental rerun
-- following a truncated all-history run made a company with missing filings read as complete.
--
-- Additive and nullable-by-default: existing rows become UNKNOWN rather than being backfilled to
-- FULL. Claiming certainty about runs nobody observed would replace one false statement with
-- another, and UNKNOWN is the answer that is actually true for them.

CREATE TYPE "IngestRunMode" AS ENUM ('FULL', 'INCREMENTAL', 'UNKNOWN');

ALTER TABLE "ingest_runs"
  ADD COLUMN "mode" "IngestRunMode" NOT NULL DEFAULT 'UNKNOWN';
