# Meta Architecture v2

> **Status: DESIGN + SHADOW MODE. Market OS v1 is in release-hardening freeze.**
> Nothing in this document or its companions changes v1 behaviour. Every layer described here
> starts in shadow mode — computing, logging and comparing, never blocking or mutating. Promotion
> out of shadow mode requires evidence, recorded in `docs/EVOLUTION_LEDGERS.md`.

## What this is for

Market OS v1 produces intelligence. It does that well enough to be near a release candidate. What
it does not yet do is answer four questions about itself:

| Question                                                | Layer                       |
| ------------------------------------------------------- | --------------------------- |
| Is the data underneath this still connected to reality? | World / Reality Data Fabric |
| Is this particular output actually supportable?         | Verify                      |
| Is this action allowed, and by what rule?               | Governance OS               |
| What did we learn from the last thing that broke?       | Evolution Engine            |

These are not new features. Each one already exists in v1 as scattered, partial, hand-rolled
implementations — and the scattering is the problem. Three separate places decide what "stale"
means. Completeness is a note on one page. The rules that gate an action live in prose across five
markdown files. This architecture names the contracts so those implementations converge instead of
diverging further.

## The single most important constraint

**v1 keeps working exactly as it does today.** The layers below are additive and observational.
A reader of `/today` or `/ask` must see no difference until a promotion decision is made
deliberately, with evidence.

This is not caution for its own sake. The defects this project keeps finding —
`docs/INTERIM_REVIEW_FINDINGS.md`, `docs/DECISIONS.md` — are overwhelmingly of one kind: _code that
was correct under the conditions it was written for, and quietly wrong under conditions that
arrived later_. A meta-architecture rewrite during release hardening is precisely how that class
gets manufactured at scale.

## How the layers relate

```
                    ┌──────────────────────────────────────┐
                    │            REAL WORLD                │
                    │  filings · releases · prints · rates │
                    └──────────────────┬───────────────────┘
                                       │  adapters (v1, reused as-is)
                    ┌──────────────────▼───────────────────┐
                    │   WORLD / REALITY DATA FABRIC        │
                    │   what we have · how fresh · how     │
                    │   complete · which provider · drift  │
                    └──────────────────┬───────────────────┘
                                       │  evidence
                    ┌──────────────────▼───────────────────┐
                    │           MARKET OS v1               │
                    │   Ask Market · X-Ray · Filing Diff   │
                    │   Morning Brief · Macro Regime       │
                    └──────────────────┬───────────────────┘
                                       │  outputs + their evidence
                    ┌──────────────────▼───────────────────┐
                    │              VERIFY                  │
                    │   nine dimensions → one verdict      │
                    └──────────────────┬───────────────────┘
                                       │  verdicts, failures, near-misses
                    ┌──────────────────▼───────────────────┐
                    │         EVOLUTION ENGINE             │
                    │   observe → hypothesise → sandbox    │
                    │   → verify → compare → propose       │
                    └──────────────────┬───────────────────┘
                                       │  proposals
                    ┌──────────────────▼───────────────────┐
                    │           GOVERNANCE OS              │
                    │   AUTO_ALLOWED · …_WITH_VERIFY ·     │
                    │   DEFERRED_HUMAN_GATE · DENIED       │
                    └──────────────────┬───────────────────┘
                                       │  only what is permitted
                                       └──────────► back into Market OS
```

Governance sits **last** on purpose. It is the only layer that can authorise a change, and it can
authorise nothing that Verify has not evaluated. Evolution proposes; it never promotes.

## Reading order

1. `docs/WORLD_DATA_FABRIC.md` — the evidence substrate everything else consumes
2. `docs/VERIFY_ARCHITECTURE.md` — turning evidence into a verdict
3. `docs/GOVERNANCE_OS.md` — turning existing prose rules into executable decisions
4. `docs/EVOLUTION_ENGINE.md` — the improvement loop
5. `docs/EVOLUTION_LEDGERS.md` — the memory the loop learns from

## What v1 already provides

The most important finding from designing this: **most of the Reality Fabric already exists.** It
is not centralised and not named, but the hard parts — the parts that require having thought about
real provider behaviour — are built and tested.

