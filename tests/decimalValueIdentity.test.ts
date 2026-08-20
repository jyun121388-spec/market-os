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
