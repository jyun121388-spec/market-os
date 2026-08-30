/**
 * The period a change request asked about, resolved to dates a repository can be queried with.
 *
 * IR-107 Unit 2d. `OBSERVED_CHANGE` required an interval operand from the very first version — the
 * parser refuses `"How much has CPI changed?"` because a change with no period is not a question
 * anyone can answer. The operand was then carried to the serving path as a STRING, and the serving
 * path computed from the last two stored readings and printed the string beside the answer.
 *
 * Reproduced against a monthly series rising ten a step: `this year`, `last quarter` and `last year`
 * all returned 10, because all three were the latest pair wearing a different label. The true
 * this-year move was 30. A sparse series with no readings at all in the current year returned a
 * figure labelled `this year`, which is not a wrong period so much as a claim about a period the
 * series does not cover.
 *
 * So the operand becomes a resolved period with real boundaries, and the boundaries choose the
 * observations. The distinction this module exists to hold is between two kinds of period:
 *
 *   COMPLETE  — the period closed on a calendar date. "Last quarter" ended when the quarter ended,
 *               and the answer will not change tomorrow.
 *   RUNNING   — the period is still open, so it closes at the clock. "This year" has a moving end,
 *               and a moving end is only honest while the data behind it is current.
 *
 * Both then take their END reading the same way: the newest one inside the period. They differ in
 * where the period closes, not in how a reading is chosen, which is the correction that made "last
 * year" answerable at all -- a monthly series published on the 1st has no reading on 31 December.
 *
 * Everything here is UTC Gregorian and derives from one captured clock. A change request answered
 * against a clock that has moved past the data is a different defect from the one being fixed, so
 * `asOf` is passed in and never read again from the system.
 */

/** A calendar date, `YYYY-MM-DD`, in UTC. The coordinate system the whole module works in. */
export type CalendarDate = string;

export interface ResolvedPeriod {
  operand: string;
  /**
   * The exact date the period opens on. An observation must exist here or the request refuses.
   *
   * Asymmetric with the end below, deliberately. A start later than the boundary understates the
   * movement in a way the period's name conceals -- "last year" computed from February is a claim
   * about a year measured over eleven months. A series that does not reach the opening boundary
   * does not cover the period, and neighbouring readings are not substitutes: the one before
   * imports movement from outside, the one after silently shortens it.
   */
  start: CalendarDate;
  /**
   * The last date that still belongs to the period: its calendar close, or the clock for a period
   * still running. The end reading is the newest one at or before this and at or after the start.
   *
   * Not an exact date to match. Requiring a reading ON the closing date was tried and refused
   * ordinary questions -- a monthly series published on the 1st has nothing on 31 December, so
   * "last year" was unanswerable for most series. Every sampled series ends its period before the
   * period does, which is why the running case already worked this way, and the two kinds differ
   * only in where the period closes.
   */
  until: CalendarDate;
  /** True while the period is still open, which is the only case whose end depends on freshness. */
  running: boolean;
}

export type PeriodResolution =
  { status: "RESOLVED"; period: ResolvedPeriod } | { status: "INDETERMINATE"; detail: string };

