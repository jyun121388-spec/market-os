import { describe, expect, it } from "vitest";
import {
  parseInterval,
  resolveInterval,
  resolveObservationPeriod,
} from "@/server/domain/observationPeriod";

/**
 * What each interval operand MEANS, against a frozen clock.
 *
 * The integration tests exercise `this year` and nothing else, and adversarial review pointed out
 * what that permits: a resolver hard-coded for `this year` would pass every one of them. This is
 * the table, and it is a unit test because none of it needs a repository — an operand and a clock
 * are the whole input.
 *
 * Two properties are being pinned rather than one. The obvious one is the boundaries. The other is
 * that a period which cannot be stated **refuses**: no clamping, no nearest day, no approximation.
 */

const at = (iso: string) => new Date(iso);

function period(operand: string, clock: string) {
  const resolution = resolveObservationPeriod(operand, at(clock));
  if (resolution.status !== "RESOLVED") throw new Error(`${operand} did not resolve`);
  return resolution.period;
}

describe("calendar periods that have closed", () => {
  it("reads last quarter as the previous complete calendar quarter", () => {
    // Not a trailing three months. The answer will not change tomorrow, which is what makes it a
    // closed period.
    expect(period("last quarter", "2026-05-20T12:00:00Z")).toMatchObject({
      start: "2026-01-01",
      until: "2026-03-31",
      running: false,
    });
  });

  it("crosses the year boundary in January without landing in month -1", () => {
    // Quarter arithmetic runs through Date.UTC with a negative month index here, which normalizes
    // into the previous year. This is the case a hand-rolled month table gets wrong.
    expect(period("last quarter", "2026-01-01T00:30:00Z")).toMatchObject({
      start: "2025-10-01",
      until: "2025-12-31",
      running: false,
    });
    expect(period("last month", "2026-01-15T00:00:00Z")).toMatchObject({
      start: "2025-12-01",
      until: "2025-12-31",
      running: false,
    });
  });

  it("closes last month on the last day of that month, including February", () => {
    expect(period("last month", "2026-03-10T00:00:00Z").until).toBe("2026-02-28");
    expect(period("last month", "2024-03-10T00:00:00Z").until).toBe("2024-02-29");
  });

  it("reads last year as the whole previous calendar year", () => {
    expect(period("last year", "2026-08-25T12:00:00Z")).toMatchObject({
      start: "2025-01-01",
      until: "2025-12-31",
      running: false,
    });
  });

  it("puts a Sunday in the week that started the Monday before it", () => {
    // getUTCDay is 0 on Sunday, so the naive offset puts Sunday at the START of a week. ISO weeks
    // end there.
    expect(period("this week", "2026-01-04T12:00:00Z")).toMatchObject({
      start: "2025-12-29",
      running: true,
    });
    expect(period("last week", "2026-01-04T12:00:00Z")).toMatchObject({
      start: "2025-12-22",
      until: "2025-12-28",
      running: false,
    });
  });
});

describe("periods that are still running", () => {
  it("opens on the calendar boundary and closes at the clock", () => {
    expect(period("this year", "2026-08-25T12:00:00Z")).toMatchObject({
      start: "2026-01-01",
      until: "2026-08-25",
      running: true,
    });
    expect(period("this quarter", "2026-08-25T12:00:00Z")).toMatchObject({
      start: "2026-07-01",
      until: "2026-08-25",
      running: true,
    });
    expect(period("this month", "2026-08-25T12:00:00Z")).toMatchObject({
      start: "2026-08-01",
      until: "2026-08-25",
      running: true,
    });
  });

  it("treats year to date as the same period as this year", () => {
    expect(period("year to date", "2026-08-25T12:00:00Z")).toEqual({
      ...period("this year", "2026-08-25T12:00:00Z"),
      operand: "year to date",
    });
  });

  it("measures a trailing duration from the same calendar day", () => {
    expect(period("over the past year", "2026-08-25T12:00:00Z").start).toBe("2025-08-25");
    expect(period("over the past month", "2026-08-25T12:00:00Z").start).toBe("2026-07-25");
  });
});

