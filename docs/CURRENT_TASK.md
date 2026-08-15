# Current Task

MILESTONE: M14 — Historical Analog Engine

TASK: Per docs/PRODUCT_SPEC.md "Historical Analog Engine": similarity score + comparable
historical periods + subsequent 1M/3M/6M actual outcomes + sample size + explicit limitations.
"Past results do not guarantee future outcomes" must be structural (a required field, mirroring
M13's `counterexamples`), not just prose. Real constraint: this dev environment's database has
very little historical Observation data (no FRED_API_KEY configured here, so adapters haven't
actually backfilled years of history — see REVIEW_DEBT.md). A historical-analog comparison
needs meaningful history to be honest; don't build something that looks like a working feature
but would only ever return "insufficient sample size" against this dev database.

STATUS: Not started — M13 (Economic Causal Graph, partial: single-hop only) complete and
verified.

NEXT EXACT ACTION: Design the similarity methodology BEFORE writing schema: for a chosen
"current state" vector (e.g. a snapshot of a few macro series' recent % changes), define a
deterministic distance metric (e.g. normalized Euclidean or cosine distance across
z-scored series) against historical windows of the same series — no LLM judgment call on
similarity. Explicitly require `sampleSize` and a `limitations` field (non-optional, like
CausalEdge.counterexamples) on any persisted analog result. Given the thin-data constraint,
scope V1 to: the algorithm + tests using synthetic/seeded historical data proving the math is
correct, with real usage against actual multi-year history deferred until real ingestion has
run (Human Gate: FRED_API_KEY) — document this scope decision in DECISIONS.md before coding.
