import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { findRevisionChainTail } from "@/server/domain/revisionChain";
import { Prisma } from "@/generated/prisma/client";

export type ObservationIngestStatus =
  | "inserted"
  | "revised"
  | "unchanged"
  /**
   * The incoming value replays a figure this chain already superseded, so it was NOT applied.
   * See the rollback guard in `upsertRevisionAwareObservation`.
   */
  | "stale_ignored";

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
 * How many decimal places the column actually keeps: `value Decimal @db.Decimal(20, 6)`.
 *
 * Comparison has to happen at the column's precision, not at the provider's. A provider that
 * sends `1.2345678` for a row already storing `1.234568` has sent the same figure as far as this
 * database is concerned, and comparing the unrounded strings would manufacture a revision that
 * records no change.
 */
const STORED_DECIMAL_PLACES = 6;

/**
 * Every decimal spelling the ingest path can actually deliver.
 *
 * Both adapters validate with `Number.isFinite(Number(raw))` and then store the ORIGINAL string,
 * so anything JavaScript parses as a finite number arrives here verbatim: `1e5`, `+1`, `.5`,
 * `1E+5`. That is not hypothetical — it is what `normalizeFredObservations` and
 * `normalizeEcosObservations` do today.
 */
const DECIMAL_SYNTAX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Whether a provider string is a decimal this column can hold.
 *
 * Exported so the adapters can validate with the SAME rule the comparison uses. They validated
 * with `Number.isFinite(Number(raw))`, which is a test for "JavaScript can read this as a number",
 * not for "this is a decimal" — `Number("0x10")` is 16, and `0b10` and `0o10` read the same way.
 * A hexadecimal value therefore passed the adapter, was stored by Prisma as 16, and then made the
 * comparator throw on the NEXT ingest of the same series: accepted once, fatal the second time.
 *
 * Validating at the boundary is the right place for it. By the time two values are being compared
 * for identity, an unreadable one is already too late to do anything useful about.
 */
export function isStorableDecimal(raw: string): boolean {
  return DECIMAL_SYNTAX.test(raw.trim());
}

/**
 * A decimal string as the integer number of millionths it represents, or null if it is not a
 * decimal at all.
 *
 * Exact throughout: the digits are carried as `bigint`, never as a double, because the whole point
 * of this helper is that a double cannot hold what the column holds. Rounding is half away from
 * zero, which is what Postgres `numeric` does when it stores a value with more decimals than the
 * column keeps.
 */
