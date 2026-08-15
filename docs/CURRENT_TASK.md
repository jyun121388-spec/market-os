# Current Task

MILESTONE: M15 — Company X-Ray

TASK: Per docs/PRODUCT_SPEC.md "Company X-Ray": revenue, operating income, net income, cash
flow, debt, inventory, capex, filings, risk factors, management-language changes, related
industry/macro variables. This needs structured financial-statement line items — a genuinely
new data shape. M05 (DART) and M06 (EDGAR) only stored Filing *metadata* (report name, receipt
number, date) — not the financial figures inside those filings. Extracting structured data from
raw filing documents (HTML/PDF parsing) is a much larger undertaking than anything built so
far.

STATUS: Not started — M14 (Historical Analog Engine, partial: single-series) complete and
verified.

NEXT EXACT ACTION: Before writing any code, check whether EDGAR's XBRL "company facts" API
(https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json) is reachable — it would provide
already-structured financial data (revenue, net income, etc. as tagged values) without needing
to parse filing documents, which is a fundamentally different (and much more tractable) scope
than scraping. If reachable, design a `FinancialFact` model (or reuse Observation-like shape)
around XBRL concept/value/period/unit tuples for EDGAR first (Korean DART equivalent structured
data would be a separate, later sub-scope). If data.sec.gov remains egress-blocked (as it was
for M06's submissions API), explicitly scope M15 down or mark it BLOCKED pending reachability,
documenting the decision in DECISIONS.md rather than attempting to parse raw HTML filings by
hand, which risks fabricating structured data from unstructured text.
