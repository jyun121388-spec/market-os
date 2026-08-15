import type { FredObservationRaw, FredObservationsResponse } from "./types";

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

    const numeric = Number(raw.value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Unexpected non-numeric FRED value "${raw.value}" on ${raw.date}`);
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
  return new Date(Date.UTC(year, month - 1, day));
}
