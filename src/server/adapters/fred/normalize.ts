import { assertValidCalendarDate } from "../dateValidation";
import type { FredObservationRaw, FredObservationsResponse } from "./types";
import { isStorableDecimal } from "@/server/domain/observationIngest";

export interface NormalizedFredObservation {
  observationDate: Date;
  value: string; // decimal string, safe to hand to Prisma's Decimal field
  raw: FredObservationRaw;
  /**
   * When this value became the current one, per the provider — or null.
   *
   * Null unless the response was fetched with an explicit realtime range AND the caller said so.
   * See `NormalizeFredOptions` for what was measured about each shape.
   */
  releaseDate: Date | null;
}

export interface NormalizeFredResult {
  observations: NormalizedFredObservation[];
  /** Raw entries FRED marked missing ("."). Never coerced to 0 — see docs/DATA_POLICY.md. */
  skippedMissing: FredObservationRaw[];
}

/**
 * Converts a raw FRED API response into normalized observations ready to persist as
 * `Observation` rows. FRED dates are plain calendar dates (no time-of-day / timezone
 * component in this endpoint), parsed as UTC midnight so they compare consistently
 * regardless of server timezone.
 */
/**
 * Whether `realtime_start` on these rows is a VINTAGE BOUNDARY or merely the query date.
 *
 * It depends entirely on how the response was asked for, which is why it is a parameter and not an
 * inference. HG-002 measured both shapes against the real endpoint on 2026-09-06:
 *
 *   DEFAULT QUERY    every row carries the SAME `realtime_start` — the day the request was made.
 *                    954 CPIAUCSL rows back to 1947 all read 2026-09-06. It identifies the query,
 *                    not the figure, and reading it as a release date would stamp every
 *                    observation in a seventy-year history with today.
 *   REALTIME RANGE   `realtime_start`/`realtime_end` bound the interval in which THAT value was
 *                    the current one. CPIAUCSL 2023-01-01 came back as four vintages,
 *                    300.536 -> 300.356 -> 300.456 -> 300.420, ordered and non-overlapping.
 *
 * So the caller that requested the range is the only one that may say so. Defaulting to `false`
 * keeps the pinned finding intact: `tests/adapters/fred-live-findings.test.ts` exists because
 * mapping the default query's `realtime_start` into a release date is a mistake this project has
 * already measured and refused once.
 */
export interface NormalizeFredOptions {
  /** Set ONLY when the response was fetched with an explicit realtime range. */
  vintageAware?: boolean;
}

export function normalizeFredObservations(
  response: FredObservationsResponse,
  options: NormalizeFredOptions = {},
): NormalizeFredResult {
  const observations: NormalizedFredObservation[] = [];
  const skippedMissing: FredObservationRaw[] = [];

  for (const raw of response.observations) {
    if (raw.value === ".") {
      skippedMissing.push(raw);
      continue;
    }

    // `isStorableDecimal`, not `Number.isFinite(Number(...))`. The latter tests whether JavaScript
    // can read the string as a number, which is not the same question: `Number("0x10")` is 16, and
    // `0b10` and `0o10` read the same way. A hexadecimal value used to pass here, get stored by
    // Prisma as 16, and then make the identity comparator throw on the next ingest of the same
    // series — accepted once, fatal the second time. The adapter is where a value that is not a
    // decimal should stop.
    if (!isStorableDecimal(raw.value)) {
      throw new Error(`Unexpected non-decimal FRED value "${raw.value}" on ${raw.date}`);
    }

    observations.push({
      observationDate: parseFredDateAsUtc(raw.date),
      value: raw.value,
      raw,
      // Null unless the caller requested the range and said so. See `NormalizeFredOptions`.
      releaseDate:
        options.vintageAware && raw.realtime_start ? parseFredDateAsUtc(raw.realtime_start) : null,
    });
  }

  return { observations, skippedMissing };
}

function parseFredDateAsUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  assertValidCalendarDate(year, month, day, date);
  return new Date(Date.UTC(year, month - 1, day));
}
