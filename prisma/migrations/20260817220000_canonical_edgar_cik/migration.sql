-- Canonicalises SEC EDGAR CIKs in `financial_facts` to the zero-padded 10-digit form.
--
-- The two EDGAR adapters disagreed about how to identify a company. The filings adapter stores
-- the `cik` SEC returns, which is padded ("0000320193"); the XBRL adapter stored whatever the
-- caller passed, which is the unpadded "320193" from TRACKED_XBRL_COMPANIES. So the same company
-- existed under two identifiers, and nothing could join its filings to its financial facts.
--
-- That was not theoretical: `askMarket.ts`'s `findCompanyFacts` looks facts up by a Filing's
-- corpCode, so the "Company facts" section of Ask Market silently returned nothing for every
-- EDGAR company. Measured against real ingested data before the fix: 2240 filings, 933 facts,
-- 0 joinable rows.
--
-- Scoped deliberately:
--   * Only rows belonging to the SEC_EDGAR source. OpenDART corp codes are 8-digit identifiers
--     in their own namespace ("00126380"); padding those to 10 would corrupt them.
--   * Only rows that are all digits and shorter than 10, so re-running is a no-op and any row
--     already canonical, or in an unexpected format, is left untouched rather than mangled.
--
-- Non-destructive: rewrites an identifier into its canonical form, creates and deletes nothing.
UPDATE "financial_facts" AS f
SET "corpCode" = lpad(f."corpCode", 10, '0')
FROM "sources" AS s
WHERE s."id" = f."sourceId"
  AND s."code" = 'SEC_EDGAR'
  AND f."corpCode" ~ '^[0-9]+$'
  AND length(f."corpCode") < 10;

-- Same for filings. That adapter passed SEC's `cik` straight through, which is padded in real
-- responses — so production rows are already canonical and this is a no-op there. It is not a
-- no-op for any database populated from the test fixture, whose `cik` is unpadded, and leaving
-- the two adapters' outputs dependent on where the data came from is the actual defect being
-- closed. Both adapters now pad explicitly.
UPDATE "filings" AS f
SET "corpCode" = lpad(f."corpCode", 10, '0')
FROM "sources" AS s
WHERE s."id" = f."sourceId"
  AND s."code" = 'SEC_EDGAR'
  AND f."corpCode" ~ '^[0-9]+$'
  AND length(f."corpCode") < 10;
