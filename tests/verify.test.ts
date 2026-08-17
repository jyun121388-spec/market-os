import { describe, expect, it } from "vitest";
import { verify } from "@/server/verify/evaluate";
import type { CalculationInput, VerificationInput } from "@/server/verify/types";

/**
 * Verify — shadow-mode evaluators (docs/VERIFY_ARCHITECTURE.md).
 *
 * The controls are this project's OWN historical defects, using the real Apple figures, because
 * invented cases prove nothing about the failures that actually happened.
 *
 * Both directions are mandatory. A verifier that only ever finds fault has verified nothing and
 * is far easier to build than one that discriminates — which is exactly how the local review
 * models failed their calibration (`docs/LOCAL_AI_CALIBRATION.md`). So every REJECTED case below
 * is paired with a corrected version that must come back VERIFIED.
 */

const fact = (over: Partial<CalculationInput> = {}): CalculationInput => ({
  label: "Revenues",
  value: 100,
  unit: "USD",
  sourceCode: "SEC_EDGAR",
  concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
  period: { start: "2026-03-29", end: "2026-06-27", months: 3, days: 90 },
  accessionNumber: "ACC-2",
  ...over,
});

const base = (over: Partial<VerificationInput> = {}): VerificationInput => ({
  outputId: "filingDiff:0000320193:Revenues:USD",
  claimType: "CALCULATION",
  sourceCodes: ["SEC_EDGAR"],
  completeness: { providerTotal: 2240, fetched: 2240, truncated: false },
  freshness: { state: "FRESH", daysSinceLastObservation: 1 },
  ...over,
});

describe("Verify — the +232.9985% defect", () => {
  // The real one. One Apple 10-Q reports revenue for the nine months ending 2026-06-27
  // ($364.357B) and for the three months ending the SAME DAY ($109.417B). Same accession, same
  // period end. The old Filing Diff compared them and reported +232.9985% growth.
  const nineVsThree = base({
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE",
      current: fact({
        value: 364_357_000_000,
        period: { start: "2025-09-28", end: "2026-06-27", months: 9, days: 272 },
      }),
      previous: fact({
        value: 109_417_000_000,
        period: { start: "2026-03-29", end: "2026-06-27", months: 3, days: 90 },
      }),
      claimedAbsoluteChange: 254_940_000_000,
      claimedPercentChange: 232.9985,
    },
  });

  it("rejects it", () => {
    const result = verify(nineVsThree);
    expect(result.verdict).toBe("REJECTED");
    expect(result.failed).toContain("semantic_consistency");
  });

  it("names the reason rather than just failing", () => {
    const result = verify(nineVsThree);
    expect(result.dimensions.semantic_consistency.rationale).toMatch(/2026-06-27/);
  });

  it("does NOT blame the arithmetic, which was correct", () => {
    // 364.357B - 109.417B really is 254.94B, and that really is +232.9985%. The defect was never
    // in the subtraction. A verifier that flagged calculation_integrity here would be pointing at
    // the wrong thing and would send an engineer to the wrong file.
    const result = verify(nineVsThree);
    expect(result.dimensions.calculation_integrity.status).toBe("PASS");
  });
});

describe("Verify — the corrected comparison must pass (negative control)", () => {
  // The same concept, as Filing Diff computes it today: two consecutive quarters, -1.59%.
  const quarterOverQuarter = base({
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE",
      current: fact({
        value: 109_417_000_000,
        period: { start: "2026-03-29", end: "2026-06-27", months: 3, days: 90 },
        accessionNumber: "ACC-2",
      }),
      previous: fact({
        value: 111_184_000_000,
        period: { start: "2025-12-29", end: "2026-03-28", months: 3, days: 89 },
        accessionNumber: "ACC-1",
      }),
      claimedAbsoluteChange: -1_767_000_000,
      claimedPercentChange: -1.5893,
    },
  });

  it("verifies", () => {
    const result = verify(quarterOverQuarter);
    expect(result.failed).toEqual([]);
    expect(result.verdict).toBe("VERIFIED");
  });

  it("treats 89 vs 90 days as ordinary calendar drift, not a mismatch", () => {
    expect(verify(quarterOverQuarter).limitations).toEqual([]);
  });
});

describe("Verify — a 14-week quarter is comparable but must be disclosed", () => {
  // Apple's fiscal Q1 is periodically 14 weeks. Real data: the 90-day quarter ending 2022-06-25
  // against the 97-day quarter ending 2022-12-31, reported as +54.2948% on NetIncomeLoss.
  const weekCount = base({
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE",
      current: fact({
        label: "NetIncomeLoss",
        concept: "NetIncomeLoss",
        value: 29_998_000_000,
        period: { start: "2022-09-25", end: "2022-12-31", months: 3, days: 97 },
        accessionNumber: "WK-14",
      }),
      previous: fact({
        label: "NetIncomeLoss",
        concept: "NetIncomeLoss",
        value: 19_442_000_000,
        period: { start: "2022-03-27", end: "2022-06-25", months: 3, days: 90 },
        accessionNumber: "WK-13",
      }),
      claimedAbsoluteChange: 10_556_000_000,
      claimedPercentChange: 54.2948,
    },
  });

  it("verifies WITH a limitation rather than rejecting", () => {
    // Refusing would be wrong: companies report those quarters as consecutive. Presenting them as
    // like-for-like without saying so is the quiet version of the +233% fabrication.
    const result = verify(weekCount);
    expect(result.verdict).toBe("VERIFIED_WITH_LIMITATION");
    expect(result.limitations.join(" ")).toMatch(/7 days/);
  });
});

