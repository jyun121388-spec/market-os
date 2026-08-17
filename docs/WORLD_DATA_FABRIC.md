# World / Reality Data Fabric

> **Status: DESIGN + SHADOW MODE.** No v1 behaviour changes. See `docs/META_ARCHITECTURE_V2.md`.

The Fabric is the layer that knows **what we have, where it came from, how fresh it is, and how
much of it is missing** — so that anything built on top can be honest about its own foundations.

## The premise

Market OS must be _reality-aware_, not _continuously polling_. Those are different properties and
the difference is the whole design:

- Polling everything constantly is expensive, rude to free providers, and still does not tell you
  whether the data is complete.
- Reality-awareness means every dataset carries a defensible answer to "is this current, and is
  this all of it?" — computed from the provider's own cadence and the provider's own totals,
  not from a fixed refresh interval.

A monthly CPI print does not become stale an hour after release. A daily rate that has not moved in
four business days probably has. The Fabric derives that per series from observed cadence, which
`economicCalendar.ts` already does.

## What already exists (reuse, do not rebuild)

This is the part worth stating plainly: **v1 already implements most of this.** The Fabric's first
deliverable is a contract over existing data, not new ingestion.

| Fabric concern        | v1 implementation                                                                       |
| --------------------- | --------------------------------------------------------------------------------------- |
| Source registry       | `Source` (`code`, `name`, `tier`, `homepage`)                                           |
| Trust tiering         | `SourceTier` — `TIER_S`…`TIER_D`, already used by event clustering                      |
| Three timestamps      | `Observation.observationDate` / `releaseDate` / `retrievedAt`                           |
| Revisions             | `isRevision`, `revisionOf`, `findRevisionChainTail` (structural, not timestamp-ordered) |
| Preliminary data      | `Observation.isPreliminary`                                                             |
| Ingestion state       | `IngestRun` — `status`, `inserted/revised/unchanged/skipped`, `requestsMade`            |
| Completeness          | `IngestRun.providerTotal` vs `fetched`, `truncated`, `IngestRunStatus.PARTIAL`          |
| Freshness             | `staleness.ts` (`FRESH`/`STALE`/`UNKNOWN`) + cadence from `economicCalendar.ts`         |
| Conflicts             | `DataConflict` (`conflictingWith`, `officialSource`, `resolved`)                        |
| Health                | `systemHealth.ts`                                                                       |
| Truncation disclosure | `CompletenessNote` on `/company/[corpCode]`                                             |
| Canonical identity    | padded-CIK canonicalisation; `(sourceId, corpCode)` scoping from IR-001/002             |

**What is missing is not capability. It is a single vocabulary.** Today "stale" is decided in
`staleness.ts`, "incomplete" in `companyXray.ts`, and "unhealthy" in `systemHealth.ts`, with no
shared type and no guarantee they agree. Shadow mode's first job is to run all three behind one
contract and report where they disagree — each disagreement is a v1 defect.

## Core contract

```ts
/** Why a dataset is in the state it is in. Never a bare boolean — the reason is the product. */
export type FabricState =
  | "FRESH" // within the source's own observed cadence
  | "STALE" // past its cadence; the source has not published when it usually would
  | "DELAYED" // a scheduled release is known to be late (calendar says due, nothing arrived)
  | "TRUNCATED" // we hold provably less than the provider says exists
  | "CONFLICTED" // two sources disagree beyond tolerance for the same fact
  | "UNAVAILABLE" // the provider could not be reached on the last attempt
  | "UNKNOWN"; // not enough history or metadata to judge — NEVER defaults to FRESH

/**
 * The three times that must never be collapsed into one.
 *
 * Conflating them is a documented source of financial error: a value ABOUT June, PUBLISHED in
 * July, RETRIEVED in August is three different dates, and "latest" means something different
 * under each. v1 already separates them on Observation; this makes the separation a Fabric-wide
 * rule rather than one model's good habit.
 */
export interface TemporalStamp {
  observedAt: string; // the period/date the value DESCRIBES (YYYY-MM-DD)
  releasedAt: string | null; // when the provider published it, if the provider says
  retrievedAt: string; // when we fetched it — always known, never a substitute for the others
}

/** What we can prove about how much of a dataset we hold. */
export interface CompletenessEvidence {
  /** What the provider itself claims exists, when it says so at all. */
  providerTotal: number | null;
  /** What we actually hold. */
  held: number;
  /**
   * Provider said more exists than we retrieved. Distinct from `held < providerTotal`, because a
   * provider that reports no total can still signal truncation via a continuation token or a
   * page cap we hit.
   */
  truncated: boolean;
  /** Why, in words a non-engineer can act on. */
  detail: string;
}

export interface FreshnessPolicy {
  /** Observed, not configured: the median gap between real observations for this dataset. */
  medianIntervalDays: number | null;
  /** Multiple of the median beyond which the dataset is STALE. */
  staleMultiplier: number;
  /**
   * Deliberately absent: a global refresh interval. Reality-awareness is derived per dataset
   * from its own cadence — a monthly print and an intraday rate cannot share a threshold.
   */
}

export interface SourceHealth {
  sourceCode: string;
  tier: "TIER_S" | "TIER_A" | "TIER_B" | "TIER_C" | "TIER_D";
  lastSuccessfulRunAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  /** Rate-limit posture, so a caller can decide not to ask rather than being refused. */
  rateLimit: { requestsMade: number; windowSeconds: number; limit: number | null };
  state: FabricState;
}

/** Licensing is a first-class field because it constrains what may be displayed or redistributed. */
export interface SourceLicence {
  sourceCode: string;
  /** e.g. "US Government Work", "KOGL Type 1", "provider ToS — attribution required". */
  licence: string;
  attributionRequired: boolean;
  redistributionAllowed: boolean;
  /** Free-tier request ceiling, where the provider states one. */
  documentedRateLimit: string | null;
  notes: string;
}

/**
 * A dataset's full reality posture — what Verify consumes and what a UI can disclose.
 */
export interface FabricStatus {
  datasetKey: string; // e.g. "FRED:DGS10" or "SEC_EDGAR:0000320193:xbrl"
  sourceCode: string;
  state: FabricState;
  temporal: TemporalStamp | null;
  completeness: CompletenessEvidence;
  freshness: FreshnessPolicy;
  conflicts: number; // unresolved DataConflict rows touching this dataset
  schemaDriftDetected: boolean;
  /** Human-readable justification. A state with no reason is not reportable. */
  reason: string;
}
```

