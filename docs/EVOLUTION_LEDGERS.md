# Evolution Ledgers

> **Status: DESIGN + SHADOW MODE.** See `docs/EVOLUTION_ENGINE.md`.

The ledgers are the Engine's memory. Without them the loop has nothing to cluster and degenerates
into a model inventing plausible-sounding improvements — which is precisely the failure mode
`docs/LOCAL_AI_CALIBRATION.md` documents.

## Shared shape

Every entry, in every ledger, carries these. Uniform shape is what makes clustering across ledgers
possible.

```ts
export interface LedgerEntryBase {
  id: string; // e.g. "FG-014"
  ledger: LedgerKind;
  recordedAt: string;
  /** Where it came from — a commit, a test run, a review, a live check. */
  origin: string;
  /** Subsystem, so weaknesses can cluster by area as well as by category. */
  subsystem: string;
  severity: "P0" | "P1" | "P2" | "P3";
  summary: string;
  /**
   * The systemic lesson, NOT the fix. This is the field the Engine reads.
   * "Fixed the diff" is worthless here; "fixtures could not express two durations" is the entry.
   */
  lesson: string;
  /** Ids in other ledgers describing the same underlying cause. */
  relatedIds: string[];
}

export type LedgerKind =
  | "INCIDENT"
  | "FALSE_GREEN"
  | "REVIEW_FINDING"
  | "REGRESSION"
  | "PROVIDER_DRIFT"
  | "PREDICTION_ERROR"
  | "USER_CORRECTION"
  | "SECURITY_FINDING"
  | "PERFORMANCE"
  | "COST";
```

The `lesson` field is the point of the whole structure. A ledger of fixes is a changelog; git
already provides one. A ledger of _lessons_ is the only thing that can predict the next defect.

## The ten ledgers

### 1. Incident — something behaved wrongly in a running system

Reserved for real runtime misbehaviour, not test failures. Currently empty: nothing is deployed.

### 2. False Green — tests passed while reality was wrong

The most valuable ledger in this project, because every entry represents a defect the test suite
was structurally incapable of catching.

```ts
interface FalseGreenEntry extends LedgerEntryBase {
  whatThePassingTestAsserted: string;
  whyRealityDiffered: string;
  /** Precisely what the fixtures could not express. This is the reusable part. */
  fixtureGap: string;
  detectionMethod: "REAL_DATA" | "REAL_BROWSER" | "REAL_DB" | "CONCURRENCY" | "MANUAL_INSPECTION";
}
```

Backfill (abbreviated — full detail in `DECISIONS.md` and `INTERIM_REVIEW_FINDINGS.md`):

| id    | Summary                                    | Fixture gap                                                |
| ----- | ------------------------------------------ | ---------------------------------------------------------- |
| FG-01 | +232.9985% Apple revenue increase          | No fixture had two durations sharing one `periodEnd`       |
| FG-02 | EDGAR stored 45% of filing history         | No fixture exceeded the provider's 1000-row cap            |
| FG-03 | 168 facts silently discarded per ingest    | No fixture had two facts differing only by `periodStart`   |
| FG-04 | Zero joinable rows between filings & facts | Fixtures used one CIK representation throughout            |
| FG-05 | IR-001/002 cross-provider pooling          | Every fixture had exactly one source                       |
| FG-06 | IR-007/008 figures with no provenance      | No test asserted that displayed output carries attribution |

FG-05 and FG-06 share FG-01's shape exactly: **fixtures contained one of something the real world
has many of.** Four occurrences of one pattern across six entries — that is a `Weakness`, and it
is the strongest evidence in the repo that this architecture is worth building.

### 3. Review Finding

Findings from any review, with disposition. Must record **rejected** findings too — the rejections
are what calibrate a reviewer. `docs/INTERIM_REVIEW_FINDINGS.md` is already this ledger in prose,
including the four rejected local-AI findings.

```ts
interface ReviewFindingEntry extends LedgerEntryBase {
  reviewer: string; // "Claude" | "codex:gpt-5.6-terra" | "ollama:qwen3.5:4b"
  reproduced: boolean;
  disposition: "VALID_FIXED" | "VALID_DEFERRED" | "REJECTED" | "NOT_APPLICABLE";
  /** Why rejected — feeds reviewer calibration. */
  rejectionReason?: string;
}
```

### 4. Regression — something previously fixed that broke again