function millionths(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!DECIMAL_SYNTAX.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [mantissa, exponentPart] = unsigned.split(/e/i);
  const exponent = exponentPart === undefined ? 0 : Number(exponentPart);
  const [whole, fraction = ""] = mantissa.split(".");

  // The mantissa as one integer, plus the power of ten it has to be multiplied by. `12.34e2` is
  // 1234 with a shift of 0; `.5` is 5 with a shift of -1.
  const digits = BigInt(`${whole}${fraction}` || "0");
  const shift = exponent - fraction.length + STORED_DECIMAL_PLACES;

  // `BigInt(n)` rather than the `10n` literal form: `tsconfig.json` targets ES2017, where the
  // literal syntax is a compile error. Vitest transpiles past it and both `tsc --noEmit` and
  // `next build` do not, so the first version of this typechecked fine in the test run and failed
  // the build — a reminder that a green test run is evidence about the test runner.
  const TEN = BigInt(10);
  const ONE = BigInt(1);
  const TWO = BigInt(2);

  if (shift >= 0) {
    const scaled = digits * TEN ** BigInt(shift);
    return negative ? -scaled : scaled;
  }

  const divisor = TEN ** BigInt(-shift);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  // Half away from zero, matching how the column rounds on the way in — verified against a real
  // `numeric(20, 6)` cast in tests/integration/decimal-column-semantics.test.ts, not assumed.
  const rounded = remainder * TWO >= divisor ? quotient + ONE : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Whether two stored decimal values are the same figure.
 *
 * Compared as exact integers at the column's precision, not as `Number`. The column holds six
 * decimal places and JavaScript doubles carry roughly fifteen to seventeen significant digits, so
 * a large value with six decimals exceeds what a double can distinguish —
 * `10000000000000.000001` and `...000002` compare equal. A genuine revision would then be recorded
 * as "unchanged" and silently dropped, which is the one outcome this whole ingest path exists to
 * prevent. No current series is near that magnitude, so it is a latent defect rather than an
 * observed one; it is fixed anyway because the failure is invisible.
 *
 * The first version of this compared normalised decimal STRINGS, which fixed the double problem
 * and introduced a smaller one in the other direction. It assumed the values arrive as plain
 * decimal text, and they do not: both adapters accept anything `Number.isFinite` accepts and pass
 * the original string through, so `1e5` reaches here as `1e5` and compared unequal to `100000`.
 * The consequence was worse than a cosmetic mismatch — the rollback guard uses this function to
 * recognise a superseded value, so a provider replaying `1e5` over a chain that had already moved
 * on would have been applied as a revision back to the old figure.
 *
 * Unparseable input THROWS rather than falling back to a string comparison.
 *
 * The fallback was the first instinct and it was wrong. Deciding "same figure" is the decision this
 * whole path turns on, and a comparison that cannot read one of its operands has not made that
 * decision — it has guessed, quietly, in a function whose failures are invisible by construction.
 * Neither operand can legitimately be unreadable: the stored side comes from Prisma's `Decimal`,
 * and the incoming side has already passed the adapters' finite-number check. So an unreadable
 * value means something upstream is broken, and the ingest run should say so where an operator can
 * see it rather than record a revision decision it could not actually make.
 */
export function sameDecimalValue(a: string, b: string): boolean {
  const left = millionths(a);
  const right = millionths(b);
  if (left === null || right === null) {
    const bad = left === null ? a : b;
    throw new Error(
      `[observationIngest] cannot compare observation values: ${JSON.stringify(bad)} is not a ` +
        `decimal this column can hold. Both sides must be readable before "unchanged" or ` +
        `"revised" means anything.`,
    );
  }
  return left === right;
}

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
    const { rows: chain, tail: latest } = await loadRevisionChain(
      input.seriesId,
      input.observationDate,
    );

    // tryInsertOriginal just told us an original exists (DO NOTHING fired), so this should
    // never be null — but if it somehow is (e.g. the original was deleted between the two
    // queries), retry from the top rather than assume anything.
    if (!latest) {
      const retried = await tryInsertOriginal(input);
      if (retried) return "inserted";
      continue;
    }

    if (sameDecimalValue(latest.value.toString(), input.value)) {
      return "unchanged";
    }

    // ROLLBACK GUARD.
    //
    // The comparison above asks only "does this differ from the tail?", which quietly assumes
    // that whatever arrived last is the truth. It is not: a provider CDN serving a stale cached
    // response, a lagging read replica, or a retried job from an earlier queue all deliver an OLD
    // value at a NEW time. Reproduced end to end — original 100, a legitimate revision to 110,
    // then a replay of 100 — and the replay became the chain tail, so the read path served users
    // a figure the provider had already superseded (`gpt-5.6-sol` proposed it; the reproduction
    // is tests/integration/revision-rollback.test.ts).
    //
    // A value that already appears EARLIER in this chain is the signature of exactly that replay.
    // It is not applied, and it is logged rather than swallowed.
    //
    // KNOWN LIMITATION, deliberate: a provider genuinely re-correcting back to a previously
    // reported figure looks identical, and is also ignored. Distinguishing the two needs the
    // provider's own vintage — FRED publishes `realtime_start` for precisely this, and
    // `Observation.releaseDate` exists to hold it — but no adapter populates it yet and no key
    // is available to verify the real semantics, so ordering on it now would be inventing
    // behaviour rather than implementing it. Refusing to regress a published figure is the safer
    // of the two available errors: this one is visible in the log, the other is silent.
    const supersededValues = chain
      .filter((row) => row.id !== latest.id)
      .map((row) => row.value.toString());
    if (supersededValues.some((superseded) => sameDecimalValue(superseded, input.value))) {
      console.warn(
        `[observationIngest] series ${input.seriesId} on ` +
          `${input.observationDate.toISOString().slice(0, 10)}: incoming value ${input.value} ` +
          `replays a figure this chain already superseded (current is ${latest.value.toString()}). ` +
          "Not applied — see the rollback guard in observationIngest.ts.",
      );
      return "stale_ignored";
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
async function loadRevisionChain(seriesId: string, observationDate: Date) {
  const rows = await prisma.observation.findMany({
    where: { seriesId, observationDate },
    // Only a tiebreaker for a chain that should be impossible — correctness does not depend on it.
    orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
  });
  return { rows, tail: findRevisionChainTail(rows) };
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
