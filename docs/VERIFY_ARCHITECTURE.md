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
  | "SEMANTIC_REVISION_UNRESOLVED" // which version of the value is current cannot be established
  | "UNVERIFIED" // no verification attempted (shadow default, honest placeholder)
  | "REJECTED"; // a dimension failed in a way that makes the output misleading
```

`INSUFFICIENT_EVIDENCE` and `REJECTED` are deliberately distinct. "We cannot tell" and "this is
wrong" have different consequences, and collapsing them is how a system starts either crying wolf
or hiding uncertainty.

`SEMANTIC_REVISION_UNRESOLVED` was added with the provider-vintage contract. It says the value may
be a superseded VERSION of the right figure and that nothing on record can settle it — a narrower
and more actionable statement than `INSUFFICIENT_EVIDENCE`, with a known remedy. See
`revision_integrity` below.

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
    revision_integrity: DimensionResult;
    cross_source_consistency: DimensionResult;
    adversarial_resilience: DimensionResult;
  };
  /** Shown to the user when the verdict is VERIFIED_WITH_LIMITATION. */
  limitations: string[];
}
```

### What each dimension checks, and the real defect it would have caught

| Dimension                  | Checks                                                                                            | Would have caught                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `structural_validity`      | Shape, types, required fields, units present and from the known vocabulary                        | A `unit: "Percent"` typo silently disabling basis points           |
| `source_integrity`         | Every figure traces to a stored `Source`; tier recorded                                           | **IR-007/IR-008** — figures rendered with no provenance at all     |
| `data_completeness`        | `IngestRun.providerTotal` vs `fetched`; `truncated` false                                         | EDGAR's 1000-filing cap presenting 45% of history as complete      |
| `semantic_consistency`     | Compared quantities are like-for-like: same period length, unit, currency, taxonomy               | **The +232.9985% nine-month-vs-quarter comparison**                |
| `calculation_integrity`    | Recompute from stored inputs; result must match to stated precision                               | A correct formula fed the wrong two rows                           |
| `provenance_integrity`     | Claim type is honest — no INFERENCE rendered as FACT; source scoping intact                       | **IR-001/IR-002** — cross-provider pooling under one attribution   |
| `temporal_integrity`       | `observedAt` ≤ `releasedAt` ≤ `retrievedAt`; no future dates; revision chain resolved to its tail | Same-millisecond revision ordering ambiguity                       |
| `revision_integrity`       | Whether the value shown is the provider's current VERSION, from provider vintage evidence         | **IR-021** — a replayed stale figure rolling a correction backward |
| `cross_source_consistency` | Where two sources cover one fact, values within tolerance; else `CONFLICTED`                      | Silent divergence between providers                                |
| `adversarial_resilience`   | Output does not constitute prohibited advice under `LEGAL_GUARDRAILS.md`                          | The 21 Ask Market guardrail bypasses                               |

`semantic_consistency` is the dimension this project most needs and the one no test suite naturally
provides. It is the difference between "the subtraction is right" and "these two numbers were
comparable in the first place".

### `revision_integrity` — is this the current VERSION of the value?

Added after IR-021, and the only dimension that asks about the value's version rather than the
value itself. The replayed stale figure that reached users would have passed every other dimension
here: it was well-formed, correctly attributed, internally consistent and arithmetically sound. It
was simply the wrong version, and no amount of checking a number tells you whether a better one has
already superseded it.

It reads `ProviderVintage` evidence (`docs/WORLD_DATA_FABRIC.md`) through `compareVintage`:

| Vintage comparison | Status                | Meaning                                           |
| ------------------ | --------------------- | ------------------------------------------------- |
| CANDIDATE_IS_NEWER | PASS                  | The applied value is the provider's newer version |
| CANDIDATE_IS_OLDER | FAIL                  | A superseded figure is being presented as current |
| SAME_VINTAGE       | FAIL                  | Two different values claim one vintage            |
| UNRESOLVED         | INSUFFICIENT_EVIDENCE | Nothing on record orders the two                  |

**Applicability is earned from the input, never assumed.** Where both figures name the provider
filing they were read out of — an SEC accession, say — the version question is already answered by
that identity, and the dimension is `NOT_APPLICABLE` for a stated reason. That is what keeps
SEC-sourced comparisons from piling up as unknowns; without the rule, every Filing Diff output
would return the same verdict, which is the uniform-answer failure this layer has already produced
twice during its own construction.

`SEMANTIC_REVISION_UNRESOLVED` is the verdict when the version question is open. It is ranked above
the generic `INSUFFICIENT_EVIDENCE` rather than requiring it to be the sole unknown — the first
draft required that, and the verdict turned out to be unreachable in practice because a FACT always
leaves `adversarial_resilience` open too. A verdict no real input can produce is worse than none: it
advertises a capability the system does not have. Ranking it is also right on the merits. The other
unknowns are questions about coverage; this one says the number on the page may be the wrong version
of the right figure, which is nearer to incorrect than to unchecked.

Today, with no adapter populating any vintage field, every macro observation resolves to
`SEMANTIC_REVISION_UNRESOLVED` and every SEC comparison to `NOT_APPLICABLE`. That is the honest
picture, and it is also the work item: the verdict disappears from the macro path the moment a
provider vintage is captured.

