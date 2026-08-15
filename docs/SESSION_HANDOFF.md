LAST COMPLETED
M03: FRED adapter (src/server/adapters/fred/: client.ts, types.ts, normalize.ts, ingest.ts,
__fixtures__/dgs10.json) — fetches raw observations, normalizes with UTC date parsing, never
coerces missing (".") values to 0, and persists via Prisma with explicit revision tracking
(changed values create a new row with isRevision/revisionOf rather than overwriting). Real
invocation path: `npm run ingest:fred` (scripts/ingest-fred.ts), verified to fail cleanly and
correctly when FRED_API_KEY is unset (Human Gate, not silently skipped). 22/22 tests pass (11
unit + 11 integration against a real local Postgres, including revision and idempotency
coverage). Full verify chain green.

CURRENT TASK
M04: ECOS adapter — see docs/CURRENT_TASK.md. Do not copy FRED's normalize.ts assumptions
blindly; verify ECOS's actual response shape/missing-value marker first.

CURRENT FAILURE
none

CHANGED FILES (since M02 commit)
src/server/adapters/fred/* (new), scripts/ingest-fred.ts (new), package.json (ingest:fred
script), tests/adapters/fred-normalize.test.ts (new), tests/integration/fred-ingest.test.ts
(new), tests/integration/schema.test.ts (cleanup-order fix), vitest.config.mts
(fileParallelism: false — required once multiple integration test files share one live DB, to
avoid cross-file races).

TEST STATUS
22/22 pass with DATABASE_URL set. Integration suite skips gracefully without a DB.

NEXT EXACT ACTION
Start M04: research ECOS StatisticSearch API real response shape (do this before writing code),
then scaffold src/server/adapters/ecos/ mirroring the FRED adapter's structure and test
approach (fixture-based, no live network calls in tests).

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session in this container: `service postgresql
start` (data persists at /var/lib/postgresql/16/main across the session but the service is not
auto-started). Dev role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored).
`fileParallelism: false` in vitest.config.mts is required — do not remove it, or add new
DB-touching integration test files without considering whether they'll race with existing ones
on shared tables (all current integration tests do a delete-then-insert cleanup pattern keyed
loosely by externalId "DGS10" etc.; a truly parallel-safe design would need per-test schemas or
transactions, which is worth revisiting before M05+ multiplies the number of integration test
files). Three commits pushed so far (M00, M01, M02) to
origin/claude/market-os-development-7vnicg; M03 is about to be committed and pushed. No PR
opened yet.
