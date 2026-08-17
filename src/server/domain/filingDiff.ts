import { prisma } from "@/server/db/client";
import { round } from "./seriesReadings";

/**
 * Filing Diff (docs/PRODUCT_SPEC.md "Filing Diff") — numeric-delta half only. See
 * docs/DECISIONS.md for scope: text-diff (new/removed risk factors, management-language
 * changes) requires filing document text, which no adapter fetches yet, and is explicitly
 * BLOCKED/future work — not attempted here.
 *
 * Compares one (corpCode, concept, unit) across two filings. The hard part is not the
 * subtraction; it is choosing two figures that are actually comparable.
 *
 * This used to take "the two most recent rows ordered by periodEnd, then filedDate". Against
 * real SEC data that is wrong, and wrong in the worst available way — it produced a confident,
 * plausible, completely fabricated number. A single Apple 10-Q reports revenue twice: once for
 * the nine months ending 2026-06-27 ($364.357B) and once for the three months ending on the
 * same date ($109.417B). Same period end, same accession number. The old query picked exactly
 * those two rows and reported **+232.9985%** revenue growth. OperatingIncomeLoss came out at
 * +242.99%. Both were pure artefacts of comparing a nine-month figure against a quarterly one.
 *
 * A period-over-period comparison requires like with like: the same period LENGTH, a different
 * period. That is what this now enforces, and a concept with no comparable pair reports
 * INSUFFICIENT_DATA rather than inventing one out of whatever two rows happen to sort first.
 */

export type FilingDiffStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface FilingDiffResult {
  status: FilingDiffStatus;
  corpCode: string;
  concept: string;
  unit: string;
  currentAccession?: string;
  previousAccession?: string;
  currentValue?: number;
  previousValue?: number;
  absoluteChange?: number;
  percentChange?: number | null;
  /** The provider these figures came from — same obligation as every other displayed FACT. */
  sourceCode?: string;
  /** YYYY-MM-DD. Included so a reader can confirm the two figures are comparable. */
  currentPeriodEnd?: string;
  previousPeriodEnd?: string;
  /**
   * Length of both periods in whole months, or null for instant concepts (a balance at a date,
   * such as Assets, which has no span). Equal by construction when status is COMPUTED.
   */
  periodMonths?: number | null;
  /**
   * The ACTUAL span of each period in days, and whether they differ by enough to matter.
   *
   * Whole months are the right bucket for deciding what is comparable — fiscal quarters are not a
   * fixed number of days — but equal buckets are not equal durations, and the gap is not academic.
   * Apple's fiscal Q1 is periodically 14 weeks rather than 13: the real data in this repository
   * holds 492 quarters of 90 days alongside 28 of 97, and 147 years of 363 days alongside 33 of
   * 370. `Math.round(days / 30.436875)` sends 90 and 97 both to 3.
   *
   * So the 90-day quarter ending 2022-06-25 gets compared against the 97-day quarter ending
   * 2022-12-31 and reports +54.2948% on NetIncomeLoss, of which roughly 7.8% is nothing but the
   * extra week. Refusing the comparison would be wrong — companies report those quarters as
   * consecutive — but presenting it as like-for-like without saying so is the same fabrication the
   * nine-month-versus-quarter defect produced, only quieter.
   */
  currentPeriodDays?: number | null;
  previousPeriodDays?: number | null;
  periodLengthMismatch?: boolean;
}

/**
 * Day difference beyond which two same-bucket periods are treated as materially unequal.
 *
 * Four days: a 13-week quarter drifts by a day or two against the calendar, which is noise, while
 * a 14-week quarter is seven days longer, which is a week of trading. Setting this at 4 separates
 * those two without needing to know a company's fiscal convention.
 */
const PERIOD_DAY_TOLERANCE = 4;

