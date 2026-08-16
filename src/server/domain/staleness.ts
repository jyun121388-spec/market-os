/**
 * User-facing stale-data marking (docs/REVIEW_DEBT.md M28 row). `/admin`'s pipeline-health view
 * (M24) is operator-facing only — this is the first user-facing signal that a displayed value
 * might be stale relative to its own series' expected update cadence, reusing the cadence
 * projection `economicCalendar.ts` (M12) already computes rather than inventing a second
 * cadence calculation.
 *
 * Deliberately conservative: a series is only ever marked STALE, never marked "confirmed fresh"
 * with false confidence — a series with too little history to project a cadence is UNKNOWN, not
 * FRESH, since there's no basis to claim freshness either way.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many multiples of a series' own median update interval before it's flagged stale. */
const STALE_MULTIPLIER = 3;

export type StalenessStatus = "FRESH" | "STALE" | "UNKNOWN";

export interface StalenessInput {
  /** YYYY-MM-DD, the series' most recent observation date. */
  lastObservedDate: string;
  /** The series' own historical median interval between observations, in days. */
  medianIntervalDays: number;
}

export interface StalenessResult {
  status: StalenessStatus;
  daysSinceLastObservation: number;
}

export function evaluateStaleness(input: StalenessInput, now: Date = new Date()): StalenessResult {
  const last = new Date(`${input.lastObservedDate}T00:00:00.000Z`);
  const daysSinceLastObservation = Math.round((now.getTime() - last.getTime()) / MS_PER_DAY);
  const status: StalenessStatus =
    daysSinceLastObservation > input.medianIntervalDays * STALE_MULTIPLIER ? "STALE" : "FRESH";
  return { status, daysSinceLastObservation };
}
