CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11, M12 (partial — cadence projection
only), M13 (partial — single-hop edges only), M14 (partial — single-series analog), M15
(partial — 6 core XBRL concepts, EDGAR only), M16 (partial — numeric deltas only, text-diff
blocked pending a filing-text adapter)

CURRENT
M17

STATUS
READY

TESTS
106 / 106 PASS (43 unit, 63 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md for the full list (16 entries as of M16). Summary categories: Codex
review pending for the whole pipeline; several adapter field-shapes unverified against live
APIs (egress blocked to ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov/api.stlouisfed.org); no
live news source (M07); releaseDate/cross-source-conflict gaps (M08); verifyClaim lacks
INFERENCE support (M09); most regime axes unpopulated pending real FRED_API_KEY (M11); no
calendar consensus data (M12); no causal-graph traversal (M13); analog engine single-series
only (M14); Company X-Ray EDGAR-only/6-concepts (M15); Filing Diff text-half blocked on a
not-yet-built filing-text adapter (M16).

NEXT
M17: ETF X-Ray. Index, expense ratio, holdings, sector/country/currency exposure, duration,
macro sensitivity (per docs/PRODUCT_SPEC.md) — explicitly NO "buy fitness score" or
investment-recommendation output (docs/LEGAL_GUARDRAILS.md hard prohibition). Real scoping
question first: ETF holdings/exposure data typically comes from the fund issuer or a paid data
vendor, not from FRED/ECOS/DART/EDGAR's existing adapter surface — check whether any free,
reachable source exists (e.g. an issuer's public holdings CSV/API) before designing schema;
this may turn out similarly constrained as M12's consensus-data search.