describe("a period that cannot be stated refuses", () => {
  it("refuses a trailing month whose corresponding day does not exist", () => {
    // 31 March minus one month is not 28 February; it is nothing. Clamping would answer about a
    // period the request did not name.
    const resolution = resolveObservationPeriod("over the past month", at("2026-03-31T12:00:00Z"));
    expect(resolution.status).toBe("INDETERMINATE");
  });

  it("handles 29 February where it exists and refuses where it does not", () => {
    expect(period("over the past month", "2024-03-29T12:00:00Z").start).toBe("2024-02-29");
    expect(resolveObservationPeriod("over the past year", at("2024-02-29T12:00:00Z")).status).toBe(
      "INDETERMINATE",
    );
  });

  it("refuses an operand it has no boundaries for", () => {
    // "since last year" has at least three readings and no principle to choose between them, so the
    // resolver refuses rather than guessing, whatever the operand set happens to contain.
    //
    // THE COMMENT HERE USED TO SAY IT WAS "deliberately gone" FROM THE OPERAND SET. It was not --
    // it is still in `INTERVAL_OPERANDS`, and the parser was reaching this refusal only in theory,
    // because the scan finds the shorter ` last year ` inside it first. See the anchored-interval
    // controls in `tests/requestAuthority.test.ts` for what that cost.
    expect(resolveObservationPeriod("since last year", at("2026-08-25T12:00:00Z")).status).toBe(
      "INDETERMINATE",
    );
  });
});

describe("the clock decides, and only the clock", () => {
  it("gives the same answer whatever the host timezone is", () => {
    // Every getter in the resolver is a UTC variant. A boundary that moved with the machine's
    // timezone would make the same request answer differently on two servers.
    const clock = at("2026-01-01T00:30:00Z");
    const original = process.env.TZ;
    const results: string[] = [];
    for (const tz of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      const resolved = resolveObservationPeriod("last quarter", clock);
      results.push(
        resolved.status === "RESOLVED"
          ? `${resolved.period.start}..${resolved.period.until}`
          : "REFUSED",
      );
    }
    process.env.TZ = original;
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("2025-10-01..2025-12-31");
  });
});

