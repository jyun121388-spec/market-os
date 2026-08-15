CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11, M12 (partial — cadence projection
only, no consensus data), M13 (partial — single-hop edges only), M14 (partial — single-series
trailing-change similarity, no multi-variable regime-state analog yet)

CURRENT
M15

STATUS
READY

TESTS
94 / 94 PASS (39 unit, 55 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md for the full list. Summary: Codex review pending for the whole
pipeline (no Codex session available here); several adapter field-shapes unverified against
live APIs (egress blocked to ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov/
api.stlouisfed.org); no live news source wired (M07); releaseDate/cross-source-conflict gaps
(M08); verifyClaim doesn't support INFERENCE (M09); most regime axes unpopulated pending a real
FRED_API_KEY (M11); Economic Calendar has no consensus data (M12); Causal Graph has no
multi-hop traversal (M13); Historical Analog Engine is single-series only and untested against
real multi-year history (M14, since this dev DB has little real history yet).

NEXT
M15: Company X-Ray. Revenue, operating income, net income, cash flow, debt, inventory, capex,
filings, risk factors, management-language changes, related industry/macro variables (per
docs/PRODUCT_SPEC.md). This is the first milestone that needs actual financial-statement line
items, not just filing metadata (M05/M06 only stored Filing records, not their contents) —
real scoping question to resolve first: does extracting structured financials from DART/EDGAR
filing documents belong in this milestone, or is it large enough to warrant its own sub-scope
decision (e.g. start with EDGAR's XBRL company-facts API if reachable, since it provides
structured data without HTML/PDF parsing)? Check reachability and design scope before coding,
same discipline as M04-M06/M12.
