LAST COMPLETED

**Seventh round — provider capability matrix, 2026-08-18.** v1 frozen throughout; every change is
in the v2 shadow layers. Baseline 538 → **596** tests across 71 files.

## Verified state at handoff

|                                     |                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Branch                              | `claude/market-os-development-7vnicg`                                    |
| Commits ahead of origin             | **127** — all local, nothing rewritten, no force operation               |
| Working tree                        | clean                                                                    |
| Full suite                          | **596 / 596** across 71 files, real PostgreSQL 16.10, disposable test DB |
| E2E                                 | **33 / 33** against a known-fresh production server on a controlled port |
| Live EDGAR contract                 | **67 / 67** against real data.sec.gov                                    |
| Migrations                          | **17**                                                                   |
| Lint / typecheck / prettier / build | clean                                                                    |
| Real dev data                       | **2240 filings, 1431 facts, 33 observations** — intact after the suite   |
| P0 / P1                             | **0 / 0**                                                                |

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
3. **If no key**, continue in shadow. A third Verify adapter is the open item; Ask Market is the
   interesting target because its output is prose rather than a number, and
   `adversarial_resilience` has never been exercised on anything that could genuinely read as
   advice.

## Two operational notes

A `next start` process from an earlier session was still listening on port 3000 and was left alone
rather than killed. It is the SR-02 hazard: an E2E run against it would report on code that does
not exist in the tree. The harness now takes `E2E_BASE_URL`, and this round's run used a
known-fresh server on port 3100.

The full suite takes 95-206s across runs on the same tree. The `~25s` recorded in PROJECT_STATE for
several rounds was stale; the variance is integration files contending for one Postgres.
