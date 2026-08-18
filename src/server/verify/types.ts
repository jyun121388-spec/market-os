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

import type { EvidenceGapKind } from "../fabric/providerCapability";
import type { ProviderVintage } from "../fabric/vintage";

export type Verdict =
  | "VERIFIED" // every applicable dimension passed
  | "VERIFIED_WITH_LIMITATION" // supportable, with a caveat the reader must see
  | "CONFLICTED" // sources disagree beyond tolerance; no single answer is defensible
  | "INSUFFICIENT_EVIDENCE" // cannot be judged — deliberately NOT the same as wrong
  | "STALE" // was supportable; the underlying data is past its cadence
  | "TRUNCATED" // computed over a knowably partial dataset
  | "SEMANTIC_REVISION_UNRESOLVED" // which version of the value is current cannot be established
  | "UNVERIFIED" // not evaluated (honest placeholder, the shadow default)
  | "REJECTED"; // a dimension failed in a way that makes the output misleading

export type DimensionStatus = "PASS" | "FAIL" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE";

export interface DimensionResult {
  status: DimensionStatus;
  /** What was actually checked, in words. Required — a bare PASS proves nothing to a reader. */
  rationale: string;
  /**
   * Why the evidence this dimension wanted was missing, where it was missing.
   *
   * Set only when the capability matrix can explain the absence. The status alone cannot carry
   * this: "the provider does not publish it", "we have never verified that it does" and "the
   * provider does and this record lacks it" all render as INSUFFICIENT_EVIDENCE, and they are
   * respectively a permanent limitation, a work item, and a defect. A reader who cannot tell them
   * apart will treat all three as the first one, because that is the only one requiring nothing.
   */
  evidenceGap?: EvidenceGapKind;
}

export type DimensionName =
  | "structural_validity"
  | "source_integrity"
  | "data_completeness"
  | "semantic_consistency"
  | "calculation_integrity"
  | "provenance_integrity"
  | "temporal_integrity"
  | "revision_integrity"
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
  /**
   * WHICH COMPANY this figure describes, in the issuing provider's own representation.
   *
   * Added after an adversarial review (`gpt-5.6-sol`) pointed out that the contract had no entity
   * identifier at all, so Apple revenue compared against Microsoft revenue was not merely
   * undetected — it was unrepresentable, and therefore invisible. A field that does not exist
   * cannot be checked, which is the most expensive kind of gap in a verification layer.
   */
  entityRef?: string;
  /** The period this figure covers. */
  period: PeriodSpan;
  /** us-gaap concept or equivalent, where the quantity is a reported financial fact. */
  concept?: string;
  /** The filing this came from. Two inputs sharing one accession did not span two periods. */
  accessionNumber?: string;
  /**
   * Whether this figure is the most current version HELD for its period.
   *
   * Distinct from `accessionNumber`, and the distinction was a real gap (`gpt-5.6-terra`,
   * reproduced). An accession says which filing a figure came from; it says nothing about whether
   * a later filing has since restated it. A superseded original carries a perfectly good
   * accession, so `revision_integrity` was returning NOT_APPLICABLE for exactly the case it
   * exists to catch.
   *
   * Set by an adapter that has ranked every held version for the period — `filingDiff` does, via
   * the shared `compareFactCurrency`. Absent means nobody ranked them, which is a different claim
   * from "there was only one".
   */
  isMostCurrentHeldVersion?: boolean;
}

/**
 * What is known about a value having superseded an earlier one.
 *
 * IR-021 in contract form: a replayed stale figure became the chain tail purely because it
 * arrived last, and the guard that now stops it is a heuristic standing in for evidence nobody
 * supplies. This is the shape of the evidence that would settle it properly.
 */
export interface RevisionEvidence {
  /** Provider version evidence for the value now displayed. */
  applied: ProviderVintage;
  /** Provider version evidence for the value it replaced. */
  superseded: ProviderVintage;
  /**
   * Whether the applied value repeats one already present earlier in the same chain — the
   * signature of a stale replay, and equally the signature of a provider genuinely correcting
   * back to a figure it published before. Indistinguishable without vintage, which is the point.
   */
  valueRepeatsEarlierInChain?: boolean;
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
    /**
     * Set only when the two concepts genuinely differ AND the difference has been deliberately
     * reconciled — an ASC 606 tag transition, say. Refusing every concept change made a correct,
     * intentional reconciliation unrepresentable; accepting one silently is the defect. So the
     * reconciliation must be DECLARED, and it surfaces as a disclosed limitation rather than
     * disappearing into a clean verdict.
     */
    conceptsReconciled?: string;
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
  /**
   * Provider version evidence for a value that REPLACED an earlier one (IR-021).
   *
   * Supplied only where a supersession actually happened. Its absence is not read as "no
   * supersession" — `revision_integrity` decides applicability from the figures themselves.
   */
  revision?: RevisionEvidence;
  /** INFERENCE claims must carry an evidence-derived confidence. */
  confidence?: number | null;
}
