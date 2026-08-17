# Verify

> **Status: DESIGN + SHADOW MODE.** Verify blocks nothing in v1. See `docs/META_ARCHITECTURE_V2.md`.

Verify answers one question about a single Market OS output: **is this supportable by the evidence
that produced it?**

It is not a test runner. Tests assert that code behaves as written, against fixtures. Verify
evaluates a _specific output, on real data, at a specific moment_, against evidence from the
Reality Fabric. The distinction matters because this project's most serious defect passed every
test it had: Filing Diff reported a confident, plausible **+232.9985%** Apple revenue increase by
comparing a nine-month figure against a quarterly one. The arithmetic was correct. The tests were
green. The output was fabricated. Verify exists for that gap.

## Verdicts

```ts
export type Verdict =
  | "VERIFIED" // every dimension passed
  | "VERIFIED_WITH_LIMITATION" // supportable, with a disclosed caveat the user must see
  | "CONFLICTED" // sources disagree beyond tolerance; no single answer is defensible
  | "INSUFFICIENT_EVIDENCE" // cannot be judged — NOT the same as wrong
  | "STALE" // was supportable; underlying data is past its cadence
  | "TRUNCATED" // computed over a knowably partial dataset
  | "UNVERIFIED" // no verification attempted (shadow default, honest placeholder)
  | "REJECTED"; // a dimension failed in a way that makes the output misleading
```

`INSUFFICIENT_EVIDENCE` and `REJECTED` are deliberately distinct. "We cannot tell" and "this is
wrong" have different consequences, and collapsing them is how a system starts either crying wolf
or hiding uncertainty.

## Dimensions

Each dimension is independently evaluated and independently reportable. A verdict that cannot name
which dimension produced it is not usable.

```ts
export type DimensionStatus = "PASS" | "FAIL" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE";

export interface DimensionResult {
  status: DimensionStatus;
  /** What was actually checked, in words. Required — a bare PASS proves nothing. */
  rationale: string;
  /** Ids of the rows, runs and claims examined, so the result can be recomputed later. */
  evidenceRefs: string[];
}

export interface VerificationResult {
  outputId: string; // what was verified (claim id, or a stable output key)
  verdict: Verdict;
  evaluatedAt: string;
  dimensions: {
    structural_validity: DimensionResult;
    source_integrity: DimensionResult;
    data_completeness: DimensionResult;
    semantic_consistency: DimensionResult;
    calculation_integrity: DimensionResult;
    provenance_integrity: DimensionResult;
    temporal_integrity: DimensionResult;
    cross_source_consistency: DimensionResult;
    adversarial_resilience: DimensionResult;
  };
  /** Shown to the user when the verdict is VERIFIED_WITH_LIMITATION. */
  limitations: string[];
}
```

### What each dimension checks, and the real defect it would have caught

| Dimension                  | Checks                                                                                            | Would have caught                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `structural_validity`      | Shape, types, required fields, units present and from the known vocabulary                        | A `unit: "Percent"` typo silently disabling basis points         |
| `source_integrity`         | Every figure traces to a stored `Source`; tier recorded                                           | **IR-007/IR-008** — figures rendered with no provenance at all   |
| `data_completeness`        | `IngestRun.providerTotal` vs `fetched`; `truncated` false                                         | EDGAR's 1000-filing cap presenting 45% of history as complete    |
| `semantic_consistency`     | Compared quantities are like-for-like: same period length, unit, currency, taxonomy               | **The +232.9985% nine-month-vs-quarter comparison**              |
| `calculation_integrity`    | Recompute from stored inputs; result must match to stated precision                               | A correct formula fed the wrong two rows                         |
| `provenance_integrity`     | Claim type is honest — no INFERENCE rendered as FACT; source scoping intact                       | **IR-001/IR-002** — cross-provider pooling under one attribution |
| `temporal_integrity`       | `observedAt` ≤ `releasedAt` ≤ `retrievedAt`; no future dates; revision chain resolved to its tail | Same-millisecond revision ordering ambiguity                     |
| `cross_source_consistency` | Where two sources cover one fact, values within tolerance; else `CONFLICTED`                      | Silent divergence between providers                              |
| `adversarial_resilience`   | Output does not constitute prohibited advice under `LEGAL_GUARDRAILS.md`                          | The 21 Ask Market guardrail bypasses                             |

