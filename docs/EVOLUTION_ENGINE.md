# Evolution Engine

> **Status: DESIGN + SHADOW MODE. The Evolution Engine never mutates production.**
> It proposes. Governance decides. A human or a verified pipeline applies.
> See `docs/META_ARCHITECTURE_V2.md`.

## What it is actually for

Not "an AI that fixes bugs". The valuable output is not a patch — it is a **systemic lesson**.

> **Weak:** "The Apple Filing Diff bug was fixed."
>
> **Useful:** "Our financial fixtures systematically under-represented multiple reporting durations
> within a single filing, so every test in that family was green against data that could not
> exhibit the defect."

The first sentence closes a ticket. The second predicts the _next_ defect — and in this project it
would have: the same fixture blindness that hid the +233% comparison also hid the missing
`periodStart` in the fact identity, and the same "one provider in the fixtures" blindness hid
IR-001, IR-002, IR-007 and IR-008.

The Engine's job is to notice that a fourth instance of a pattern has occurred and say so.

## The loop

```
OBSERVE      → collect signals: verdicts, failures, drift reports, review findings, incidents
MEASURE      → quantify: frequency, severity, recurrence, time-to-detection
DETECT       → cluster into a WEAKNESS: a recurring systemic cause, not an incident
HYPOTHESISE  → a falsifiable statement about that cause
PROPOSE      → a concrete, minimal, reversible change
SANDBOX      → apply in an isolated worktree/database; never the working tree
VERIFY       → run Verify + the full suite against the sandbox result
COMPARE      → against the unchanged baseline; a change that improves nothing is rejected
GOVERN       → Governance OS evaluates the proposal
PROMOTE/REJECT → apply, or record why not
LEARN        → write the outcome back to the ledgers, including rejections
```

The two steps most systems omit are `COMPARE` and the rejection half of `LEARN`. Without COMPARE
there is no evidence a change helped. Without recorded rejections, the same bad idea returns every
quarter looking novel.

## Contracts

```ts
/** A recurring systemic cause. NOT a bug — bugs are instances, weaknesses are what generates them. */
export interface Weakness {
  id: string;
  title: string;
  /** Ledger entry ids that led here. A weakness with one instance is a coincidence. */
  instances: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  category:
    | "FIXTURE_REALISM" // tests pass because the data cannot exhibit the defect
    | "IDENTITY_MODELLING" // a key that cannot bear the weight put on it
    | "SILENT_DEGRADATION" // failure with no signal
    | "PROVIDER_ASSUMPTION" // docs believed over observed behaviour
    | "CONCURRENCY"
    | "PROVENANCE"
    | "GUARDRAIL_COVERAGE"
    | "ENVIRONMENT_DRIFT";
  /** What this predicts will break next. The test of whether the lesson is real. */
  prediction: string;
}

export interface Hypothesis {
  id: string;
  weaknessId: string;
  statement: string;
  /** What observation would DISPROVE it. Required — unfalsifiable entries are rejected at intake. */
  falsifier: string;
}

export interface Proposal {
  id: string;
  hypothesisId: string;
  kind: "ADD_TEST" | "ADD_GUARD" | "FIX_DEFECT" | "REFACTOR" | "DOC_RULE" | "TOOLING";
  /** Minimal and reversible, or it does not qualify as a proposal. */
  change: string;
  expectedEffect: string;
  measurement: string; // how COMPARE will tell whether it worked
  risk: "LOW" | "MEDIUM" | "HIGH";
}

export interface ExperimentResult {
  proposalId: string;
  sandbox: { worktree: string; database: string };
  baseline: { suitePass: number; suiteFail: number; verifyRejected: number };
  candidate: { suitePass: number; suiteFail: number; verifyRejected: number };
  /** Strictly better on the measured axis, no regressions elsewhere. */
  improved: boolean;
  notes: string;
}
```

## Hard constraints

1. **No production mutation, ever.** Experiments run in a git worktree and a disposable database
   whose name satisfies the existing fail-closed guard. The Engine has no path to `market_os_dev`.
2. **Governance decides.** A proposal is an input to `PolicyEvaluation`, never a licence to act.
3. **No model output is evidence.** A model may generate a hypothesis; only reproduction and
   measurement validate one. This is the calibration rule from `docs/LOCAL_AI_CALIBRATION.md`
   applied to the Engine itself.
4. **Rejections are recorded.** With the reason, so the same idea is not re-proposed.
5. **A weakness needs ≥ 2 instances.** One occurrence is an incident. The Engine's value is
   specifically in noticing repetition.

## Weaknesses this project has already demonstrated

Seeded from real history — these are observations, not hypotheses, and they are what the Engine
would have been built to notice:

| Category              | Instances                                                                                                                          | Predicts                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `FIXTURE_REALISM`     | +233% diff; 168 facts discarded on missing `periodStart`; IR-001/002 single-provider fixtures                                      | Any test family whose fixtures contain one of something real-world has many  |
| `IDENTITY_MODELLING`  | padded vs unpadded CIK; `periodStart` absent from fact identity; `corpCode` without `sourceId`; same-millisecond revision ordering | Keys assembled from display values rather than storage values                |
| `SILENT_DEGRADATION`  | EDGAR 1000-cap; FRED/ECOS/DART pagination; `unit === "percent"` case sensitivity; skipped suite reading as green                   | Any code path whose failure mode is returning less, not throwing             |
| `PROVIDER_ASSUMPTION` | `fy: null`; ECOS and DART returning HTTP 200 for auth failure; `filings.files[]` overflow                                          | Every unverified adapter — FRED/ECOS/DART success paths are still unverified |
| `GUARDRAIL_COVERAGE`  | 28 + 21 Ask Market bypasses; English patterns with no Korean mirror                                                                | Any rule expressed in one language, format or word order only                |
| `PROVENANCE`          | IR-001, IR-002, IR-007, IR-008                                                                                                     | Any output assembled from more than one table                                |

The `PROVIDER_ASSUMPTION` row is the actionable one right now: it predicts that FRED, ECOS and
OpenDART will each reveal drift on first real contact, exactly as EDGAR did. That is a concrete,
falsifiable, already-recorded expectation — and the reason `LIVE_KEY_PENDING` must not be quietly
treated as low-risk.

## Shadow mode plan

1. **Ledgers first** (`docs/EVOLUTION_LEDGERS.md`). Without recorded history there is nothing to
   cluster, and the loop degenerates into a model inventing plausible improvements.
2. Backfill from `DECISIONS.md`, `INTERIM_REVIEW_FINDINGS.md`, `REVIEW_DEBT.md` — this project has
   an unusually good written record of its own failures, which is the scarce input.
3. Implement OBSERVE → MEASURE → DETECT only. Emit `Weakness` rows. Stop there.
4. Add HYPOTHESISE → PROPOSE, output to a ledger. Still no execution.
5. Add SANDBOX → VERIFY → COMPARE, worktree-isolated.
6. Governance integration last.

Promotion criterion for step 3: the Engine independently rediscovers the six weaknesses tabled
above from the ledger data, **without** them being hard-coded. If it cannot re-derive known
history, it will not detect anything new — the same positive-control standard applied to the local
models, turned on this layer.
