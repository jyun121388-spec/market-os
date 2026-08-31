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
/**
 * The units a period can be measured in.
 *
 * `day` and `week` are trailing-only: there is no "this day" or "last day" operand, and a calendar
 * week is handled by the ISO-week forms rather than by counting sevens.
 */
export type IntervalUnit = "day" | "week" | "month" | "quarter" | "year";

/** The units that name a period on the calendar, as opposed to a window measured back from now. */
export type CalendarUnit = "week" | "month" | "quarter" | "year";

/**
 * A request's period, as a value rather than as a phrase.
 *
 * THE SINGLE SEMANTIC AUTHORITY, which is the point of Gate A. Before it, `INTERVAL_OPERANDS` in
 * `requestAuthority` listed what the parser would admit and the switch in this file listed what
 * could be resolved, and the two were kept in step by hand. They had already drifted once:
 * `since last year` sat in the parser's list with no case here, and the shorter ` last year ` was
 * found inside it first, so a request naming one period was answered about another.
 *
 * A value cannot drift from itself. Every member below is resolved exhaustively by
 * `resolveInterval`, and TypeScript checks the exhaustiveness rather than a comment promising it.
 */
export type Interval =
  /** A window measured back from the clock: `over the past 6 weeks`. Always RUNNING. */
  | { kind: "TRAILING"; count: number; unit: IntervalUnit }
  /** A period the calendar names: `this quarter` (running), `last quarter` (complete). */
  | { kind: "CALENDAR"; position: "CURRENT" | "PREVIOUS"; unit: CalendarUnit };

/**
 * Cardinals this grammar accepts as a count, beyond bare digits.
 *
 * A CLOSED SET, and the direction is deliberate: a cardinal missing from here makes the phrase
 * unparseable and the request REFUSES. Nothing is admitted by an omission, which is the property
 * the decision's "do not add a free-form duration parser" is protecting. `over the past 6 weeks`
 * and `over the past six weeks` are the same interval; `over the past several weeks` is not an
 * interval at all.
 */
const CARDINAL_WORDS = new Map<string, number>([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
]);

const UNIT_WORDS = new Map<string, IntervalUnit>([
  ["day", "day"],
  ["days", "day"],
  ["week", "week"],
  ["weeks", "week"],
  ["month", "month"],
  ["months", "month"],
  ["quarter", "quarter"],
  ["quarters", "quarter"],
  ["year", "year"],
  ["years", "year"],
]);

const CALENDAR_PHRASES = new Map<string, Interval>([
  ["this week", { kind: "CALENDAR", position: "CURRENT", unit: "week" }],
  ["last week", { kind: "CALENDAR", position: "PREVIOUS", unit: "week" }],
  ["this month", { kind: "CALENDAR", position: "CURRENT", unit: "month" }],
  ["last month", { kind: "CALENDAR", position: "PREVIOUS", unit: "month" }],
  ["this quarter", { kind: "CALENDAR", position: "CURRENT", unit: "quarter" }],
  ["last quarter", { kind: "CALENDAR", position: "PREVIOUS", unit: "quarter" }],
  ["this year", { kind: "CALENDAR", position: "CURRENT", unit: "year" }],
  ["last year", { kind: "CALENDAR", position: "PREVIOUS", unit: "year" }],
  // "Year to date" is this year said differently, and resolves identically.
  ["year to date", { kind: "CALENDAR", position: "CURRENT", unit: "year" }],
]);

/** `over the past` + optional count + unit. The count defaults to one when the phrase omits it. */
const TRAILING_PHRASE = /^over the past(?: ([a-z]+|\d+))? ([a-z]+)$/;

/**
 * The phrase a request used, as an `Interval`, or null when this grammar does not admit it.
 *
 * FAIL CLOSED on everything the decision names: zero, negative, fractional, a missing or
 * unsupported unit, a cardinal outside the closed set. `null` here means the request is refused,
 * never that a default is chosen.
 *
 * `since last year` does not parse, and that is the intended outcome rather than an oversight. An
 * anchored interval has at least three readings and no principle to choose between them, and
 * deciding them is explicitly out of scope for this unit.
 */
export function parseInterval(phrase: string): Interval | null {
  const text = phrase.trim().toLowerCase();

  const calendar = CALENDAR_PHRASES.get(text);
  if (calendar) return calendar;

  const trailing = TRAILING_PHRASE.exec(text);
  if (!trailing) return null;

  const [, rawCount, rawUnit] = trailing;
  const unit = UNIT_WORDS.get(rawUnit);
  if (unit === undefined) return null;

  if (rawCount === undefined) return { kind: "TRAILING", count: 1, unit };

  const count = CARDINAL_WORDS.get(rawCount) ?? (/^\d+$/.test(rawCount) ? Number(rawCount) : NaN);
  if (!Number.isInteger(count) || count < 1) return null;
  return { kind: "TRAILING", count, unit };
}

