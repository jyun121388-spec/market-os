CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10

CURRENT
M11

STATUS
READY

TESTS
74 / 74 PASS (34 unit, 40 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline not yet Codex-reviewed; ECOS/DART/EDGAR
field-level shapes unverified against live APIs (egress blocked); no live news source wired
(M07); releaseDate/cross-source-conflict gaps (M08); verifyClaim still doesn't support
INFERENCE claims (no real producer exists yet — M21).

NEXT
M11: Macro Regime Engine — structured state across Growth/Inflation/Liquidity/Risk/Rates/USD/
Credit/Commodity axes, deterministic where inputs allow (per docs/PRODUCT_SPEC.md). Builds
directly on M10's computeSeriesChange pattern (deterministic calc → CALCULATION claim →
verifiable). Needs more tracked series than the 4 FRED + 1 ECOS currently in
TRACKED_FRED_SERIES/TRACKED_ECOS_SERIES to be meaningful — expand series coverage as part of
this milestone rather than declaring a regime engine "done" against a near-empty dataset.