`semantic_consistency` is the dimension this project most needs and the one no test suite naturally
provides. It is the difference between "the subtraction is right" and "these two numbers were
comparable in the first place".

## Evidence model

A verdict must be recomputable from what it cites. Anything else is an opinion with a timestamp.

```ts
export interface Evidence {
  kind: "OBSERVATION" | "FINANCIAL_FACT" | "FILING" | "INGEST_RUN" | "CLAIM" | "FABRIC_STATUS";
  id: string;
  sourceCode: string;
  temporal: TemporalStamp | null;
  /** Digest of the values relied on, so later mutation of the row is detectable. */
  digest: string;
}

export interface VerificationInput {
  outputId: string;
  claimType: "FACT" | "CALCULATION" | "INFERENCE";
  evidence: Evidence[];
  /** For CALCULATION outputs: enough to redo the arithmetic independently. */
  calculation?: {
    expression: string; // e.g. "(current - previous) / previous * 100"
    inputs: Record<string, number>;
    inputPeriods: Record<string, { start: string | null; end: string; months: number | null }>;
    claimedResult: number;
  };
}
```

`inputPeriods` is not optional decoration. Carrying each input's covered period is exactly what
makes `semantic_consistency` mechanically checkable rather than a matter of judgement: two inputs
whose `months` differ cannot form a period-over-period comparison, and that is a rule a machine can
enforce. `filingDiff.ts` already computes `periodMonths` for precisely this reason — Verify
generalises it instead of reimplementing it.

## Confidence, and why there are no percentages

`Claim.confidence` exists in v1 as a 0–1 float required for INFERENCE claims. Verify does **not**
produce one.

A number like "94% confident" implies a calibrated probability. Nothing here produces one: it
would be a model's self-report, and `docs/LOCAL_AI_CALIBRATION.md` documents exactly what those
are worth — both local models expressed high confidence while claiming a date parser accepts
`2026-02-30`, which it demonstrably rejects. Verify reports **which dimensions passed, on what
evidence**. A reader who wants to know how much to trust an output reads the dimensions.

Where a strength signal is genuinely needed, it is derived and discrete: `SourceTier` for source
strength, count of corroborating sources for cross-source agreement.

## Relationship to the Claim Ledger

v1's `Claim` model is the natural anchor: it already stores `claimText`, `claimType`, `sourceId`,
`sourceUrl`, `retrievedAt`, `evidence` and `conflictStatus`. Verify consumes a Claim plus Fabric
evidence and produces a `VerificationResult`.

`claimVerification.ts` already performs structural verification of claims against stored
observations. **Verify is its generalisation, not its replacement** — that module becomes the
`calculation_integrity` and `provenance_integrity` evaluators.

## Shadow mode plan

1. Implement the evaluators as pure functions over `VerificationInput`. Pure means testable against
   the real historical defects listed above, which are the best available fixtures.
2. Run Verify over live outputs. Record verdicts. **Show nothing to users.**
3. Measure against known ground truth:
   - Feed it the pre-fix `+232.9985%` diff. It must return `REJECTED` on `semantic_consistency`.
   - Feed it the pre-fix truncated EDGAR ingest. It must return `TRUNCATED`.
   - Feed it the current, correct outputs. **It must return `VERIFIED`** — the negative control,
     and the one that actually decides whether this is worth promoting.
4. Promotion requires no `REJECTED` verdict on an output later confirmed correct, across a real
   sample.

Step 3's negative control is non-negotiable, for the reason the local-model calibration made
concrete: a verifier that flags everything has verified nothing, and it is much easier to build
than one that discriminates. The same standard applied to the 4B models applies to this layer.
