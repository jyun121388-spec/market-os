import { describe, expect, it } from "vitest";
import { resolveObservationPeriod } from "@/server/domain/observationPeriod";

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