function iso(year: number, monthIndex: number, day: number): CalendarDate {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/** The Monday of the ISO week containing `date`, in UTC. */
function isoWeekStart(date: Date): Date {
  const day = date.getUTCDay();
  // getUTCDay is 0 for Sunday; ISO weeks start on Monday, so Sunday is six days into its week.
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * The same calendar day some months earlier, or null when that day does not exist.
 *
 * 31 March minus one month is not 28 February; it is nothing. Clamping would silently answer a
 * question about a period the request did not name, so it refuses instead — the same rule the rest
 * of this module follows for an absent boundary.
 */
function sameDayMonthsBefore(date: Date, months: number): Date | null {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const day = date.getUTCDate();
  const candidate = new Date(Date.UTC(year, month, day));
  return candidate.getUTCDate() === day ? candidate : null;
}

/**
 * Resolves one interval operand against one captured clock.
 *
 * The operand set is closed and lives in `requestAuthority`; this decides what each member MEANS.
 * Two choices in here are product decisions rather than mechanics, and are written down because
 * they are the ones a reader would otherwise have to infer from behaviour:
 *
 * **A complete period ends where the calendar ended.** "Last quarter" is the previous complete
 * calendar quarter, not a trailing three months. The distinction is the point: a calendar period
 * has fixed boundaries the reader can name, and a trailing window moves with the clock.
 *
 * **The product accepts BOTH, and this comment used to deny it.** It read "trailing windows are a
 * different question and the product does not currently accept one" while `over the past year` and
 * `over the past month`, resolved a few lines below by `sameDayMonthsBefore` with a running end at
 * `asOf`, are exactly trailing windows and have been accepted all along. A comment that argues for
 * a policy the code does not have is the defect class that cost MARKET-DEFINITION-GRAMMAR-001
 * three review rounds, so it is corrected here rather than left to be discovered again.
 *
 * What remains true, and is the actual constraint: the trailing forms are two fixed operands, not a
 * grammar. There is no `over the past N <unit>`; `over the past six weeks` is unreadable. Widening
 * that is gated on `[ESCALATION][MARKET-OS][DEC-INTERVAL-FAMILY-20260831]`, because the operand
 * table here and the one in `requestAuthority` are the SAME closed set, and widening the parser
 * alone would authorize a period this resolver cannot compute.
 *
 * **A period opens on the boundary date itself.** Not the last reading before it, which imports
 * movement from outside the period; not the first reading after it, which silently shortens the
 * period. Both are defensible policies and neither is what the request said, so an absent boundary
 * refuses rather than being approximated by its neighbour.
 */
export function resolveObservationPeriod(operand: string, asOf: Date): PeriodResolution {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  const quarter = Math.floor(month / 3);
  const asOfDate = asOf.toISOString().slice(0, 10);
  const toDate = { until: asOfDate, running: true } as const;
  const resolved = (period: ResolvedPeriod): PeriodResolution => ({ status: "RESOLVED", period });

  switch (operand) {
    case "this year":
    case "year to date":
      return resolved({ operand, start: iso(year, 0, 1), ...toDate });
    case "last year":
      return resolved({
        operand,
        start: iso(year - 1, 0, 1),
        until: iso(year - 1, 11, 31),
        running: false,
      });
    case "this month":
      return resolved({ operand, start: iso(year, month, 1), ...toDate });
    case "last month":
      return resolved({
        operand,
        start: iso(year, month - 1, 1),
        // Day zero of a month is the last day of the one before it.
        until: iso(year, month, 0),
        running: false,
      });
    case "this quarter":
      return resolved({ operand, start: iso(year, quarter * 3, 1), ...toDate });
    case "last quarter":
      return resolved({
        operand,
        start: iso(year, (quarter - 1) * 3, 1),
        until: iso(year, quarter * 3, 0),
        running: false,
      });
    case "this week":
      return resolved({
        operand,
        start: isoWeekStart(asOf).toISOString().slice(0, 10),
        ...toDate,
      });
    case "last week": {
      const start = addDays(isoWeekStart(asOf), -7);
      return resolved({
        operand,
        start: start.toISOString().slice(0, 10),
        until: addDays(start, 6).toISOString().slice(0, 10),
        running: false,
      });
    }
    case "over the past year":
    case "over the past month": {
      const months = operand === "over the past year" ? 12 : 1;
      const start = sameDayMonthsBefore(asOf, months);
      if (!start) {
        return {
          status: "INDETERMINATE",
          detail:
            `There is no date ${months} calendar month(s) before ${asOfDate}. Moving to the ` +
            "nearest day would answer about a period the request did not name.",
        };
      }
      return resolved({ operand, start: start.toISOString().slice(0, 10), ...toDate });
    }
    default:
      // Reached only if the operand set and this table drift apart, which is what the test pinning
      // them together exists to prevent.
      return {
        status: "INDETERMINATE",
        detail: `"${operand}" names no period this repository can resolve to dates.`,
      };
  }
}
