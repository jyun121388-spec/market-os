import { getObservationHistory, round } from "./seriesReadings";

/**
 * Historical Analog Engine (docs/PRODUCT_SPEC.md "Historical Analog Engine") — see
 * docs/DECISIONS.md for this milestone's scope: single-series trailing-change similarity,
 * period-based (not calendar-month-based unless the series is actually monthly), tested
 * against seeded data since this dev environment has little real historical history yet.
 *
 * "Past results do not guarantee future outcomes" is enforced structurally: every result
 * carries a required, non-optional `limitations` string and `sampleSize` — never hidden behind
 * a headline similarity score.
 */

export interface AnalogMatch {
  asOfDate: string; // YYYY-MM-DD — the historical point being compared to "now"
  historicalValue: number;
  historicalTrailingChange: number;
  similarityScore: number; // 0..1, 1 = identical trailing change (relative to historical spread)
  subsequentChange1: number | null; // change 1 window ahead of asOfDate, null if out of range
  subsequentChange3: number | null; // change 3 windows ahead
  subsequentChange6: number | null; // change 6 windows ahead
}

export type HistoricalAnalogStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface HistoricalAnalogResult {
  status: HistoricalAnalogStatus;
  seriesId: string;
  windowSize: number;
  currentTrailingChange?: number;
  sampleSize: number; // how many historical points were actually compared
  matches: AnalogMatch[];
  limitations: string;
}

const LIMITATIONS_TEXT =
  "Historical analogs describe what happened after similar past periods for THIS series only; " +
  "they are not a prediction and do not account for structural changes in the economy over " +
  "time, other concurrent variables, or genuinely novel conditions. A small sample size makes " +
  "any pattern here weaker evidence, not stronger.";

interface Point {
  date: Date;
  value: number;
}

/**
 * Is the span between two points provably `n` periods, or might it be more?
 *
 * IR-133. Array position is NOT period identity, and treating it as one is the defect this guards.
 * `getObservationHistory` reports the dates this repository stored but could not answer about; if
 * one of them lies strictly between two points, the array says they are adjacent and the calendar
 * says they are not, and only the array is wrong.
 *
 * Explicit evidence, not inference. Nothing here derives a frequency from local spacing, so a
 * legitimately irregular series — one the provider simply never published for a month — carries no
 * unresolved date, spans nothing, and behaves exactly as it always has. Only a WITHHELD date
 * invalidates a span, because only a withheld date means the array is missing a period it should
 * have had.
 */
function spansWithheldDate(a: Point, b: Point, withheld: readonly Date[]): boolean {
  const from = Math.min(a.date.getTime(), b.date.getTime());
  const to = Math.max(a.date.getTime(), b.date.getTime());
  return withheld.some((d) => d.getTime() > from && d.getTime() < to);
}

/**
 * Trailing changes, with the ones whose period span cannot be proven marked rather than removed.
 *
 * Marked and not dropped, because the CURRENT window is selected by position and silently dropping
 * it would promote an older window to "current" — replacing a wrong number with a differently
 * wrong one. The caller decides what each kind deserves.
 */