/** How many calendar months a trailing unit spans, or null when it is counted in days instead. */
function trailingMonths(unit: IntervalUnit): number | null {
  switch (unit) {
    case "month":
      return 1;
    case "quarter":
      // A trailing 3N-month window, NOT the previous complete calendar quarter. The two are
      // different periods and the decision names the distinction explicitly.
      return 3;
    case "year":
      return 12;
    case "day":
    case "week":
      return null;
  }
}

/**
 * An `Interval` as dates, against one captured clock.
 *
 * TOTAL over the type. Every member resolves, and the switch is exhaustive rather than defended by
 * a `default` branch apologising for drift -- which is what the previous version had.
 */
export function resolveInterval(interval: Interval, asOf: Date): PeriodResolution {
  const asOfDate = asOf.toISOString().slice(0, 10);
  const toDate = { until: asOfDate, running: true } as const;
  const operand = describeInterval(interval);
  const resolved = (period: Omit<ResolvedPeriod, "operand">): PeriodResolution => ({
    status: "RESOLVED",
    period: { operand, ...period },
  });

  if (interval.kind === "TRAILING") {
    const months = trailingMonths(interval.unit);
    if (months === null) {
      const days = interval.unit === "day" ? interval.count : interval.count * 7;
      return resolved({ start: addDays(asOf, -days).toISOString().slice(0, 10), ...toDate });
    }
    const total = months * interval.count;
    const start = sameDayMonthsBefore(asOf, total);
    if (!start) {
      return {
        status: "INDETERMINATE",
        detail:
          `There is no date ${total} calendar month(s) before ${asOfDate}. Moving to the ` +
          "nearest day would answer about a period the request did not name.",
      };
    }
    return resolved({ start: start.toISOString().slice(0, 10), ...toDate });
  }

  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  const quarter = Math.floor(month / 3);
  const current = interval.position === "CURRENT";

  switch (interval.unit) {
    case "year":
      return current
        ? resolved({ start: iso(year, 0, 1), ...toDate })
        : resolved({ start: iso(year - 1, 0, 1), until: iso(year - 1, 11, 31), running: false });
    case "month":
      return current
        ? resolved({ start: iso(year, month, 1), ...toDate })
        : resolved({
            start: iso(year, month - 1, 1),
            // Day zero of a month is the last day of the one before it.
            until: iso(year, month, 0),
            running: false,
          });
    case "quarter":
      return current
        ? resolved({ start: iso(year, quarter * 3, 1), ...toDate })
        : resolved({
            start: iso(year, (quarter - 1) * 3, 1),
            until: iso(year, quarter * 3, 0),
            running: false,
          });
    case "week": {
      if (current) {
        return resolved({ start: isoWeekStart(asOf).toISOString().slice(0, 10), ...toDate });
      }
      const start = addDays(isoWeekStart(asOf), -7);
      return resolved({
        start: start.toISOString().slice(0, 10),
        until: addDays(start, 6).toISOString().slice(0, 10),
        running: false,
      });
    }
  }
}

/**
 * The canonical phrase for an interval.
 *
 * `ResolvedPeriod.operand` is carried into what the reader is shown, so it must say what was
 * actually resolved rather than echo the words that happened to be typed.
 */
export function describeInterval(interval: Interval): string {
  if (interval.kind === "TRAILING") {
    const plural = interval.count === 1 ? interval.unit : `${interval.unit}s`;
    return `over the past ${interval.count} ${plural}`;
  }
  return `${interval.position === "CURRENT" ? "this" : "last"} ${interval.unit}`;
}

/**
 * Resolves one interval phrase against one captured clock.
 *
 * Kept as the module's entry point, now a thin composition of the two halves above so that parsing
 * and resolution cannot disagree about what a phrase means.
 *
 * Two choices in here are product decisions rather than mechanics, and are written down because
 * they are the ones a reader would otherwise have to infer from behaviour:
 *
 * **A complete period ends where the calendar ended.** "Last quarter" is the previous complete
 * calendar quarter, not a trailing three months. `over the past 1 quarter` is the trailing one, and
 * they are deliberately different periods reachable by different phrases.
 *
 * **A period opens on the boundary date itself.** Not the last reading before it, which imports
 * movement from outside the period; not the first reading after it, which silently shortens the
 * period. Both are defensible policies and neither is what the request said, so an absent boundary
 * refuses rather than being approximated by its neighbour.
 *
 * An unparseable phrase is INDETERMINATE, which is the same answer the old `default` branch gave --
 * except that it is now the only way to reach that outcome, because every value the grammar admits
 * has a resolution by construction.
 */
export function resolveObservationPeriod(operand: string, asOf: Date): PeriodResolution {
  const interval = parseInterval(operand);
  if (interval === null) {
    return {
      status: "INDETERMINATE",
      detail: `"${operand}" names no period this repository can resolve to dates.`,
    };
  }
  const resolution = resolveInterval(interval, asOf);
  if (resolution.status === "INDETERMINATE") return resolution;
  // The caller named the period; echo their phrase back rather than the canonical one, so an
  // existing operand's `operand` field is unchanged by this refactor.
  return { status: "RESOLVED", period: { ...resolution.period, operand } };
}
