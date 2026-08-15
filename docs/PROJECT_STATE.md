CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06

CURRENT
M07

STATUS
READY

TESTS
49 / 49 PASS (24 unit, 25 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + adapter pattern (FRED/ECOS/DART/EDGAR) not yet
Codex-reviewed (no Codex session available in this environment); ECOS/DART/EDGAR field-level
shapes unverified against live API responses (egress to all three domains blocked in this dev
environment; needs real API keys/User-Agent, a Human Gate, to confirm).

NEXT
M07: Event model + news-intelligence foundation. All four planned M03-M06 adapters
(FRED/ECOS/DART/EDGAR) are done — this is the first milestone building genuinely new
intelligence (event clustering) rather than another source adapter. Design an Event/
EventSource(s) schema per docs/ARCHITECTURE.md's "Event Intelligence" feature area before
writing ingestion code; news is a detection sensor, not a content source (docs/DATA_POLICY.md
"News policy").