function trailingChanges(
  points: Point[],
  windowSize: number,
  withheld: readonly Date[],
): { index: number; change: number; spanProven: boolean }[] {
  const result: { index: number; change: number; spanProven: boolean }[] = [];
  for (let i = windowSize; i < points.length; i++) {
    result.push({
      index: i,
      change: points[i].value - points[i - windowSize].value,
      spanProven: !spansWithheldDate(points[i - windowSize], points[i], withheld),
    });
  }
  return result;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[], avg: number): number {
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

/**
 * Computes historical analogs for one series' current trailing change over `windowSize`
 * observations. Requires enough history to have both a current window and at least a few
 * historical windows with 6-windows-ahead lookahead data available; returns
 * INSUFFICIENT_DATA rather than a result built on too little data.
 */
export async function computeHistoricalAnalog(
  seriesId: string,
  options: { windowSize?: number; topK?: number } = {},
): Promise<HistoricalAnalogResult> {
  const windowSize = options.windowSize ?? 5;
  const topK = options.topK ?? 3;

  // One row per date, resolved through the revision chain — see getObservationsOneRowPerDate.
  // The retrievedAt-desc + distinct query this replaced could pick a superseded value, which
  // here would silently skew every z-score the analog engine computes.
  const { rows: observations, unresolvedDates } = await getObservationHistory(seriesId);

  const points: Point[] = observations.map((o) => ({
    date: o.observationDate,
    value: Number(o.value.toString()),
  }));

  const changes = trailingChanges(points, windowSize, unresolvedDates);
  // Need the current point's trailing change plus enough earlier history (with room for a
  // 6-window lookahead) to have at least one comparable historical point.
  if (changes.length < 2) {
    return {
      status: "INSUFFICIENT_DATA",
      seriesId,
      windowSize,
      sampleSize: 0,
      matches: [],
      limitations: LIMITATIONS_TEXT,
    };
  }

  const current = changes[changes.length - 1];

  // A refusal AFTER the newest answerable point invalidates the current window too, and this is
  // the one the first version of the repair missed — found by adversarial review, not by writing
  // it. `spansWithheldDate` looks strictly BETWEEN two points, so a withheld date newer than every
  // resolved point lies outside every span and invalidates nothing. The engine would then take the
  // last surviving window as "current" and answer about an older period under the current-period
  // contract: exactly the substitution the paragraph below claims to prevent, arriving from the one
  // direction the check could not see.
  const newestPoint = points[points.length - 1];
  const refusedAfterNewest = unresolvedDates.some((d) => d.getTime() > newestPoint.date.getTime());

  // The current window is the one everything is compared AGAINST, so if its own span cannot be
  // proven there is no honest result to give. Falling back to an earlier window would answer a
  // different question under the same name, which is the substitution this whole unit is about.
  if (!current.spanProven || refusedAfterNewest) {
    return {
      status: "INSUFFICIENT_DATA",
      seriesId,
      windowSize,
      sampleSize: 0,
      matches: [],
      limitations: LIMITATIONS_TEXT,
    };
  }

  // Earlier windows that cannot prove their span are dropped rather than compared: a change over
  // more periods than it claims would be scored for similarity against changes over fewer.
  const historical = changes.slice(0, -1).filter((c) => c.spanProven);

  // The sample-size guard is re-applied AFTER the drop, and the first version of this repair did
  // not do that — also found by review. The check above ran on the UNFILTERED list, so a history
  // whose windows were nearly all unprovable could reach the statistics with one survivor or none:
  // with none, an empty distribution; with one, `sd === 0` forces both z-scores to zero and every
  // comparison scores a perfect 1.0 however different the changes are. Refusing a wrong period
  // count only to publish a confidently wrong distribution would be no repair at all.
  if (historical.length < 1) {
    return {
      status: "INSUFFICIENT_DATA",
      seriesId,
      windowSize,
      sampleSize: 0,
      matches: [],
      limitations: LIMITATIONS_TEXT,
    };
  }

  const historicalValues = historical.map((h) => h.change);
  const avg = mean(historicalValues);
  const sd = stdev(historicalValues, avg);

  const zCurrent = sd === 0 ? 0 : (current.change - avg) / sd;

  const scored = historical.map((h) => {
    const zHist = sd === 0 ? 0 : (h.change - avg) / sd;
    const similarityScore = round(1 / (1 + Math.abs(zCurrent - zHist)), 4);
    return { ...h, similarityScore };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  const top = scored.slice(0, topK);

  const matches: AnalogMatch[] = top.map((h) => ({
    asOfDate: points[h.index].date.toISOString().slice(0, 10),
    historicalValue: points[h.index].value,
    historicalTrailingChange: round(h.change, 6),
    similarityScore: h.similarityScore,
    subsequentChange1: subsequentChange(points, h.index, 1, unresolvedDates),
    subsequentChange3: subsequentChange(points, h.index, 3, unresolvedDates),
    subsequentChange6: subsequentChange(points, h.index, 6, unresolvedDates),
  }));

  return {
    status: "COMPUTED",
    seriesId,
    windowSize,
    currentTrailingChange: round(current.change, 6),
    sampleSize: historical.length,
    matches,
    limitations: LIMITATIONS_TEXT,
  };
}

/**
 * The change `windowsAhead` periods after `fromIndex`, or null when that cannot be established.
 *
 * Null already meant "the history does not reach that far", and a span crossing a withheld date is
 * the same kind of answer: the repository cannot say what the value was `n` periods later, because
 * one of those periods is a date it declined to answer about. Reporting the arithmetic anyway is
 * what produced `subsequentChange6 = 7` on a ramp of ones.
 */
function subsequentChange(
  points: Point[],
  fromIndex: number,
  windowsAhead: number,
  withheld: readonly Date[],
): number | null {
  const targetIndex = fromIndex + windowsAhead;
  if (targetIndex >= points.length) return null;
  if (spansWithheldDate(points[fromIndex], points[targetIndex], withheld)) return null;
  return round(points[targetIndex].value - points[fromIndex].value, 6);
}
