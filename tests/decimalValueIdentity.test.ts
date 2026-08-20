import { describe, expect, it } from "vitest";
import { sameDecimalValue } from "@/server/domain/observationIngest";

/**
 * Gate A, finding D1 — a revision that would have vanished.
 *
 * The ingest path decided whether an incoming figure differed from the stored one by comparing
 * `Number(stored) === Number(incoming)`. The column holds six decimal places and a JavaScript
 * double carries roughly fifteen to seventeen significant digits, so a large value with six
 * decimals exceeds what a double can distinguish: `10000000000000.000001` and `...000002` are the
 * same number to JavaScript. A genuine revision would have been recorded as "unchanged".
 *
 * No series in this database is anywhere near that magnitude, so it was latent rather than
 * observed. It is fixed anyway because of how it fails: nothing errors, no revision row appears,
 * and the ledger looks perfectly consistent while missing a figure — which is the exact outcome
 * the revision chain exists to make impossible.
 */

describe("two stored figures are the same only when they are the same", () => {
  it("distinguishes values a double cannot", () => {
    // The finding, reproduced. The second assertion is the control that makes the first mean
    // something: this is precisely what the old comparison did.
    expect(sameDecimalValue("10000000000000.000001", "10000000000000.000002")).toBe(false);
    expect(Number("10000000000000.000001") === Number("10000000000000.000002")).toBe(true);
  });

  it("treats insignificant trailing zeros as the same figure", () => {
    // A reading of 10.5 is a reading of 10.500000. Comparing raw text would have turned every
    // re-ingest into a spurious revision, which is the opposite failure and just as bad.
    expect(sameDecimalValue("10.5", "10.500000")).toBe(true);
    expect(sameDecimalValue("100", "100.000000")).toBe(true);
    expect(sameDecimalValue("0100.50", "100.5")).toBe(true);
  });

  it("treats negative zero as zero", () => {
    expect(sameDecimalValue("-0", "0")).toBe(true);
    expect(sameDecimalValue("-0.000000", "0")).toBe(true);
  });

  it("still sees ordinary differences", () => {
    expect(sameDecimalValue("4.1", "4.2")).toBe(false);
    expect(sameDecimalValue("0.000001", "0.000002")).toBe(false);
    expect(sameDecimalValue("-1.5", "1.5")).toBe(false);
    expect(sameDecimalValue("103.4", "103.40001")).toBe(false);
  });
});

/**
 * Gate B, finding DI-1 — the fix for D1 assumed a spelling the data does not keep to.
 *
 * The first version compared normalised decimal STRINGS. That removed the double problem and
 * introduced a smaller one facing the other way: both adapters validate an incoming value with
 * `Number.isFinite(Number(raw))` and then persist the ORIGINAL string, so every spelling
 * JavaScript accepts arrives here verbatim — `1e5`, `+1`, `.5`.
 *
 * The consequence was not cosmetic. `upsertRevisionAwareObservation` uses this function twice: once
 * to detect "unchanged", and once for the rollback guard that recognises a value the chain has
 * already superseded. A provider replaying `1e5` over a chain that had moved on to `110000` would
 * not have been recognised as stale, and the old figure would have been written back in as a
 * revision.
 *
 * The rounding case is the same argument in miniature: the column is `Decimal(20, 6)`, so an
 * incoming `1.2345678` IS the stored `1.234568` once it lands. Comparing at full incoming
 * precision manufactures a revision that records no change.
 */
describe("every decimal spelling the adapters can deliver", () => {
  it.each([
    ["1e5", "100000"],
    ["1E+5", "100000"],
    ["1.5e3", "1500"],
    ["1e-3", "0.001"],
    [".5", "0.5"],
    ["+1", "1"],
    ["+0.25", ".25"],
    ["  42  ", "42"],
  ])("reads %s as %s", (incoming, stored) => {
    expect(sameDecimalValue(incoming, stored)).toBe(true);
  });

  it("compares at the column's precision, not the provider's", () => {
    // Decimal(20, 6). Anything past the sixth place is not stored, so it cannot be a revision.
    expect(sameDecimalValue("1.234568", "1.2345678")).toBe(true);
    expect(sameDecimalValue("0", "2.5e-7")).toBe(true);
    // Half away from zero, as the column rounds on the way in.
    expect(sameDecimalValue("0.000001", "5e-7")).toBe(true);
    // ...and the sixth place itself still matters.
    expect(sameDecimalValue("1.234568", "1.234569")).toBe(false);
  });

  it("does not silently equate things it cannot parse", () => {
    // Unparseable input is DIFFERENT unless the strings are identical. The two possible errors are
    // not symmetric: a spurious revision is a visible extra row, a missed one is silence.
    expect(sameDecimalValue("abc", "1")).toBe(false);
    expect(sameDecimalValue("", "0")).toBe(false);
    expect(sameDecimalValue("1,000", "1000")).toBe(false);
    expect(sameDecimalValue("NaN", "0")).toBe(false);
    expect(sameDecimalValue("Infinity", "0")).toBe(false);
    expect(sameDecimalValue("abc", "abc")).toBe(true);
  });

  it("does not lose precision on the way through the exponent form", () => {
    // The reason this is bigint arithmetic and not `Number(raw)`: expanding the exponent through a
    // double would put the D1 defect straight back in.
    expect(sameDecimalValue("1.0000000000000000001e13", "10000000000000.000001")).toBe(true);
    expect(sameDecimalValue("1.0000000000000000001e13", "10000000000000.000002")).toBe(false);
    // `Number()` cannot tell those two apart, which is the whole reason for the bigint path.
    expect(Number("1.0000000000000000001e13") === Number("10000000000000.000002")).toBe(true);
  });
});
