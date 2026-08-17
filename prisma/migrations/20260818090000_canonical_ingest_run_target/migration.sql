-- Canonicalises SEC EDGAR ingest-run targets to the padded 10-digit CIK.
--
-- `IngestRun.target` recorded the unpadded tracked constant ("320193", "xbrl:320193") while the
-- data those runs describe is stored under the padded canonical form ("0000320193"). Nothing
-- joined the two yet, so nothing was visibly broken — but this is the same
-- identity-representation mismatch that previously left 2240 filings and 933 financial facts
-- with zero joinable rows, and it would have silently defeated the first consumer to ask "was
-- this company's stored data complete?".
--
-- Scoped to the SEC_EDGAR source: OpenDART corp codes are 8-digit identifiers in their own
-- namespace and padding them to 10 would corrupt them. Only all-digit targets shorter than 10
-- are touched, so re-running is a no-op and anything already canonical or in an unexpected
-- shape is left alone.

-- Plain filing runs: "320193" -> "0000320193"
UPDATE "ingest_runs" AS r
SET "target" = lpad(r."target", 10, '0')
FROM "sources" AS s
WHERE s."id" = r."sourceId"
  AND s."code" = 'SEC_EDGAR'
  AND r."target" ~ '^[0-9]+$'
  AND length(r."target") < 10;

-- XBRL runs: "xbrl:320193" -> "xbrl:0000320193"
UPDATE "ingest_runs" AS r
SET "target" = 'xbrl:' || lpad(substring(r."target" from 6), 10, '0')
FROM "sources" AS s
WHERE s."id" = r."sourceId"
  AND s."code" = 'SEC_EDGAR'
  AND r."target" ~ '^xbrl:[0-9]+$'
  AND length(substring(r."target" from 6)) < 10;
