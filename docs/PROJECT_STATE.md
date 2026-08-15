CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05

CURRENT
M06

STATUS
READY

TESTS
41 / 41 PASS (20 unit, 21 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + adapter pattern not yet Codex-reviewed (no Codex session
available in this environment); ECOS and DART field/status-code details unverified against
live API responses (egress to both domains blocked in this dev environment; needs real API
keys, a Human Gate, to confirm).

NEXT
M06: SEC EDGAR (US filings) adapter — reuses the new Filing model from M05, adapted for EDGAR's
submissions API (CIK-based) instead of DART's corp_code/rcept_no. Different date/accession
conventions — research the real EDGAR submissions.json shape before coding, same as M04/M05.