| v2 concept                | Already in v1 as                                                                |
| ------------------------- | ------------------------------------------------------------------------------- |
| Source registry           | `Source` model — `code`, `name`, `tier` (`SourceTier` S/A/B/C/D), `homepage`    |
| Retrieval timestamp       | `Observation.retrievedAt`, `Filing.retrievedAt`, `FinancialFact.retrievedAt`    |
| Release timestamp         | `Observation.releaseDate`                                                       |
| Observation timestamp     | `Observation.observationDate` — deliberately distinct from the two above        |
| Revisions                 | `Observation.isRevision` / `revisionOf` chain + `findRevisionChainTail`         |
| Preliminary data          | `Observation.isPreliminary`                                                     |
| Completeness              | `IngestRun.providerTotal` vs `fetched`, `truncated`, `IngestRunStatus.PARTIAL`  |
| Freshness                 | `staleness.ts` → `FRESH` / `STALE` / `UNKNOWN`, cadence from `economicCalendar` |
| Conflicts                 | `DataConflict` — `conflictingWith`, `officialSource`, `resolved`                |
| Source health             | `systemHealth.ts`                                                               |
| Provenance                | `Claim` ledger — `FACT` / `CALCULATION` / `INFERENCE`, `evidence`, `sourceUrl`  |
| Rate limits               | `httpTimeout.ts`, per-adapter paging caps (`MAX_FRED_PAGES`)                    |
| Schema drift              | `verify-edgar-live.ts` contract checks; `assertParallelArraysAligned`           |
| Canonical entity identity | padded CIK canonicalisation + the `(sourceId, corpCode)` scoping of IR-001/002  |

**So the Fabric's first job is not to build. It is to expose what exists behind one contract and
find where the existing implementations disagree.** Those disagreements are defects in v1, and
finding them is the shadow mode payoff.

## Shadow mode, concretely

Shadow mode is not "we wrote it but didn't call it". It means the layer runs on real data, records
what it would have said, and is compared against what v1 actually did.

| Layer          | Shadow behaviour                                                      | Promotion evidence required                                                            |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Reality Fabric | Computes freshness/completeness/health beside existing per-page logic | Its answer matches the existing ad-hoc answer, or the difference is a proven v1 defect |
| Verify         | Produces verdicts; nothing is withheld from users on its say-so       | No `REJECTED` verdict on an output later confirmed correct, over a real sample         |
| Governance     | Logs the decision it would have made for every gated action           | Its decisions match the human calls made in `HUMAN_GATE_QUEUE.md`                      |
| Evolution      | Emits proposals into a ledger                                         | A proposal, once applied by hand, measurably improved something                        |

A layer that cannot state its promotion criterion does not get promoted.

## Explicit non-goals

- **No AI confidence percentages.** `Claim.confidence` exists for INFERENCE claims and is
  evidence-derived. Verify emits dimension verdicts, never a fabricated 0–100 score. A number that
  cannot be recomputed from evidence is decoration.
- **No microservices.** Modular monolith, per `CLAUDE.md`.
- **No new paid dependency.** Zero-additional-cost is absolute; a layer that needs a paid service
  to function is out of scope by construction.
- **No rewrite of working adapters.** FRED, ECOS, DART and EDGAR clients are the most heavily
  hardened code in the repo. The Fabric wraps them; it does not replace them.
- **No LLM in the critical path.** v1's Ask Market is deterministic and that is a safety property
  (see `tests/askMarketAdversarial.test.ts` on why injection is currently inapplicable). Verify
  and Evolution may use models for _hypothesis generation_, never for verdicts — the local-model
  calibration in `docs/LOCAL_AI_CALIBRATION.md` is the standing evidence for that rule.

## Implementation order and current position

1. **Reality Fabric contract** — types + shadow adapters over existing v1 data. ← contract drafted
2. **Verify** — evidence model + dimension evaluators. ← contract drafted
3. **Governance OS** — policy table derived from existing docs. ← contract drafted
4. **Evolution Engine** — ledgers first, loop second. ← contract drafted

No implementation has been written. That is deliberate: v1 is frozen, and the contracts are what a
reviewer can usefully argue with before any code exists to defend.