### Why the evidence was missing, not just that it was

`DimensionResult` carries an optional `evidenceGap`, classified against the provider capability
matrix. The status says the evidence is not there; this says whether anyone can do anything about
it.

Two macro outputs can both be `INSUFFICIENT_EVIDENCE` on `revision_integrity` and mean opposite
things. For SEC the gap is `STRUCTURAL_LIMITATION` — no per-figure vintage is published and none
ever will be. For FRED it is `VERIFICATION_DEBT` with `HG-002` attached — the field is declared,
nobody has called the API, and one key closes it. A reader who cannot tell those apart will treat
both as the first, because that is the one requiring nothing.

The same applies to completeness. "The provider states no total" was being said identically about
SEC facts, where it is permanent, and about FRED, where a `count` field is declared and unverified.

Two rules keep it honest. The matrix describes ONE provider, so an output assembled from two
sources gets no classification at all rather than the first source's answer presented as if it
covered both — the cross-provider conflation IR-001 and IR-002 were about. And a source with no
profile yields `CAPABILITY_UNKNOWN`, never a guess.

Against the real database the gaps currently read: SEC filing diffs `CONDITIONAL_ABSENCE`, FRED and
ECOS series `VERIFICATION_DEBT`, test-fixture sources `CAPABILITY_UNKNOWN`.

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

### `adversarial_resilience`, and the third adapter

The dimension named after this project's largest legal risk had never done any work. It returned
NOT_APPLICABLE for every calculation — correctly, a period-over-period change recommends nothing —
and INSUFFICIENT_EVIDENCE for everything else. Technically honest, and it had never once been
pointed at output that could actually carry the risk.

Ask Market is the only path that can, and `verificationInputFromAskMarket` is the third adapter.
It takes a free-text question and answers with a curated set of figures, and the question can be
"should I buy this".

**What the adapter found.** Ask Market refuses a buy/sell question by setting
`PERSONALIZED_ADVICE_REDIRECTED` and attaching a redirect message — and it still returns the
factors, which `/ask` renders underneath. A user asking "Should I buy Apple Inc?" sees a refusal
followed by ten Apple figures. Confirmed against the populated database.

That is defensible, and the redirect message says exactly what it is doing: a factor analysis "for
you to interpret yourself". What makes it defensible rather than advice-by-arrangement is one
property — **the factors are identical to what the neutral query returns, in the same order.** The
advice detector and the factor selection are orthogonal, so the framing changes nothing. Nothing
enforced that; `findCompanyFacts` could start ranking on relevance to the question and the refusal
would quietly become the thing it refuses. `tests/integration/ask-market-refusal-invariant.test.ts`
now pins it, order included, because re-ranking the same true figures to lead with the flattering
ones would be a recommendation assembled entirely out of facts.

**The output-side detector is deliberately not the request-side one.**
`detectPersonalizedAdviceRequest` scans what the USER asked and is tuned to over-block: a
wrongly-redirected factual question is a small harm. This scans what the PRODUCT said, where
over-flagging is the larger harm — and the product's own refusal message contains the words
"buy/sell recommendations". A detector that cannot read a negation would condemn the exact sentence
that does the refusing, and the fix for that would be to weaken the detector, which is how a
guardrail becomes decorative. So every pattern requires an affirmative recommendation: an action
addressed to the reader, a price target, a rating, or a guarantee. The real redirect message is a
test fixture, verbatim.

Korean mirrors are present for the same reason the request-side list has them — 적정가, 목표주가,
매수 의견, 매도 의견. An English pattern with no Korean counterpart is a hole, not a simplification.

## What the shadow run actually reports

Three adapters exist, against three genuinely different real output shapes. Each one earned its
place by exercising something the previous ones could not — until the second existed, every
dimension had only ever been seen against Filing Diff, which is the fixture-realism failure this
project keeps finding, pointed at the verifier itself.

| Adapter                             | Output                          | Shape                                     |
| ----------------------------------- | ------------------------------- | ----------------------------------------- |
| `verificationInputFromFilingDiff`   | Company X-Ray period comparison | Spans, with an accession naming each side |
| `verificationInputFromSeriesChange` | Morning Brief "What Changed"    | Instants, with nothing naming the version |
| `verificationInputFromAskMarket`    | Ask Market answer               | Not arithmetic at all: prose plus figures |

Against the real database, `npm run verify:shadow` currently reports:

```
VERIFIED_WITH_LIMITATION       8    (SEC filing diffs — completeness unconfirmable, correctness fine)
SEMANTIC_REVISION_UNRESOLVED   5    (macro readings and Ask Market answers — no version evidence)
STALE                          3    (macro readings past their own cadence)
```

Three verdicts across three shapes is the result worth having. A verifier that returns one answer for
everything has told you nothing, and this layer has produced exactly that twice during its own
construction — once on completeness, once on advice-shape. The distribution is the control.

The macro adapter is built from the SAME reads Morning Brief performs, `getRecentObservationPair`
and `computeChange`, called rather than reimplemented. The previous value is never derived by
subtracting the claimed change from the current one: that would recompute the claim from the claim
and pass unconditionally. A test feeds it a wrong claim over right data and requires a `REJECTED`.

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
