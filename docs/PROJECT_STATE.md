CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01

CURRENT
M02

STATUS
READY

TESTS
10 / 10 PASS (7 unit, 3 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
M01 DB schema (sources/observations/claims) not yet Codex-reviewed — required before M03+
adapters write real data against it (see AGENTS.md Codex review scope).

NEXT
M02: Source/data model — finalize schema details, seed script for Tier S sources, migration,
integration tests for the Claim Ledger invariants against a real Prisma-backed DB.
