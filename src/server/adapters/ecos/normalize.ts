import { assertValidCalendarDate } from "../dateValidation";
import type { EcosCycle, EcosStatisticSearchRow, EcosStatisticSearchSuccess } from "./types";

export interface NormalizedEcosObservation {
  observationDate: Date;
  value: string;
  raw: EcosStatisticSearchRow;
}

export interface NormalizeEcosResult {
  observations: NormalizedEcosObservation[];
  /**
   * Rows whose DATA_VALUE was not a finite number. Never coerced to 0 — see
   * docs/DATA_POLICY.md. ECOS's exact missing-value marker is unverified (see types.ts note),
   * so this is intentionally conservative: anything non-numeric is treated as missing rather
   * than guessed at.
   */
  skippedMissing: EcosStatisticSearchRow[];
}

export function normalizeEcosObservations(
  response: EcosStatisticSearchSuccess,
): NormalizeEcosResult {
  const observations: NormalizedEcosObservation[] = [];
  const skippedMissing: EcosStatisticSearchRow[] = [];

  for (const row of response.StatisticSearch.row) {
    const numeric = Number(row.DATA_VALUE);
    if (row.DATA_VALUE === undefined || row.DATA_VALUE === "" || !Number.isFinite(numeric)) {
      skippedMissing.push(row);
      continue;
    }

    observations.push({
      observationDate: parseEcosTimeAsUtc(row.TIME, inferCycle(row.TIME)),
      value: row.DATA_VALUE,
      raw: row,
    });
  }

  return { observations, skippedMissing };
}

/**
 * ECOS TIME values carry no time-of-day component — they describe a Korean calendar
 * period (year/quarter/month/day), not an instant. Parsed as UTC midnight for the same
 * reason FRED dates are (docs/server/adapters/fred/normalize.ts): consistent comparison
 * regardless of server timezone, not a claim about KST vs UTC equivalence.
 */
export function parseEcosTimeAsUtc(time: string, cycle: EcosCycle): Date {
  switch (cycle) {
    case "A": {
      const year = Number(time);
      assertValidCalendarDate(year, 1, 1, time);
      return new Date(Date.UTC(year, 0, 1));
    }
    case "Q": {
      const [yearPart, quarterPart] = time.split("Q");
      const year = Number(yearPart);
      const quarter = Number(quarterPart);
      // A quarter outside 1-4 wouldn't roll over via Date.UTC the way month/day do (quarter is
      // converted to a month first), so it's checked explicitly rather than relying on
      // assertValidCalendarDate to catch it downstream.
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        throw new Error(`Invalid ECOS quarter in TIME "${time}": quarter must be 1-4`);
      }
      const month = (quarter - 1) * 3 + 1;
      assertValidCalendarDate(year, month, 1, time);
      return new Date(Date.UTC(year, month - 1, 1));
    }
    case "M": {
      const year = Number(time.slice(0, 4));
      const month = Number(time.slice(4, 6));
      assertValidCalendarDate(year, month, 1, time);
      return new Date(Date.UTC(year, month - 1, 1));
    }
    case "D": {
      const year = Number(time.slice(0, 4));
      const month = Number(time.slice(4, 6));
      const day = Number(time.slice(6, 8));
      assertValidCalendarDate(year, month, day, time);
      return new Date(Date.UTC(year, month - 1, day));
    }
  }
}

function inferCycle(time: string): EcosCycle {
  if (time.includes("Q")) return "Q";
  if (time.length === 4) return "A";
  if (time.length === 6) return "M";
  if (time.length === 8) return "D";
  throw new Error(`Unrecognized ECOS TIME format: "${time}"`);
}
