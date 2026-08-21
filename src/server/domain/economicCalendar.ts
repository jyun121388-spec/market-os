import { prisma } from "@/server/db/client";
import { getObservationsOneRowPerDate } from "./seriesReadings";

/**
 * Economic Calendar (docs/PRODUCT_SPEC.md "Economic Calendar") — V1 scope note (see
 * docs/DECISIONS.md): the full spec calls for previous/consensus/actual/surprise/revision and
 * initial market reaction. No free, reachable source of forward-looking consensus estimates
 * was available to verify in this dev environment (api.stlouisfed.org, ecos.bok.or.kr,
 * opendart.fss.or.kr, and data.sec.gov are all egress-blocked here — see docs/DECISIONS.md).
 * Guessing at specific FRED release_id -> series mappings without being able to verify them
 * live would risk exactly the kind of unverifiable-but-confident-looking data the project's
 * guardrails exist to prevent, so this module does NOT do that.
 *
 * What this DOES do, using only data already ingested by existing adapters: for each tracked
 * series, deterministically project the next expected observation date from the historical
 * cadence of its own past observations (median interval between consecutive observation
 * dates). This is real, verifiable, and honestly scoped — not a "consensus" estimate, just a
 * cadence projection. `consensus`/`surprise`/`actual-vs-expected` remain future work, logged in
 * docs/REVIEW_DEBT.md.
 */

export type CalendarEntryStatus = "PROJECTED" | "INSUFFICIENT_DATA";

export interface CalendarEntry {
  seriesId: string;
  sourceCode: string;
  externalId: string;
  seriesName: string;
  status: CalendarEntryStatus;
  lastObservedDate?: string; // YYYY-MM-DD
  lastObservedValue?: number;
  medianIntervalDays?: number;
  expectedNextDate?: string; // YYYY-MM-DD, a cadence projection — not a confirmed release date
  daysUntilExpectedNext?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Projects the next expected observation date for one series from its historical cadence.
 * Requires at least 2 distinct observation dates (1 interval); more dates give a more
 * reliable median. Returns INSUFFICIENT_DATA rather than guessing with fewer than that.
 */
export async function computeCalendarEntry(seriesId: string): Promise<CalendarEntry> {
  const series = await prisma.series.findUniqueOrThrow({
    where: { id: seriesId },
    include: { source: true },
  });

  // One row per date, resolved through the revision chain — see getObservationsOneRowPerDate.
  // Cadence only needs the dates, but `lastObservedValue` below is a displayed number, and the
  // retrievedAt-desc + distinct query this replaced could return a superseded one.
  const observations = await getObservationsOneRowPerDate(seriesId);

  const base = {
    seriesId: series.id,
    sourceCode: series.source.code,
    externalId: series.externalId,
    seriesName: series.name,
  };

  if (observations.length < 2) {
    return { ...base, status: "INSUFFICIENT_DATA" };
  }

  const dates = observations.map((o) => o.observationDate.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i] - dates[i - 1]) / MS_PER_DAY);
  }

  const medianIntervalDays = Math.round(median(intervals));
  const last = observations[observations.length - 1];
  const expectedNext = new Date(last.observationDate.getTime() + medianIntervalDays * MS_PER_DAY);
  const daysUntilExpectedNext = Math.round((expectedNext.getTime() - Date.now()) / MS_PER_DAY);

  return {
    ...base,
    status: "PROJECTED",
    lastObservedDate: last.observationDate.toISOString().slice(0, 10),
    lastObservedValue: Number(last.value.toString()),
    medianIntervalDays,
    expectedNextDate: expectedNext.toISOString().slice(0, 10),
    daysUntilExpectedNext,
  };
}

/** Computes a calendar entry for every currently tracked series. */
export async function computeCalendar(): Promise<CalendarEntry[]> {
  const series = await prisma.series.findMany({ select: { id: true } });
  return Promise.all(series.map((s) => computeCalendarEntry(s.id)));
}
