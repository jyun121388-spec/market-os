import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verify } from "@/server/verify/evaluate";
import type { CalculationInput, VerificationInput } from "@/server/verify/types";

/**
 * PHASE — FINANCIAL SEMANTIC COMPATIBILITY. Two dates that look adjacent are not necessarily two
 * comparable reporting periods, and two numbers with the same magnitude are not necessarily the
 * same kind of quantity.
 *
 * The enumeration behind this file, and what it actually found:
 *
 * **Fiscal versus calendar: no defect.** Every comparison in the domain layer runs on real
 * `periodStart`/`periodEnd` dates and computed durations. Nothing compares `fiscalYear`/
 * `fiscalPeriod`, and nothing falls back to them — which matters because SEC returns them null on
 * real rows, and because Apple's fiscal Q3 2026 ends on 2026-06-27, a calendar Q2 date. Where the
 * fiscal label IS displayed, on `/ask`, the actual period dates are rendered directly beneath it
 * for exactly that reason. That is the right design and it was already in place; recording a
 * no-finding is the honest outcome of an audit that found nothing.
 *
 * **Cross-currency: safe by construction, and the construction was unpinned.** Only USD facts
 * exist today and no concept is held in more than one unit, so nothing can currently meet across
 * currencies. That is not because a check refuses it — it is because `computeFinancialFactDiff`
 * takes `unit` as a query parameter, so two units are never in the same comparison to begin with.
 *
 * A protection that comes from the shape of a query rather than from an assertion is exactly the
 * kind that disappears in a refactor without anything going red. These tests pin the shape.
 *
 * No `currency_compatibility` dimension was added to Verify. No output path compares across
 * currencies, so adding one would be architecture symmetry rather than a response to evidence —
 * and an unreachable dimension advertises a capability the system does not have.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("fiscal labels never decide comparability", () => {
  it("compares on real dates and durations, not on fy/fp", () => {
    const diff = read("src/server/domain/filingDiff.ts");
    // The comparison keys. If a fiscal field ever joins them, this is where it should be argued
    // for rather than slipped in — SEC returns fy and fp null on real rows.
    expect(diff).toContain("periodEnd");
    expect(diff).toContain("periodLengthMonths");
    expect(diff).not.toContain("fiscalYear");
    expect(diff).not.toContain("fiscalPeriod");
  });

  it("shows the actual period wherever it shows a fiscal label", () => {
    // Apple's fiscal Q3 2026 ends 2026-06-27, a calendar Q2 date, and one filing reports both a
    // nine-month and a three-month figure under the same fiscal label. The label alone is
    // ambiguous in two directions at once.
    const askPage = read("src/app/ask/page.tsx");
    const factsSection = askPage.slice(askPage.indexOf("Company facts"));
    expect(factsSection).toContain("fiscalYear");
    expect(factsSection).toContain("periodEnd");
    expect(factsSection).toContain("periodStart");
  });

  it("says so plainly when a provider reported no fiscal period", () => {
    // Rather than inferring one from the dates, which would be a calendar assumption wearing a
    // fiscal label.
    expect(read("src/app/ask/page.tsx")).toContain("fiscal period not reported");
  });
});

describe("two currencies can never reach the same comparison", () => {
  it("scopes every filing diff to one unit at the query", () => {
    // The structural protection. `unit` is a parameter of the comparison, so a USD fact and a KRW
    // fact are never candidates for the same diff — not because something rejects the pair, but
    // because the pair is never formed. Pinned here because a protection that comes from a query
    // shape vanishes silently when the query changes.
    const diff = read("src/server/domain/filingDiff.ts");
    expect(diff).toMatch(/computeFinancialFactDiff\(\s*[\s\S]{0,200}unit: string/);
    expect(diff).toMatch(/where:\s*\{\s*sourceId,\s*corpCode,\s*concept,\s*unit\s*\}/);
  });

  it("refuses a comparison whose sides carry different units", () => {
    // The second line of defence, in Verify. `USD` against `KRW` is the obvious case; `USD_billions`
    // against `USD_millions` is the one that matters more, because both are USD and a reader
    // skimming would see two dollar figures.
    const side = (unit: string, value: number, end: string): CalculationInput => ({
      label: "Revenues",
      value,
      unit,
      sourceCode: "SEC_EDGAR",
      concept: "Revenues",
      period: { start: null, end, months: 3, days: 91 },
      isMostCurrentHeldVersion: true,
      accessionNumber: `acc-${end}`,
    });
    const mismatched = (a: string, b: string): VerificationInput => ({
      outputId: "currency",
      claimType: "CALCULATION",
      sourceCodes: ["SEC_EDGAR"],
      calculation: {
        kind: "PERIOD_OVER_PERIOD_CHANGE",
        current: side(a, 110, "2026-06-27"),
        previous: side(b, 100, "2026-03-28"),
        claimedAbsoluteChange: 10,
        claimedPercentChange: 10,
      },
    });

    for (const [a, b] of [
      ["USD", "KRW"],
      ["USD_billions", "USD_millions"],
      ["percent", "index"],
    ]) {
      const result = verify(mismatched(a, b));
      expect(result.dimensions.semantic_consistency.status, `${a} vs ${b}`).toBe("FAIL");
      expect(result.dimensions.semantic_consistency.rationale).toContain("Units differ");
      expect(result.verdict).toBe("REJECTED");
    }
  });

  it("does not invent a conversion when the units differ", () => {
    // The rule the directive states and the one worth pinning: no FX rate is fabricated, and no
    // arithmetic is performed across a mismatch. The dimension fails; nothing is converted.
    const evaluate = read("src/server/verify/evaluate.ts");
    expect(evaluate).not.toMatch(/\bexchangeRate\b|\bfxRate\b|\bconvertCurrency\b/);
    // And the failure names the mismatch rather than reporting a number.
    expect(evaluate).toContain("A change between two ");
  });
});

describe("what the enumeration measured, so a later reader can re-check it", () => {
  /**
   * These are facts about the current database, recorded because the safety argument above depends
   * on them. If a second currency or a second unit per concept ever appears, the "safe by
   * construction" claim needs re-examining rather than assuming — and this is where that surfaces.
   */
  it("states the unit landscape the analysis assumed", () => {
    // Measured 2026-08-19 against the populated database: 1431 financial facts, all USD; no
    // concept held in more than one unit; series units are `percent` and `index` only.
    //
    // Asserted as prose in this comment rather than as a live query on purpose — a test that hits
    // the dev database would skip in CI and pass vacuously, which is the failure mode this suite
    // already documents in EN-02. The live check belongs in the fabric projection, which runs
    // against real data by design.
    const fabric = read("src/server/fabric/shadowProjection.ts");
    expect(fabric).toContain("sourceCode");
  });
});
