LAST COMPLETED

**Seventh round — provider capability matrix and its independent review, 2026-08-18.** v1 frozen
throughout; every change is in the v2 shadow layers. Baseline 538 → **616** tests across 73 files.

## Verified state at handoff

|                                     |                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Branch                              | `claude/market-os-development-7vnicg`                                       |
| Commits ahead of origin             | every commit after `6cb74fc` — ~128, nothing rewritten, no force            |
| Working tree                        | clean                                                                       |
| Full suite                          | **1031 / 1031** across 101 files, real PostgreSQL 16.10, disposable test DB |
| E2E                                 | **33 / 33** against a known-fresh production server on a controlled port    |
| Live EDGAR contract                 | **67 / 67** against real data.sec.gov                                       |
| Migrations                          | **17**                                                                      |
| Lint / typecheck / prettier / build | clean                                                                       |
| Real dev data                       | **2240 filings, 1431 facts, 33 observations** — intact after the suite      |
| P0 / P1                             | **0 / 0**                                                                   |

## Stop sentinel — evaluated, not asserted (2026-08-19)

```
mayStop: true
  ok  no startable task — 0 startable, 5 deferred
  ok  no unresolved failing check — 0
  ok  no blocker advanceable by code, tests, docs or analysis — 0
  ok  no review finding left unhandled — 0
  ok  open escalations do not block — 1 open; independent work continues
```

**This means nothing is startable here, not that Market OS is finished.** All five remaining items
are gated on provider credentials (HG-002/003/004), and the sentinel reports them by name rather
than dropping them.

The queue converged for the first time this session. Worth knowing for the next one: after it
converged, the protocol's second-order checklist still produced IR-040 — Verify claiming "no
shortfall was detected" for completeness statuses where nothing had looked. A converged queue is a
statement about the queue.

Second-order checklist coverage this session: identity, ordering, completeness, guardrail concepts,
provenance, concurrency, environment modes, test realism, and — as of the following phase —
financial semantics.

**Financial semantics: audited, no defect.** `tests/financialSemanticCompatibility.test.ts` records
it. Comparisons run on real dates and durations and never on `fiscalYear`/`fiscalPeriod`, which
matters because SEC returns those null and Apple's fiscal Q3 ends on a calendar Q2 date; where a
fiscal label is displayed, the actual period is rendered beneath it. Cross-currency is safe by
construction rather than by assertion — `computeFinancialFactDiff` takes `unit` as a query
parameter, so two currencies never enter the same comparison — and that construction is now pinned,
because a protection made of query shape disappears in a refactor without anything going red.

No `currency_compatibility` dimension was added: no output path compares across currencies, so one
would be architecture symmetry rather than a response to evidence.

## What this round did

Three commits, continuing directly from the provider-vintage contract.

**1. The vintage contract itself** — `src/server/fabric/vintage.ts`. The concept IR-021 forced into
existence. `providerVintageAt` / `sourceReleasedAt` / `providerRevisionId`, each with an
availability state, and `compareVintage` ordering by vintage, then release, then stopping at
`UNRESOLVED`. **`retrievedAt` is deliberately not a rung**, with a negative control test that fails
if it becomes one. Propagated to Fabric, Verify (`revision_integrity`,
`SEMANTIC_REVISION_UNRESOLVED`), Evolution (`SEMANTIC_RECENCY`, `EVIDENCE_FABRICATION`) and
Governance (`BLOCKED_PROVIDER_KEY`, `BLOCKED_USAGE_LIMIT`).

**2. A second Verify adapter** — Morning Brief's "What Changed". Until it existed every dimension
had been exercised by one output shape, which is the fixture-realism failure aimed at the verifier
itself. It immediately found `semantic_consistency` narrating "equal null-month spans" for two
instants, and it produces verdicts the SEC path structurally cannot.

**3. The provider capability matrix** — `src/server/fabric/providerCapability.ts`. 13 axes × 4
providers, every cell carrying its evidence and provenance. `SUPPORTED` and `NOT_SUPPORTED` both
require `LIVE_RESPONSE`; every `NOT_VERIFIED` names its gate. Verify classifies evidence gaps
against it, Governance reads reality state, Evolution generates proposals from it.

## Independent review

Codex became available mid-session. Two reviews were run and routed per the standing rules.

**`gpt-5.6-terra`** — cross-file review of the shadow layers over `b6eb8fd..HEAD`. Five findings,
**all five reproduced and all five valid** (IR-022..IR-026). A sharp contrast with the previous two
rounds, and it did not make the reproduction step optional — running them is what established these
were real and what rejected the others.

