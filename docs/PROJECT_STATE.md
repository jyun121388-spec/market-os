CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02

CURRENT
M03

STATUS
READY

TESTS
14 / 14 PASS (10 unit, 4 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
M01/M02 DB schema + seed (sources/observations/claims/conflicts) not yet Codex-reviewed —
required before M03+ adapters depend heavily on it (see AGENTS.md Codex review scope).

NEXT
M03: FRED adapter — first real external data source, exercising the Source/Series/Observation
pipeline end-to-end against live (free) data.