## Canonical entity identity

The IR-001 / IR-002 / IR-007 / IR-008 findings are all one thing: **a business identifier means
nothing without its provider.** The Fabric makes that a type rather than a convention.

```ts
/**
 * An entity as one provider identifies it. There is deliberately no global company id.
 *
 * SEC uses a 10-digit zero-padded CIK; DART uses an 8-digit corp code; both are numeric strings
 * living in the same `corpCode` column. `financial_facts` already declares this — both unique
 * indexes begin with sourceId — but four separate read paths ignored it and had to be fixed.
 */
export interface ProviderEntityRef {
  sourceCode: string;
  /** The provider's own identifier, in the provider's own representation. */
  externalId: string;
  /** Canonicalised form, where the provider's own representation is ambiguous (e.g. CIK padding). */
  canonicalId: string;
}

/**
 * A claim that two provider refs are the same real-world entity. NOT an assertion of truth:
 * it carries its own evidence and can be wrong, which is why it is a row and not a join key.
 */
export interface EntityLink {
  refs: ProviderEntityRef[];
  basis: "TICKER_MATCH" | "LEI" | "MANUAL" | "NAME_MATCH";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Name matching is the weakest basis and must never silently merge financial figures. */
  verifiedAt: string | null;
}
```

**Rule this encodes:** cross-provider merging requires an explicit `EntityLink`, and a merged view
must disclose that it is merged. Silent pooling is what IR-002 did.

## Schema drift

EDGAR taught this one at cost: the provider's documentation is not the provider. Real
`companyfacts` rows arrive with `fy: null, fp: null` against non-nullable columns; `filings.recent`
silently caps at 1000 with the remainder in `filings.files[]`.

```ts
export interface DriftReport {
  sourceCode: string;
  endpoint: string;
  detectedAt: string;
  kind: "NEW_FIELD" | "REMOVED_FIELD" | "TYPE_CHANGED" | "NULLABILITY_CHANGED" | "SHAPE_CHANGED";
  path: string; // e.g. "facts.us-gaap.Revenues.units.USD[].fy"
  expected: string;
  observed: string;
  /** Whether the current parser would have mis-handled it. Drives severity. */
  breaksCurrentParser: boolean;
}
```

Shadow implementation reuses `scripts/verify-*-live.ts`, which already perform exactly these
contract assertions — the Fabric turns their output into rows instead of console lines.

## Reality-awareness scheduling

Polling policy derives from the data, not from a config constant:

| Situation                                    | Behaviour                                                     |
| -------------------------------------------- | ------------------------------------------------------------- |
| Within observed cadence                      | Do not poll. Report `FRESH`.                                  |
| Past cadence × staleMultiplier               | Poll. Report `STALE` until it returns.                        |
| Calendar says a release is due and none seen | Poll at a bounded interval. Report `DELAYED`.                 |
| Last run `FAILED`                            | Exponential backoff. Report `UNAVAILABLE`, never `FRESH`.     |
| Last run `PARTIAL`                           | Re-attempt the missing range specifically, not the whole set. |
| Cadence unknown (< 3 observations)           | Report `UNKNOWN`. Do not guess a schedule.                    |

`UNKNOWN` never degrades to `FRESH`. Absence of evidence is not evidence of currency — the same
rule `assessCompleteness` already applies for companies with no recorded ingest run.

## Shadow mode plan

1. Implement `FabricStatus` as a **read-only projection** over existing tables. No migrations, no
   writes, no new ingestion.
2. Compute it alongside the three existing ad-hoc implementations.
3. Log disagreements. **Each disagreement is a v1 defect hypothesis** and goes through the
   standard pipeline: reproduce → failing test → minimal fix.
4. Promote only when the projection agrees with the existing logic everywhere it should, and every
   difference has been resolved as a proven defect on one side or the other.

Expected first disagreements, worth looking for specifically:

- `staleness.ts` reports `UNKNOWN` for series with sparse history, while `systemHealth` may treat
  the same series as healthy on `retrievedAt` alone — one measures the data, the other the fetch.
- `assessCompleteness` reports per company; `IngestRun.truncated` is per run. A company whose last
  run succeeded after an earlier truncated run may read `COMPLETE` while holding a partial history.

Neither is confirmed. Both are exactly the kind of claim that must be reproduced before it is
called a defect.
