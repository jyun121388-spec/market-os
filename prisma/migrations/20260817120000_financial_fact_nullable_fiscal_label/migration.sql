-- Live verification against data.sec.gov (2026-08-17) found that SEC's companyfacts API
-- returns rows with `fy: null, fp: null` — typically facts republished for a `frame` under a
-- later restating filing. The adapter's types (written from SEC's documentation, never from a
-- real response) declared both non-nullable, and these columns were NOT NULL to match, so a
-- real ingestion run would have failed on the first such row.
--
-- Widening rather than dropping those rows: the fact itself is fully sourced (value, period,
-- form, accession number all real) and only the fiscal label is missing. Synthesizing a fiscal
-- year from periodEnd would store an inference as reported data, which docs/DATA_POLICY.md
-- forbids.
--
-- Safe on existing data: relaxing NOT NULL cannot invalidate any row already stored.
ALTER TABLE "financial_facts" ALTER COLUMN "fiscalYear" DROP NOT NULL;
ALTER TABLE "financial_facts" ALTER COLUMN "fiscalPeriod" DROP NOT NULL;
