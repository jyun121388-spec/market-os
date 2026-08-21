# Review attestation — candidate `c03aa73`

Machine-readable form: [`REVIEW_ATTESTATION.json`](./REVIEW_ATTESTATION.json). That file is what
the release gate parses; this one is for a person deciding whether to believe it.

|                             |                                                                         |
| --------------------------- | ----------------------------------------------------------------------- |
| Reviewed code SHA           | `c03aa73e2ced798dd65a17c013c4a11051a74b4c`                              |
| Verdict                     | `CLEAN`                                                                 |
| Gate                        | U, the sixth re-review of the changed surface                           |
| Reviewer                    | `gpt-5.6-sol`, `codex exec -s read-only`                                |
| Reviewer's answer, verbatim | _"Is there an unresolved P0 or release-critical P1 in this diff? No."_  |
| Remote CI                   | run `32433898532`, workflow CI, job `verify`, green on exactly this SHA |
| Local verification          | 1580 / 1580 across 110 files against a live PostgreSQL 16.10, no skips  |

## What this attests, and what it does not

It attests that gate U found nothing at `c03aa73` — no P0, no release-critical P1 — and that the
stop rule authorised by `[CHATGPT_ARCHITECT_GUIDANCE][MARKET-OS][RC-CONVERGENCE-007]` is met at
that SHA.

It does not attest that the product is finished, that the guardrail is complete, or that the
twenty SHAs before it were clean. **They were not.** Every gate from A to T found at least one real
defect and produced a new candidate, and each of those SHAs is marked `SUPERSEDED_NOT_CLEAN` in
`reviews/market-os-final-review.json` with the commit that superseded it. The `notAttested` array in
the JSON lists all twenty by hash, because the failure mode this whole apparatus guards against is
somebody attesting the SHA a review examined rather than the SHA its fixes landed in.

## Why a clean gate was worth waiting for

The stop rule does not require a reviewer to return zero comments — it requires no unresolved
P0 or P1. Gate U returning "No findings" is therefore stronger than the rule needs, and it is the
first time in twenty rounds it has happened.

What changed to make it possible was not persistence. Rounds A through E replaced one pattern with
another and each replacement broke something adjacent. Gate F changed what a rule keyed on — the
subject of "promise" rather than its recipient — and the regression rate started falling. Gate N
replaced five subject-matching patterns with a deterministic three-valued classifier whose third
value, `UNRESOLVED`, redirects. Gates O through T were scope and precedence on that classifier, not
new vocabulary.

The full narrative is in `docs/INTERIM_REVIEW_FINDINGS.md`, gate by gate, including the nine
reviewer claims that did not reproduce and the two occasions where a fix was right and the reason
printed beside it was wrong.

## Carried forward as review debt, not as unknowns

Three items, each with written reasoning and a test pinning current behaviour:

- **Name collisions.** A person whose name is a registry entry classifies `NON_PERSON`. Every name
  registry has this property; closing it needs either full-span matching, which breaks "the Dow
  Jones Industrial Average", or a personal-name list, which is the unbounded enumeration the
  classifier exists to avoid. Every phrasing carrying any other personal cue is covered.
- **A1**, signup email enumeration — a product decision needing email verification, which is a
  Human Gate. Recorded with HG-009, to revisit before public launch.
- **C1**, the Claim Ledger validating structure and not content — unreachable today, and the fix is
  one shared prohibited-language module consumed by three callers.

## What still gates a release, and is nothing to do with this

FRED / ECOS / OpenDART live keys (HG-002/003/004), the funded-provider decision for full Ask
Market, production deployment approval, payment activation, and HG-009. None is closable by
autonomous work, and none of them is what this attestation is about.
