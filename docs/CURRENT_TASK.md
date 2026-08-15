# Current Task

MILESTONE: M10 — What Changed (24h change detection)

TASK: The first milestone that is a real user-facing *feature*, not adapter/pipeline
groundwork. For each tracked Series (FRED/ECOS), deterministically compute the change between
the latest Observation and the one ~24h (or one period, for non-daily series) prior: absolute
change, percent change, and — where the unit is "percent" (e.g. yields, rates) — basis-point
change. Store the result as a CALCULATION claim via `src/server/domain/claimStore.ts` (extend
`createClaim`'s usage, not its invariants) so the number has the same provenance guarantees as
FACT claims. Frame per docs/PRODUCT_SPEC.md: what changed → how much → (why it matters and what
to check next are presentation-layer concerns for a later milestone, not this one).

STATUS: Not started — M09 (Claim Ledger verification, FACT-scoped) complete and verified.

NEXT EXACT ACTION: Design `computeSeriesChange(seriesId, opts)` in a new
`src/server/domain/whatChanged.ts`: query the two most recent Observations for a series
(respecting revisions — always compare the latest non-superseded value at each date), compute
delta/percent/bps deterministically (no LLM), and build a CALCULATION claim via
`createClaim` with `evidence` referencing both observation ids. Add unit tests for the
arithmetic (including a case where the "prior" observation was itself revised) and an
integration test proving the resulting Claim is verifiable end-to-end once
`claimVerification.ts` is extended to handle CALCULATION (extend it in this milestone rather
than leaving another FACT-only gap).
