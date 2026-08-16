import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { findRevisionChainTail } from "@/server/domain/revisionChain";
import { Prisma } from "@/generated/prisma/client";

export type ObservationIngestStatus = "inserted" | "revised" | "unchanged";

export interface ObservationIngestInput {
  seriesId: string;
  sourceId: string;
  observationDate: Date;
  value: string;
  raw: Prisma.InputJsonValue;
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
// Generous on purpose: each retry is just a re-read + re-attempt (cheap), and under N-way
// concurrent contention for the same revision slot, a single unlucky writer could in principle
// need close to N retries before it observes an uncontested "latest" row to attach to. The
// common case (no concurrent writers) never enters the loop more than once.
const MAX_REVISION_RETRIES = 20;

/**
 * Shared revision-preserving observation upsert used by every source adapter's ingest
 * pipeline (FRED, ECOS, ...). A changed value for an already-stored observation date is
 * never silently overwritten: it is inserted as a new row with isRevision/revisionOf pointing
 * at the prior row (docs/DATA_POLICY.md financial-data checklist: "revised vs
 * preliminary/final"). An unchanged value is a no-op, keeping re-ingestion idempotent.
 *
 * Concurrency (see docs/DECISIONS.md's H3 entry): this used to be a plain read-then-create —
 * `findFirst` to check for an existing row, then `create` based on what it saw. Two concurrent
 * calls for the same (seriesId, observationDate) could both read "nothing exists yet" and both
 * insert as the "original" observation, because the schema's old
 * `@@unique([seriesId, observationDate, isRevision, revisionOf])` constraint does NOT actually
 * block this: every original row has `isRevision = false, revisionOf = NULL`, and Postgres
 * treats NULL as distinct from NULL for uniqueness purposes, so any number of "original" rows
 * for the same series/date could coexist without ever violating that constraint.
 *
 * The fix is two-part:
 *  1. A DB-level partial unique index — `observations_series_date_original_unique` on
 *     `(seriesId, observationDate) WHERE isRevision = false` (see the
 *     `20260816090000_original_observation_unique` migration) — which has no NULL column in its
 *     key, so it genuinely guarantees at most one original row per series/date, enforced by
 *     Postgres itself regardless of application-level races.
 *  2. Step 1 below attempts to become that original via a single atomic
 *     `INSERT ... ON CONFLICT (...) WHERE isRevision = false DO NOTHING RETURNING id` — under
 *     concurrent calls, exactly one succeeds; the rest observe zero rows returned and fall
 *     through to the revision path, never throwing on the original-vs-original race.
 *  3. Step 2's revision path can *itself* race (two losers of step 1, or two concurrent
 *     re-ingests of an already-revised series, both reading the same "latest" row and trying to
 *     attach a child revision to it) — that still hits the original 4-column unique constraint,
 *     which correctly rejects a second identical (seriesId, date, isRevision=true, revisionOf)
 *     tuple. Rather than let that surface as an unhandled Prisma P2002 error, it's caught and
 *     retried: re-read the new "latest" row (now reflecting whichever concurrent writer won)
 *     and decide again (unchanged vs. attach a further revision) — a standard optimistic-
 *     concurrency retry loop, bounded by MAX_REVISION_RETRIES so runaway contention fails loudly
 *     instead of looping forever.
 *
 * Finding "latest" is structural, not chronological — see findRevisionChainTail below for why
 * ordering by `retrievedAt` is not good enough.
 */
export async function upsertRevisionAwareObservation(
  input: ObservationIngestInput,
): Promise<ObservationIngestStatus> {
  const insertedOriginalId = await tryInsertOriginal(input);
  if (insertedOriginalId) {
    return "inserted";
  }

  // An original already exists (created by this call's own prior attempt in a previous run, or
  // by a concurrent writer that won the race above). Fall through to the revision path.
  for (let attempt = 0; attempt < MAX_REVISION_RETRIES; attempt++) {
    const latest = await loadRevisionChainTail(input.seriesId, input.observationDate);

    // tryInsertOriginal just told us an original exists (DO NOTHING fired), so this should
    // never be null — but if it somehow is (e.g. the original was deleted between the two
    // queries), retry from the top rather than assume anything.
    if (!latest) {
      const retried = await tryInsertOriginal(input);
      if (retried) return "inserted";
      continue;
    }

    if (Number(latest.value.toString()) === Number(input.value)) {
      return "unchanged";
    }

    try {
      await prisma.observation.create({
        data: {
          id: randomUUID(),
          seriesId: input.seriesId,
          sourceId: input.sourceId,
          observationDate: input.observationDate,
          value: input.value,
          isRevision: true,
          revisionOf: latest.id,
          raw: input.raw,
        },
      });
      return "revised";
    } catch (err) {
      if (isUniqueConstraintViolation(err) && attempt < MAX_REVISION_RETRIES - 1) {
        // Another writer just attached its own revision to the same `latest` row (or otherwise
        // changed the series/date's revision chain) between our read and our write — re-read
        // and try again against the now-current state.
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `upsertRevisionAwareObservation: exceeded ${MAX_REVISION_RETRIES} retries under contention ` +
      `for seriesId=${input.seriesId} observationDate=${input.observationDate.toISOString()}`,
  );
}

/**
 * Loads the revision chain for one (seriesId, observationDate) and returns its tail.
 *
 * The tail-finding itself lives in `revisionChain.ts`, shared with the READ path: the same
 * mistake — ordering by `retrievedAt` on a `timestamp(3)` column — was made independently in
 * both places, and having one implementation is what stops them drifting apart again. See that
 * module for why the clock cannot answer this question.
 */
async function loadRevisionChainTail(seriesId: string, observationDate: Date) {
  const rows = await prisma.observation.findMany({
    where: { seriesId, observationDate },
    // Only a tiebreaker for a chain that should be impossible — correctness does not depend on it.
    orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
  });
  return findRevisionChainTail(rows);
}

/**
 * Atomically attempts to insert `input` as the ORIGINAL observation (isRevision = false) for
 * its (seriesId, observationDate). Returns the new row's id on success, or null if an original
 * already exists (the INSERT's ON CONFLICT ... DO NOTHING fired, inserting nothing). Race-free
 * against concurrent callers doing the same thing, because the partial unique index this
 * targets has no nullable column in its key — see the module docstring.
 */
async function tryInsertOriginal(input: ObservationIngestInput): Promise<string | null> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "observations"
      ("id", "seriesId", "sourceId", "observationDate", "value", "isRevision", "raw")
    VALUES
      (${id}, ${input.seriesId}, ${input.sourceId}, ${input.observationDate}, ${input.value}::numeric, false, ${JSON.stringify(input.raw)}::jsonb)
    ON CONFLICT ("seriesId", "observationDate") WHERE "isRevision" = false
    DO NOTHING
    RETURNING "id"
  `;
  return rows[0]?.id ?? null;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
