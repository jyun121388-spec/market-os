CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11, M12 (partial — cadence projection
only, no consensus data — see REVIEW_DEBT)

CURRENT
M13

STATUS
READY

TESTS
81 / 81 PASS (35 unit, 46 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline not yet Codex-reviewed; ECOS/DART/EDGAR
field-level shapes and FRED's own domain (api.stlouisfed.org) all unverified/unreachable in
this dev environment; no live news source wired (M07); releaseDate/cross-source-conflict gaps
(M08); verifyClaim doesn't support INFERENCE (M09); 5 of 8 regime axes have no ingested data
yet, by design pending a real FRED_API_KEY (M11); Economic Calendar has no consensus/surprise
data, only a cadence projection from real ingested history (M12).

NEXT
M13: Economic Causal Graph. Transmission-path edges (direction, confidence, evidence, lag,
conditions, counterexamples per docs/PRODUCT_SPEC.md) — correlation must never be presented as
confirmed causation. This is explicitly NOT a place for an LLM to assert causal claims freely;
design the schema so every edge requires stored evidence/counterexamples, and keep initial edge
data to well-established, textbook-level macro transmission mechanisms (e.g. oil -> inflation
-> rate expectations) rather than inventing novel causal claims.
