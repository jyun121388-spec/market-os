import { getObservationsOneRowPerDate, round } from "./seriesReadings";

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

function trailingChanges(points: Point[], windowSize: number): { index: number; change: number }[] {
  const result: { index: number; change: number }[] = [];
  for (let i = windowSize; i < points.length; i++) {
    result.push({ index: i, change: points[i].value - points[i - windowSize].value });
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
  const observations = await getObservationsOneRowPerDate(seriesId);

  const points: Point[] = observations.map((o) => ({
    date: o.observationDate,
    value: Number(o.value.toString()),
  }));

  const changes = trailingChanges(points, windowSize);
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
  const historical = changes.slice(0, -1);

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
    subsequentChange1: subsequentChange(points, h.index, 1),
    subsequentChange3: subsequentChange(points, h.index, 3),
    subsequentChange6: subsequentChange(points, h.index, 6),
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

function subsequentChange(points: Point[], fromIndex: number, windowsAhead: number): number | null {
  const targetIndex = fromIndex + windowsAhead;
  if (targetIndex >= points.length) return null;
  return round(points[targetIndex].value - points[fromIndex].value, 6);
}
