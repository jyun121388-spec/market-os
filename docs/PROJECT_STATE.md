CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04

CURRENT
M05

STATUS
READY

TESTS
32 / 32 PASS (16 unit, 16 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + adapter pattern not yet Codex-reviewed (no Codex session
available in this environment); ECOS missing-value marker unverified against a live API
response (network to ecos.bok.or.kr blocked in dev; needs a real ECOS_API_KEY, a Human Gate).

NEXT
M05: OpenDART (Korea filings) adapter — first filings-type source, structurally different from
the macro time-series adapters (FRED/ECOS): documents/reports rather than observation values,
likely needs new schema (a Filing model) rather than reusing Series/Observation as-is.