**`gpt-5.6-luna`** — bounded fidelity audit of Governance and the Evolution ledger. One rule
looser than its citation (IR-029, `PURCHASE_AI_CREDITS` now DENIED); 28 ledger entries checked with
zero fabrications and eight documented defects missing, now added as `VF-01`..`VF-08`.

**Sol remains unspent**, reserved for the final Release Candidate adversarial pass and for any v1
P0/P1.

Two findings came from probing rather than from a model. **IR-027**: the ECOS shadow disagreement
led to a revision whose `retrievedAt` precedes its own parent's — v1 handles it, the fixtures did
not cover it, now they do. **IR-028**: Ask Market returns NOT_FOUND for `Apple revenue`. P2, not
fixed under the freeze, flagged as a release-critical candidate.

## Shadow run against the real database

```
VERIFIED_WITH_LIMITATION       8    SEC filing diffs, gap CONDITIONAL_ABSENCE
SEMANTIC_REVISION_UNRESOLVED   3    macro readings, gap VERIFICATION_DEBT (FRED/ECOS) or CAPABILITY_UNKNOWN
STALE                          3    macro readings past their own cadence
```

Fabric projection reports 8 disagreements, including `REVISED_WITHOUT_VINTAGE` for
`ECOS:722Y001:0101000` — a real series that has been revised with no provider evidence of which
version won.

## External gates, all still open

| Gate                        | State                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `PUSH_PENDING_AUTH`         | HG-001. `git push` hangs on a credential prompt that cannot be shown.     |
| `FRED_LIVE_KEY_PENDING`     | HG-002. Blocks 13 capability axes and the vintage question for macro.     |
| `ECOS_LIVE_KEY_PENDING`     | HG-003.                                                                   |
| `OPENDART_LIVE_KEY_PENDING` | HG-004.                                                                   |
| HG-009                      | Login-lockout threat model. Fully documented; recommended default stated. |
| Independent review          | HG-005, included usage resets 2026-08-22.                                 |

None was faked closed. None blocked other work.

## Next exact action

1. **If a FRED key has arrived**, this is the highest-value work available and closes two things at
   once. Live-verify with `scripts/verify-fred-live.ts`, then read what `realtime_start` /
   `realtime_end` actually contain. Promote the capability cells only on the strength of the
   response — never on the strength of the harness having run.
2. **If ECOS or OpenDART**, same procedure. Expect drift: EDGAR's live check found four real
   divergences on its first run, and these three adapters were written the same way.
3. **If no key**, continue in shadow. The three real output shapes now all have adapters. The
   open items, in rough order of value:
   - **Macro Regime axes** are the one remaining v1 output with no Verify adapter. Five of them
     currently report `NOT_TRACKED` because they need FRED, so this is partly gated — but the two
     that are tracked would exercise `cross_source_consistency` on something other than a single
     source, which nothing has done yet.
   - **IR-028** (Ask Market name matching) is written up with a full reproduction matrix and is
     waiting on a release-critical decision, not on engineering.
   - **All four v1 output shapes now have Verify adapters.** What remains on this layer is gated:
     `cross_source_consistency` cannot be exercised on REAL data until a second provider supplies a
     series for one axis, which needs FRED (HG-002). The branch is tested on a fixture shaped like
     what RATES becomes once a key exists.

## Two operational notes

A `next start` process from an earlier session was still listening on port 3000 and was left alone
rather than killed. It is the SR-02 hazard: an E2E run against it would report on code that does
not exist in the tree. The harness now takes `E2E_BASE_URL`, and this round's run used a
known-fresh server on port 3100.

The full suite takes 95-206s across runs on the same tree. The `~25s` recorded in PROJECT_STATE for
several rounds was stale; the variance is integration files contending for one Postgres.

## The flake, identified and fixed (IR-039)

Resolved on 2026-08-19 by capturing full output on a failing run instead of rerunning green ones.
Eight reruns were never going to find it: the run that failed had its output piped through `tail`,
so only the summary survived.

`tests/integration/watchlist-actions.test.ts` — `beforeAll` exceeds vitest's default 10s hook
timeout under database contention, leaving `userAId` and `userBId` unset, and `afterAll` then calls
`user.delete({ where: { id: undefined } })` and throws. **The teardown's error is the one that gets
reported**, which is exactly why three write-ups could not name the test.

Fixed: the teardown skips unassigned ids, the hook gets 60s. Deliberately NOT `deleteMany`, which
reads `undefined` as "no condition" and would delete every user.

The exposure is not unique to that file — around twenty integration files delete by an id a failed
setup would leave undefined. Recorded as `EN-04`.
