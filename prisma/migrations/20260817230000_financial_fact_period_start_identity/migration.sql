-- A financial fact's identity includes the period START, not just the period end.
--
-- The old constraint was
--   UNIQUE (sourceId, corpCode, concept, unit, periodEnd, accessionNumber)
-- which assumed one filing reports a given concept at most once per period end. SEC does not
-- work that way: a single filing reports both a year-to-date figure and a quarterly figure with
-- the SAME period end and the SAME accession number, distinguished only by `start`.
--
-- Verified against live data. Apple's NetIncomeLoss under accession 0001193125-09-153165,
-- period end 2008-06-28:
--     start=2007-09-30  ->  $3,698,000,000   (nine months)
--     start=2008-03-30  ->  $1,072,000,000   (one quarter)
-- A 3.4x difference between two rows the constraint considered identical. The ingest kept
-- whichever arrived first and counted the other as "unchanged" — a single real ingest of one
-- company silently discarded 168 facts this way, and which figure survived depended on array
-- order in SEC's response.
--
-- Two partial indexes rather than one nullable column in the key: `periodStart` is NULL for
-- instant concepts (Assets, Liabilities, Cash), and Postgres treats NULL as distinct from NULL
-- in a unique index — so including it directly would silently stop enforcing uniqueness for
-- exactly those rows. That is the same trap as the H3 observation constraint
-- (docs/DECISIONS.md), avoided the same way.
--
-- Safe on existing data: this REPLACES a stricter constraint with a looser pair, so no currently
-- stored row can violate it. Rows previously dropped are not recovered here — re-running the
-- ingest picks them up, since the ingest is idempotent.

-- Drop the old constraint by SHAPE rather than by name. Prisma truncates generated index names
-- to 63 characters, and guessing that truncation wrong turns `DROP INDEX IF EXISTS` into a
-- silent no-op — the migration then "succeeds" while leaving the broken constraint in place,
-- which is exactly what happened on the first attempt at this migration.
DO $$
DECLARE
  idx text;
BEGIN
  FOR idx IN
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'financial_facts'
      AND x.indisunique
      AND x.indpred IS NULL -- not one of the new partial indexes
      AND NOT x.indisprimary
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx);
  END LOOP;
END $$;

-- Duration concepts: period start participates in identity.
CREATE UNIQUE INDEX "financial_facts_duration_identity_unique"
  ON "financial_facts" ("sourceId", "corpCode", "concept", "unit", "periodStart", "periodEnd", "accessionNumber")
  WHERE "periodStart" IS NOT NULL;

-- Instant concepts: there is no start, so the original key is already complete. Expressed as a
-- partial index so no NULL ever appears in a unique key.
CREATE UNIQUE INDEX "financial_facts_instant_identity_unique"
  ON "financial_facts" ("sourceId", "corpCode", "concept", "unit", "periodEnd", "accessionNumber")
  WHERE "periodStart" IS NULL;

-- Supports the ingest's existence lookup, which can no longer use a single unique constraint.
CREATE INDEX IF NOT EXISTS "financial_facts_lookup_idx"
  ON "financial_facts" ("sourceId", "corpCode", "concept", "unit", "periodEnd", "accessionNumber");
