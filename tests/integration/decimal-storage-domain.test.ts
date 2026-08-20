import { describe, expect, it } from "vitest";
import { isStorableDecimal } from "@/server/domain/observationIngest";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

/**
 * Whether a value is storable, decided by the column rather than by JavaScript.
 *
 * `isStorableDecimal` guarded three different things across three rounds, and each of the first two
 * was a test for something adjacent to the real question. `Number.isFinite(Number(raw))` asks
 * whether JavaScript can read the string as a number — `0x10` can be read as sixteen. Decimal
 * SYNTAX asks whether it looks like a decimal — `1e999` looks like one. Neither asks whether
 * `numeric(20, 6)` can hold it, and two values proved that both were wrong:
 *
 *  - `100000000000000` is fifteen integer digits against a column that holds fourteen. Finite,
 *    well-formed, and rejected by PostgreSQL.
 *  - `99999999999999.9999995` is in range as written and rounds to `100000000000000.000000`,
 *    which is not. The boundary has to be checked AFTER rounding or this one crosses it unseen.
 *
 * Both reached the database before failing there, which is the wrong place to learn it: the
 * adapter has already accepted the row, and the ingest run fails partway through instead of
 * skipping one observation.
 *
 * So this file asks PostgreSQL. Every candidate is cast through `numeric(20, 6)` by the database
 * itself, and the validator is required to agree with what happened — accepted where the cast
 * succeeds, rejected where it raises. Nothing here asserts a boundary that was reasoned out; the
 * boundary is read off the column.
 */
describeIfDb("isStorableDecimal agrees with what numeric(20,6) will accept (integration)", () => {
  /** Values that must be storable, including both signs of the exact maximum. */
  const IN_RANGE = [
    "0",
    "-0.000000",
    "1",
    "+1",
    ".5",
    "1.234567",
    "1e5",
    "1E+5",
    "2.5e-7",
    "1e-30",
    "99999999999999",
    "1e13",
    "99999999999999.999999",
    "-99999999999999.999999",
  ] as const;

  /**
   * Values that must be rejected. The last two are the ones that motivated this file: one is over
   * by a single integer digit, and one is in range until it rounds.
   */
  const OUT_OF_RANGE = [
    "100000000000000",
    "-100000000000000",
    "1e14",
    "1e15",
    "99999999999999.9999995",
    "-99999999999999.9999995",
  ] as const;

  /** Whether PostgreSQL itself will accept this text as `numeric(20, 6)`. */
  async function columnAccepts(value: string): Promise<boolean> {
    const { prisma } = await import("@/server/db/client");
    try {
      await prisma.$queryRawUnsafe(`select cast($1::text as numeric(20,6)) as v`, value);
      return true;
    } catch {
      // A numeric field overflow is the whole point of the test, so the failure IS the answer.
      return false;
    }
  }

  it.each(IN_RANGE)("accepts %s, and so does the column", async (value) => {
    expect(await columnAccepts(value), `PostgreSQL rejected ${value}`).toBe(true);
    expect(isStorableDecimal(value)).toBe(true);
  });

  it.each(OUT_OF_RANGE)("rejects %s, and so does the column", async (value) => {
    expect(await columnAccepts(value), `PostgreSQL accepted ${value}`).toBe(false);
    expect(isStorableDecimal(value)).toBe(false);
  });

  it("rejects text that is not a number at all, as the column does", async () => {
    for (const value of ["abc", "", "1,000"]) {
      expect(await columnAccepts(value), `PostgreSQL accepted ${value}`).toBe(false);
      expect(isStorableDecimal(value), value).toBe(false);
    }
  });

  /**
   * The four places this validator is deliberately STRICTER than the column, asserted rather than
   * assumed — and they correct something this repository had recorded wrongly.
   *
   * Gate D fixed a defect where `0x10` passed the adapter and then made the identity comparator
   * throw on the next ingest. The fix was right; the explanation written beside it said PostgreSQL
   * would reject the value, and PostgreSQL 16 does not. It reads `0x10` as 16, `0b10` as 2, `0o10`
   * as 8, and it accepts `NaN` as a numeric value.
   *
   * That makes the original defect worse than recorded, not milder: the row would have been STORED
   * as sixteen. A provider sending hexadecimal for an economic observation is broken, and a
   * validator that quietly agrees with it stores a wrong number under a real series. Refusing is
   * the only defensible answer, and NaN is the same argument — a reading that is not a number is
   * not a reading.
   */
  it.each([
    ["0x10", "16.000000"],
    ["0b10", "2.000000"],
    ["0o10", "8.000000"],
    ["NaN", "NaN"],
  ])("refuses %s although the column would store it as %s", async (value) => {
    expect(await columnAccepts(value), `PostgreSQL rejected ${value}`).toBe(true);
    expect(isStorableDecimal(value)).toBe(false);
  });

  it("rejects an absurd exponent without trying to compute it", () => {
    // `1e999999999` is syntactically valid, and scaling it to find out it does not fit would
    // allocate a bigint with a billion digits. The exponent bound has to come first, and this
    // asserts the cost rather than just the answer.
    const started = process.hrtime.bigint();
    expect(isStorableDecimal("1e999999999")).toBe(false);
    expect(isStorableDecimal("-1e999999999")).toBe(false);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(50);
  });
});
