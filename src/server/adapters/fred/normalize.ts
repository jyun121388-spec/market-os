import { assertValidCalendarDate } from "../dateValidation";
import type { FredObservationRaw, FredObservationsResponse } from "./types";
import { isStorableDecimal } from "@/server/domain/observationIngest";

export interface NormalizedFredObservation {
  observationDate: Date;
  value: string; // decimal string, safe to hand to Prisma's Decimal field
  raw: FredObservationRaw;
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
export function normalizeFredObservations(response: FredObservationsResponse): NormalizeFredResult {
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
    });
  }

  return { observations, skippedMissing };
}

function parseFredDateAsUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  assertValidCalendarDate(year, month, day, date);
  return new Date(Date.UTC(year, month - 1, day));
}
