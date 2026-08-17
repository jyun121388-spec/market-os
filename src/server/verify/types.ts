/**
 * Verify — SHADOW MODE contract (docs/VERIFY_ARCHITECTURE.md).
 *
 * Verify answers one question about a single Market OS output: is this supportable by the
 * evidence that produced it? It is not a test runner. Tests assert that code behaves as written,
 * against fixtures. Verify evaluates a specific output, on real data, against real evidence.
 *
 * The distinction is not academic here. This project's worst defect passed every test it had:
 * Filing Diff reported a confident +232.9985% Apple revenue increase by comparing a nine-month
 * figure against a quarterly one. The arithmetic was correct, the tests were green, the output was
 * fabricated. `semantic_consistency` below exists for precisely that gap — the difference between
 * "the subtraction is right" and "these two numbers were comparable in the first place".
 *
 * Nothing in v1 imports this. It computes verdicts and blocks nothing.
 */

export type Verdict =
  | "VERIFIED" // every applicable dimension passed
  | "VERIFIED_WITH_LIMITATION" // supportable, with a caveat the reader must see
  | "CONFLICTED" // sources disagree beyond tolerance; no single answer is defensible
  | "INSUFFICIENT_EVIDENCE" // cannot be judged — deliberately NOT the same as wrong
  | "STALE" // was supportable; the underlying data is past its cadence
  | "TRUNCATED" // computed over a knowably partial dataset
  | "UNVERIFIED" // not evaluated (honest placeholder, the shadow default)
  | "REJECTED"; // a dimension failed in a way that makes the output misleading

export type DimensionStatus = "PASS" | "FAIL" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE";

export interface DimensionResult {
  status: DimensionStatus;
  /** What was actually checked, in words. Required — a bare PASS proves nothing to a reader. */
  rationale: string;
}

export type DimensionName =
  | "structural_validity"
  | "source_integrity"
  | "data_completeness"
  | "semantic_consistency"
  | "calculation_integrity"
  | "provenance_integrity"
  | "temporal_integrity"
  | "cross_source_consistency"
  | "adversarial_resilience";

export type Dimensions = Record<DimensionName, DimensionResult>;

export interface VerificationResult {
  outputId: string;
  verdict: Verdict;
  dimensions: Dimensions;
  /** Shown to the reader when the verdict is VERIFIED_WITH_LIMITATION. */
  limitations: string[];
  /** Every dimension that did not pass, so a verdict can always name its cause. */
  failed: DimensionName[];
}

/** One period a figure covers. `months`/`days` are null for an instant (a balance at a date). */
export interface PeriodSpan {
  start: string | null; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  months: number | null;
  days: number | null;
}

/** A quantity entering a calculation, carrying everything needed to judge comparability. */
export interface CalculationInput {
  label: string;
  value: number;
  unit: string;
  sourceCode: string;
  period: PeriodSpan;
  /** us-gaap concept or equivalent, where the quantity is a reported financial fact. */
  concept?: string;
  /** The filing this came from. Two inputs sharing one accession did not span two periods. */
  accessionNumber?: string;
}

export interface VerificationInput {
  outputId: string;
  claimType: "FACT" | "CALCULATION" | "INFERENCE";
  /** Every source the output's values came from. Empty means unsourced. */
  sourceCodes: string[];
  /** For CALCULATION outputs: enough to judge comparability and redo the arithmetic. */
  calculation?: {
    kind: "PERIOD_OVER_PERIOD_CHANGE";
    current: CalculationInput;
    previous: CalculationInput;
    claimedAbsoluteChange: number;
    claimedPercentChange: number | null;
  };
  /** Completeness evidence from the Reality Fabric, when available. */
  completeness?: {
    providerTotal: number | null;
    fetched: number | null;
    truncated: boolean;
  };
  /** Freshness from the Reality Fabric, when available. */
  freshness?: {
    state: "FRESH" | "STALE" | "UNKNOWN";
    daysSinceLastObservation: number | null;
  };
  /** INFERENCE claims must carry an evidence-derived confidence. */
  confidence?: number | null;
}