/** Mean days per month. Used only to bucket a period into whole months, never to date-shift. */
const DAYS_PER_MONTH = 30.436875;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A period's length in whole months, or null for an instant.
 *
 * Bucketing rather than comparing raw day counts is deliberate: fiscal quarters are not a fixed
 * number of days (Apple's run 89-98), so exact-length matching would refuse to compare two
 * genuine quarters. Rounding to months makes a quarter 3, a half 6, three quarters 9 and a year
 * 12, which is the distinction that actually matters here.
 */
function periodLengthMonths(periodStart: Date | null, periodEnd: Date): number | null {
  if (!periodStart) return null;
  const days = (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY;
  return Math.round(days / DAYS_PER_MONTH);
}

export async function computeFinancialFactDiff(
  sourceId: string,
  corpCode: string,
  concept: string,
  unit: string,
): Promise<FilingDiffResult> {
  const base = { corpCode, concept, unit };

  const [rows, source] = await Promise.all([
    prisma.financialFact.findMany({
      where: { sourceId, corpCode, concept, unit },
      orderBy: [{ periodEnd: "desc" }, { filedDate: "desc" }],
    }),
    prisma.source.findUnique({ where: { id: sourceId }, select: { code: true } }),
  ]);

  if (rows.length < 2) {
    return { ...base, status: "INSUFFICIENT_DATA" };
  }

  // Which figure is "current" must not depend on row order. A filing reports several period
  // lengths ending on the same date with the same filed date, so `periodEnd desc, filedDate
  // desc` leaves them tied and the database free to return either — the same ambiguous-ordering
  // trap as the observation revision chain. Break the tie explicitly on the SHORTEST period:
  // the quarterly figure is the natural subject of a period-over-period comparison, and a
  // reader asking "what changed" means the latest quarter, not the year to date.
  const facts = [...rows].sort((a, b) => {
    const byEnd = b.periodEnd.getTime() - a.periodEnd.getTime();
    if (byEnd !== 0) return byEnd;
    const aMonths = periodLengthMonths(a.periodStart, a.periodEnd) ?? 0;
    const bMonths = periodLengthMonths(b.periodStart, b.periodEnd) ?? 0;
    if (aMonths !== bMonths) return aMonths - bMonths;
    const byFiled = b.filedDate.getTime() - a.filedDate.getTime();
    if (byFiled !== 0) return byFiled;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const current = facts[0];
  const currentMonths = periodLengthMonths(current.periodStart, current.periodEnd);

  const previous = facts.find(
    (f) =>
      // Strictly earlier period end. This is the check the old code lacked, and it alone rules
      // out comparing a year-to-date figure against a quarter from the same filing.
      f.periodEnd.getTime() < current.periodEnd.getTime() &&
      periodLengthMonths(f.periodStart, f.periodEnd) === currentMonths,
  );

  if (!previous) {
    // A real outcome, not a failure: a concept can have exactly one figure of a given period
    // length. Saying so is the whole point — the alternative is the fabricated number above.
    return { ...base, status: "INSUFFICIENT_DATA" };
  }

  const currentValue = Number(current.value.toString());
  const previousValue = Number(previous.value.toString());
  const absoluteChange = round(currentValue - previousValue, 4);
  const percentChange =
    previousValue === 0 ? null : round((absoluteChange / previousValue) * 100, 4);

  const currentPeriodDays = periodLengthDays(current.periodStart, current.periodEnd);
  const previousPeriodDays = periodLengthDays(previous.periodStart, previous.periodEnd);
  const periodLengthMismatch =
    currentPeriodDays !== null &&
    previousPeriodDays !== null &&
    Math.abs(currentPeriodDays - previousPeriodDays) > PERIOD_DAY_TOLERANCE;

  return {
    ...base,
    status: "COMPUTED",
    sourceCode: source?.code,
    currentAccession: current.accessionNumber,
    previousAccession: previous.accessionNumber,
    currentValue,
    previousValue,
    absoluteChange,
    percentChange,
    currentPeriodEnd: current.periodEnd.toISOString().slice(0, 10),
    previousPeriodEnd: previous.periodEnd.toISOString().slice(0, 10),
    periodMonths: currentMonths,
    currentPeriodDays,
    previousPeriodDays,
    periodLengthMismatch,
  };
}

/** Exact span in days, or null for an instant concept. */
function periodLengthDays(periodStart: Date | null, periodEnd: Date): number | null {
  if (!periodStart) return null;
  return Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY);
}

/** Computes the diff for every concept tracked for one company, in one call. */
export async function computeFilingDiff(
  sourceId: string,
  corpCode: string,
  concepts: { concept: string; unit: string }[],
): Promise<FilingDiffResult[]> {
  return Promise.all(
    concepts.map((c) => computeFinancialFactDiff(sourceId, corpCode, c.concept, c.unit)),
  );
}