Empty so far. A populated entry here is the strongest possible signal that a fix addressed a symptom
rather than a cause.

Near-miss worth noting: the "target price"/"price target" word-order fix was applied in English and
**not** mirrored in Korean, so `목표가` was caught while `가격 목표` stayed open. Not a regression —
the original fix never regressed — but the same hole reopened in another alphabet. Recorded as a
`GUARDRAIL_COVERAGE` weakness.

### 5. Provider Drift — a source changed shape or behaviour

```ts
interface ProviderDriftEntry extends LedgerEntryBase {
  sourceCode: string;
  endpoint: string;
  drift: DriftReport; // from the Reality Fabric
  breakingChange: boolean;
  detectedBy: "LIVE_CONTRACT_CHECK" | "INGEST_FAILURE" | "MANUAL";
}
```

Backfill: `fy: null` / `fp: null` on companyfacts; `filings.recent` capped with overflow in
`filings.files[]`; ASC 606 revenue tag transition; ECOS and DART returning **HTTP 200** for
authentication failure.

That last one generalises past its own provider: `response.ok` is not a success check. Any adapter
added later inherits the lesson only if it is written down as a lesson rather than as a bug fix.

### 6. Prediction Error

Where the system stated an expectation and reality later differed — projected release dates from
`economicCalendar.ts` versus actual publication, and staleness projections versus actual cadence.
Requires production traffic; empty until then.

### 7. User Correction

A user telling the system it is wrong. The highest-signal, lowest-volume ledger. Empty pre-release.

### 8. Security Finding

```ts
interface SecurityFindingEntry extends LedgerEntryBase {
  category: "AUTHZ" | "AUTHN" | "SECRET_LEAK" | "INJECTION" | "DOS" | "GUARDRAIL_BYPASS";
  /** Whether the actual request path was exercised, or only a helper. */
  requestPathExercised: boolean;
  attackVector: string;
}
```

`requestPathExercised` is deliberate. The Watchlist finding was exactly this: the domain module had
zero callers, so cross-user isolation had never been tested through a real request. A helper-level
pass is not evidence the product is safe.

Backfill: 49 Ask Market guardrail bypasses across three passes; unused exported server action (a
`"use server"` export is reachable whether or not a page calls it); unbounded per-user row count;
P2002 surfaced raw under concurrent submission; Prisma code frames persisted into `ingest_runs.error`
and rendered on `/admin`.

### 9. Performance

Records measurements **and deliberate decisions not to optimise**, with the reasoning — so a future
session does not "fix" a non-problem.

Current entries: full re-ingest of ~2,240 rows ≈ 2.7s; regime computation over ~16,000 observations
≈ 100ms. Both measured, both judged not bottlenecks, both deliberately left alone.

Also: morning-brief exceeded vitest's 5s default timeout while a 2.9 GB local model was resident on
a 16 GB machine. Environmental, not a product defect — recorded so it is not chased again.

### 10. Cost

Tracks that zero-additional-cost holds. Entries are refusals as much as expenditures: Codex usage
exhausted and **not** purchased; local inference used instead; no paid data provider enabled. The
running total should stay at zero, and the ledger is how that is demonstrable rather than asserted.

## Clustering

The Engine reads across all ten and groups by `lesson` similarity, `subsystem`, and category. A
cluster with ≥ 2 instances becomes a `Weakness`.

Clusters already visible in the backfill:

| Cluster                                               | Ledgers spanned             | Instances |
| ----------------------------------------------------- | --------------------------- | --------- |
| Fixtures contain one of something real-world has many | False Green                 | 4         |
| Identity keys that cannot bear their weight           | False Green, Review Finding | 4         |
| Failure by returning less, without a signal           | False Green, Provider Drift | 4         |
| A rule expressed in only one language or order        | Security Finding            | 3         |
| Documentation believed over observed behaviour        | Provider Drift              | 4         |

Five clusters, every one derived from history already written down. That is the argument for
building the ledgers before anything else in the Engine: **the data to make it useful already
exists in this repository**, scattered across prose. The work is structuring it, not generating it.

## Storage

Markdown first, in `docs/`, appended by hand as findings occur. It works today, it is reviewable in
diffs, and it needs no migration during a release freeze.

Promotion to tables happens only when the Engine actually queries them — and not before, because a
schema written ahead of its first real query is a guess.
