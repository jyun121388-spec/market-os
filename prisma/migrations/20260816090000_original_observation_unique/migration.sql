-- H3 fix (see docs/DECISIONS.md): the existing `@@unique([seriesId, observationDate, isRevision,
-- revisionOf])` constraint does NOT prevent multiple "original" observations (isRevision=false,
-- revisionOf=NULL) for the same series/date, because Postgres treats NULL as distinct from NULL
-- for uniqueness purposes. A partial unique index with no nullable column in its key is required
-- to actually enforce "at most one original observation per series/date" at the database level,
-- independent of any application-level read-then-write logic.
--
-- Not expressible in prisma/schema.prisma (no WHERE-clause support for @@unique) — hand-written
-- per this project's established non-interactive-migration workaround.

CREATE UNIQUE INDEX "observations_series_date_original_unique"
  ON "observations" ("seriesId", "observationDate")
  WHERE "isRevision" = false;