describe("the trailing family, and what it is NOT", () => {
  const at = (iso: string) => new Date(iso);
  const dates = (phrase: string, clock: string) => {
    const r = resolveObservationPeriod(phrase, at(clock));
    if (r.status !== "RESOLVED") throw new Error(`${phrase} did not resolve`);
    return `${r.period.start}..${r.period.until} running=${r.period.running}`;
  };

  it("counts back from the clock, in days for day and week", () => {
    // A trailing week is seven days back, NOT the ISO calendar week. The decision names the
    // distinction because the two are different periods reachable by different phrases.
    expect(dates("over the past 6 weeks", "2026-08-25T12:00:00Z")).toBe(
      "2026-07-14..2026-08-25 running=true",
    );
    expect(dates("over the past 10 days", "2026-08-25T12:00:00Z")).toBe(
      "2026-08-15..2026-08-25 running=true",
    );
  });

  it("counts back by exact calendar day for month, quarter and year", () => {
    expect(dates("over the past 3 months", "2026-08-25T12:00:00Z")).toBe(
      "2026-05-25..2026-08-25 running=true",
    );
    // A trailing quarter is 3N months, not a calendar quarter.
    expect(dates("over the past 1 quarter", "2026-08-25T12:00:00Z")).toBe(
      "2026-05-25..2026-08-25 running=true",
    );
    expect(dates("over the past 2 years", "2026-08-25T12:00:00Z")).toBe(
      "2024-08-25..2026-08-25 running=true",
    );
  });

  it("keeps `last quarter` a COMPLETE calendar quarter, distinct from the trailing one", () => {
    // THE DISCRIMINATION the decision asks for by name. Same clock, two phrases, two periods --
    // and the complete one is not running, which is the property the whole module exists to hold.
    expect(dates("last quarter", "2026-08-25T12:00:00Z")).toBe(
      "2026-04-01..2026-06-30 running=false",
    );
    expect(dates("over the past 1 quarter", "2026-08-25T12:00:00Z")).toBe(
      "2026-05-25..2026-08-25 running=true",
    );
  });

  it("maps the pre-existing fixed operands onto the same family as N=1", () => {
    // Item 4: these must keep their current behaviour exactly. `over the past year` and
    // `over the past 1 year` are the same interval said two ways.
    const clock = "2026-08-25T12:00:00Z";
    expect(dates("over the past year", clock)).toBe(dates("over the past 1 year", clock));
    expect(dates("over the past month", clock)).toBe(dates("over the past 1 month", clock));
    expect(parseInterval("over the past year")).toEqual({
      kind: "TRAILING",
      count: 1,
      unit: "year",
    });
  });

  it("refuses a non-existent calendar day rather than clamping it", () => {
    // 31 March minus one month is not 28 February; it is nothing. Clamping would answer about a
    // period the request did not name.
    expect(
      resolveObservationPeriod("over the past 1 month", at("2026-03-31T12:00:00Z")).status,
    ).toBe("INDETERMINATE");
    expect(
      resolveObservationPeriod("over the past 1 year", at("2024-02-29T12:00:00Z")).status,
    ).toBe("INDETERMINATE");
    // And the same for a multi-unit count that lands on the same impossible day.
    expect(
      resolveObservationPeriod("over the past 2 quarters", at("2026-08-31T12:00:00Z")).status,
    ).toBe("INDETERMINATE");
  });

  it("fails closed on every malformed count and unsupported unit", () => {
    // Item 1: zero, negative, fractional, missing unit, unsupported unit, and a cardinal outside
    // the closed set. Each must be UNPARSEABLE -- null, not a default.
    for (const phrase of [
      "over the past 0 weeks",
      "over the past -3 weeks",
      "over the past 1.5 years",
      "over the past several weeks",
      "over the past few months",
      "over the past 6 fortnights",
      "over the past 6",
      "over the past weeks extra",
      "since last year",
      "between january and june",
    ]) {
      expect(parseInterval(phrase), phrase).toBeNull();
      expect(resolveObservationPeriod(phrase, at("2026-08-25T12:00:00Z")).status, phrase).toBe(
        "INDETERMINATE",
      );
    }
  });

  it("accepts a closed set of cardinal words as well as digits", () => {
    // An omission here REFUSES rather than admitting a guess, which is why a list is tolerable in
    // this position at all. `several` is not a number and never becomes one.
    expect(parseInterval("over the past six weeks")).toEqual({
      kind: "TRAILING",
      count: 6,
      unit: "week",
    });
    expect(parseInterval("over the past twelve months")).toEqual({
      kind: "TRAILING",
      count: 12,
      unit: "month",
    });
    expect(parseInterval("over the past six weeks")).toEqual(
      parseInterval("over the past 6 weeks"),
    );
  });

  it("resolves EVERY value the grammar admits, so parser and resolver cannot drift", () => {
    // Item 6, as an executable property rather than a promise in a comment. Anything `parseInterval`
    // returns must resolve, and the only INDETERMINATE allowed is the impossible-calendar-day one.
    const clock = at("2026-08-17T12:00:00Z"); // a 17th exists in every month
    const units = ["day", "week", "month", "quarter", "year"];
    for (const unit of units) {
      for (const count of [1, 2, 7, 12]) {
        const phrase = `over the past ${count} ${unit}s`;
        const interval = parseInterval(phrase);
        expect(interval, phrase).not.toBeNull();
        expect(resolveInterval(interval!, clock).status, phrase).toBe("RESOLVED");
      }
    }
    for (const phrase of [
      "this week",
      "last week",
      "this month",
      "last month",
      "this quarter",
      "last quarter",
      "this year",
      "last year",
      "year to date",
    ]) {
      const interval = parseInterval(phrase);
      expect(interval, phrase).not.toBeNull();
      expect(resolveInterval(interval!, clock).status, phrase).toBe("RESOLVED");
    }
  });
});