describe("Verify — provenance and source", () => {
  it("rejects an output with no source at all", () => {
    const result = verify(base({ sourceCodes: [] }));
    expect(result.verdict).toBe("REJECTED");
    expect(result.failed).toContain("source_integrity");
  });

  it("rejects a comparison whose two figures come from different providers", () => {
    // IR-001/IR-002, stated as a rule: a corp code identifies a company only within its provider.
    const result = verify(
      base({
        sourceCodes: ["SEC_EDGAR", "OTHER_PROVIDER"],
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            value: 120,
            sourceCode: "OTHER_PROVIDER",
            period: { start: "2026-04-01", end: "2026-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            value: 100,
            period: { start: "2026-01-01", end: "2026-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 20,
          claimedPercentChange: 20,
        },
      }),
    );
    expect(result.failed).toContain("source_integrity");
  });

  it("rejects a derived number typed as a reported FACT", () => {
    const result = verify(
      base({
        claimType: "FACT",
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            value: 120,
            period: { start: "2026-04-01", end: "2026-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            value: 100,
            period: { start: "2026-01-01", end: "2026-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 20,
          claimedPercentChange: 20,
        },
      }),
    );
    expect(result.failed).toContain("provenance_integrity");
  });

  it("rejects an INFERENCE with no confidence", () => {
    const result = verify(base({ claimType: "INFERENCE", calculation: undefined }));
    expect(result.failed).toContain("provenance_integrity");
  });
});

describe("Verify — completeness and freshness are distinct verdicts", () => {
  it("reports TRUNCATED, not REJECTED, over a partial dataset", () => {
    // The EDGAR 1000-cap: 1000 of 2240 filings. The output is not wrong, it is incomplete, and
    // the two deserve different words.
    const result = verify(
      base({ completeness: { providerTotal: 2240, fetched: 1000, truncated: true } }),
    );
    expect(result.verdict).toBe("TRUNCATED");
  });

  it("reports INSUFFICIENT_EVIDENCE when the provider states no total", () => {
    // Absence of a total is not evidence of completeness — the rule assessCompleteness already
    // applies. It must not read as VERIFIED.
    const result = verify(
      base({ completeness: { providerTotal: null, fetched: 40, truncated: false } }),
    );
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("reports STALE when only freshness fails", () => {
    const result = verify(base({ freshness: { state: "STALE", daysSinceLastObservation: 220 } }));
    expect(result.verdict).toBe("STALE");
  });
});

describe("Verify — arithmetic is actually recomputed", () => {
  it("rejects a claimed change that does not follow from the stated inputs", () => {
    const result = verify(
      base({
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            value: 120,
            period: { start: "2026-04-01", end: "2026-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            value: 100,
            period: { start: "2026-01-01", end: "2026-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 20,
          claimedPercentChange: 99, // should be 20
        },
      }),
    );
    expect(result.failed).toContain("calculation_integrity");
  });

  it("accepts a percent change withheld because the previous value was zero", () => {
    const result = verify(
      base({
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            value: 120,
            period: { start: "2026-04-01", end: "2026-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            value: 0,
            period: { start: "2026-01-01", end: "2026-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 120,
          claimedPercentChange: null,
        },
      }),
    );
    expect(result.dimensions.calculation_integrity.status).toBe("PASS");
  });

  it("rejects a percentage invented from a zero previous value", () => {
    const result = verify(
      base({
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            value: 120,
            period: { start: "2026-04-01", end: "2026-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            value: 0,
            period: { start: "2026-01-01", end: "2026-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 120,
          claimedPercentChange: 12000,
        },
      }),
    );
    expect(result.failed).toContain("calculation_integrity");
  });
});

describe("Verify — taxonomy transitions", () => {
  it("rejects a comparison spanning the ASC 606 revenue tag change", () => {
    // Real Apple data holds Revenues (11 rows), SalesRevenueNet (210) and
    // RevenueFromContractWithCustomerExcludingAssessedTax (117) for the same economic quantity
    // across time. Subtracting across the boundary needs an explicit reconciliation, not a guess.
    const result = verify(
      base({
        calculation: {
          kind: "PERIOD_OVER_PERIOD_CHANGE",
          current: fact({
            concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 120,
            period: { start: "2018-04-01", end: "2018-06-30", months: 3, days: 90 },
          }),
          previous: fact({
            concept: "SalesRevenueNet",
            value: 100,
            period: { start: "2018-01-01", end: "2018-03-31", months: 3, days: 89 },
          }),
          claimedAbsoluteChange: 20,
          claimedPercentChange: 20,
        },
      }),
    );
    expect(result.failed).toContain("semantic_consistency");
  });
});

describe("Verify — a verdict always names its cause", () => {
  it("never returns a non-VERIFIED verdict with nothing failed and no limitation", () => {
    const inputs = [
      base({ sourceCodes: [] }),
      base({ completeness: { providerTotal: 2240, fetched: 1000, truncated: true } }),
      base({ freshness: { state: "STALE", daysSinceLastObservation: 220 } }),
      base({ completeness: { providerTotal: null, fetched: 1, truncated: false } }),
    ];
    for (const input of inputs) {
      const result = verify(input);
      const explained =
        result.failed.length > 0 ||
        result.limitations.length > 0 ||
        Object.values(result.dimensions).some((d) => d.status === "INSUFFICIENT_EVIDENCE");
      expect(explained, `verdict ${result.verdict} explained nothing`).toBe(true);
    }
  });

  it("gives every dimension a non-empty rationale, including the ones that pass", () => {
    const result = verify(base({ calculation: undefined }));
    for (const [name, d] of Object.entries(result.dimensions)) {
      expect(d.rationale.trim().length, `${name} had an empty rationale`).toBeGreaterThan(0);
    }
  });
});
