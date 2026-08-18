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

Clusters the detector reports over the current backfill, worst severity first within each count:

| Category               | Instances | Worst | The recurring cause                                          |
| ---------------------- | --------- | ----- | ------------------------------------------------------------ |
| `IDENTITY_MODELLING`   | 11        | P0    | A key asked to carry more than it can                        |
| `GUARDRAIL_COVERAGE`   | 9         | P1    | A rule expressed in one language, order or path only         |
| `FIXTURE_REALISM`      | 5         | P0    | Fixtures hold one of something the world has many of         |
| `PROVIDER_ASSUMPTION`  | 5         | P1    | A documented shape believed over an observed response        |
| `CONCURRENCY`          | 5         | P1    | A read-then-write sequence treated as atomic                 |
| `SILENT_DEGRADATION`   | 5         | P1    | Failure by returning less, with no signal                    |
| `PROVENANCE`           | 3         | P1    | A value shown without what it came from                      |
| `ENVIRONMENT_DRIFT`    | 3         | P2    | A check made on surface text rather than what it resolves to |
| `SEMANTIC_RECENCY`     | 2         | P1    | Freshness inferred from when it was observed, not what       |
| `EVIDENCE_FABRICATION` | 2         | P2    | A confident claim taken for a verified one                   |

Every one is derived from history already written down. That is the argument for building the
ledgers before anything else in the Engine: **the data to make it useful already exists in this
repository**, scattered across prose. The work is structuring it, not generating it.

The last two were added while designing the provider-vintage contract, and they are the clearest
demonstration that the clustering earns its keep. `SEMANTIC_RECENCY` joins IR-021 (a replayed stale
value became current because it arrived last) to an incident nobody had connected to it: an E2E
pass reported from a dev server started before the fix under test. Different subsystems, no shared
code, one cause — a clock standing in for provenance. `EVIDENCE_FABRICATION` joins a Codex reviewer
quoting a reproduction it never ran to four local-model findings that survived nothing. Both were
recorded as one-off embarrassments at the time; only the ledger makes them a pattern.

**Two entries added 2026-08-18 from the shadow-layer review**, both in existing clusters rather
than new ones — which is the detector working as intended:

- `RF-04` (IDENTITY_MODELLING) — the same release-date promotion written independently at two call
  sites, and wrong at both. The lesson is not "check release dates"; it is that a rule duplicated
  across two readers will be wrong in both places at once, and the fix is one shared function
  rather than two corrected copies.
- `GC-01` (GUARDRAIL_COVERAGE) — an audit record that refused to log a DENIED action as EXECUTED
  but accepted a conditionally-permitted one with the condition unmentioned. A guard written for
  the obvious violation, with the adjacent one left open.

**Eight entries added 2026-08-18 after a ledger-completeness audit (`gpt-5.6-luna`).** Luna
checked all 28 existing entries against `INTERIM_REVIEW_FINDINGS.md` and `DECISIONS.md`, found
**zero fabrications**, and found eight documented defects with no entry (`VF-01`..`VF-08`).

Every one of the eight is a defect in **Verify itself**, found while building the layer whose job
is finding defects — an empty CALCULATION verifying clean, a contract with no entity identifier, a
tolerance that vanished where the value was smallest. They were left out because they felt like
construction noise rather than history. They are the ledger's most direct evidence that a verifier
is not exempt from the failure modes it verifies against, and leaving them out was under-counting
`IDENTITY_MODELLING` by four.

The audit is also why the ledger's own completeness is worth checking periodically: a ledger with
gaps under-reports exactly the clusters it exists to find, and nothing in the detector can notice
an entry that was never written.

## Storage

Markdown first, in `docs/`, appended by hand as findings occur. It works today, it is reviewable in
diffs, and it needs no migration during a release freeze.

Promotion to tables happens only when the Engine actually queries them — and not before, because a
schema written ahead of its first real query is a guess.
