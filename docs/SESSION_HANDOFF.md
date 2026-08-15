LAST COMPLETED
M01: Next.js (TS, App Router, Tailwind) + Prisma/PostgreSQL scaffold, CI workflow, Vitest.
Prisma schema covers Source/Series/Observation/DataConflict/Claim (Claim Ledger groundwork).
Migration applied and verified against a real local Postgres instance; full verify chain
(format/lint/typecheck/test/build) green with 10/10 tests passing (7 unit + 3 integration).

CURRENT TASK
M02: Source/data model — seed script for initial sources, DataConflict integration coverage.

CURRENT FAILURE
none

CHANGED FILES
Full Next.js scaffold (src/app, src/server/db/client.ts, src/server/domain/claimLedger.ts),
prisma/schema.prisma + migrations, tests/, vitest.config.mts, .github/workflows/ci.yml,
package.json, README.md, .env.example, .gitignore, .prettierrc.json.

TEST STATUS
10/10 pass locally with DATABASE_URL set (postgresql://market_os:market_os_dev@localhost:5432/
market_os). 7/10 run (3 skipped) without DATABASE_URL — by design, so `npm test` never hard-fails
in a DB-less environment.

NEXT EXACT ACTION
Start M02: add prisma/seed.ts with the initial Tier S source registry (FRED, ECOS, OpenDART,
SEC EDGAR, BOK, KOSIS, 공공데이터포털, MOLIT), add a DataConflict integration test, update
PROJECT_STATE, then move to M03 (FRED adapter — first real external data source).

IMPORTANT CONTEXT
Repo was empty at session start; branch claude/market-os-development-7vnicg used throughout,
per task instructions. Local Postgres 16 is available in this container (`service postgresql
start`); a dev role/db were created (market_os/market_os_dev) — not committed, .env is
gitignored. Prisma 7 requires a driver adapter (@prisma/adapter-pg) instead of a `url` in
schema.prisma; see src/server/db/client.ts and docs/DECISIONS.md if this trips up a future
session. M01 DB schema is open Codex review debt (see PROJECT_STATE.md) — should be reviewed
before M03+ adapters depend heavily on it, but that review has not yet been requested since no
Codex session is available in this environment; log status in REVIEW_DEBT.md if still pending
when a decision point is reached.
