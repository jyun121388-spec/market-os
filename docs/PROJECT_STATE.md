CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03

CURRENT
M04

STATUS
READY

TESTS
22 / 22 PASS (11 unit, 11 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
M01-M03 DB schema + adapter pattern (sources/observations/claims/conflicts, FRED adapter) not
yet Codex-reviewed — required before M04+ repeats the pattern for ECOS (see AGENTS.md Codex
review scope).

NEXT
M04: ECOS (Bank of Korea) adapter — Korea macro data, reusing the FRED adapter pattern
(client/normalize/ingest) established in M03. Watch for KST/UTC handling differences and ECOS's
own missing-value convention (distinct from FRED's ".").
