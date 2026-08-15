CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11, M12 (partial — cadence projection
only, no consensus data), M13 (partial — single-hop edges only), M14 (partial — single-series
trailing-change similarity), M15 (partial — 6 core XBRL concepts for EDGAR only; no risk
factors/management-language, no DART financials)

CURRENT
M16

STATUS
READY

TESTS
102 / 102 PASS (43 unit, 59 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md for the full list. Summary: Codex review pending for the whole
pipeline (no Codex session available here); several adapter field-shapes unverified against
live APIs (egress blocked to ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov/
api.stlouisfed.org, including data.sec.gov's XBRL endpoint specifically); no live news source
wired (M07); releaseDate/cross-source-conflict gaps (M08); verifyClaim doesn't support
INFERENCE (M09); most regime axes unpopulated pending a real FRED_API_KEY (M11); Economic
Calendar has no consensus data (M12); Causal Graph has no multi-hop traversal (M13); Historical
Analog Engine is single-series only (M14); Company X-Ray covers only 6 core XBRL concepts for
EDGAR, no filing text (risk factors, management language), no DART/Korean financials yet (M15).

NEXT
M16: Filing Diff. New/removed risk factors, material numeric changes, capex/debt/cashflow
deltas, management-language changes vs. the prior filing (per docs/PRODUCT_SPEC.md). The
numeric-delta half is now buildable on M15's FinancialFact data (compare the same concept
across two accession numbers — reuses computeChange from M10/M11's seriesReadings.ts pattern).
The text-diff half (risk factors, management language) needs actual filing document text,
which M05/M06/M15 have never fetched (only metadata and XBRL facts) — a real scoping decision
again: fetching and diffing raw filing text is a new capability, not a natural extension of
what exists. Resolve scope before coding, same discipline as prior milestones.
