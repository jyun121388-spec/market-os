LAST COMPLETED
M05: OpenDART adapter (src/server/adapters/dart/: client.ts, types.ts, normalize.ts, ingest.ts,
__fixtures__/samsung-list.json). Added a new `Filing` Prisma model (migration
20260815161529_filings) since filings are discrete documents, not time-series observations —
see docs/DECISIONS.md for why this wasn't forced into Series/Observation. Handles DART's
status "013" (no matching data) as an empty result vs. other non-"000" statuses as real errors.
OpenDART's exact field/status shape is unverified against a live API (opendart.fss.or.kr is
egress-blocked in this dev environment, confirmed via WebFetch, same as ecos.bok.or.kr) —
logged in REVIEW_DEBT, not silently presumed correct. Real invocation path
`npm run ingest:dart`, verified to fail safely without DART_API_KEY. 41/41 tests pass (20 unit +
21 integration against a real local Postgres). Full verify chain green.

CURRENT TASK
M06: SEC EDGAR adapter — see docs/CURRENT_TASK.md. Reuses the Filing model from M05. EDGAR uses
CIK + accession numbers and a User-Agent header instead of an API key — different auth pattern
from FRED/ECOS/DART, don't assume it carries over uncritically.

CURRENT FAILURE
none

CHANGED FILES (since M04 commit)
prisma/schema.prisma (+Filing model), prisma/migrations/20260815161529_filings/,
src/server/adapters/dart/* (new), scripts/ingest-dart.ts (new), package.json (ingest:dart
script), tests/adapters/dart-normalize.test.ts (new), tests/integration/dart-ingest.test.ts
(new).

TEST STATUS
41/41 pass with DATABASE_URL set. Integration suite skips gracefully without a DB.

NEXT EXACT ACTION
Start M06: check whether data.sec.gov is reachable (test with WebFetch first — ecos.bok.or.kr
and opendart.fss.or.kr were both blocked, data.sec.gov may or may not be), research the real
submissions API shape, then build src/server/adapters/edgar/ following the DART adapter's
pattern (Filing model, fixture-based tests, real invocation script) adapted for EDGAR's
CIK/accession-number/User-Agent conventions.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember to run
`npx prisma generate` after any schema.prisma change — forgetting this caused a typecheck
failure this session (Property 'filing' does not exist on type 'PrismaClient') until it was
regenerated. vitest.config.mts has fileParallelism: false (required). Five commits pushed so
far (M00-M04) to origin/claude/market-os-development-7vnicg; M05 is about to be committed and
pushed. No PR opened yet (none requested). Both ECOS and DART adapters were built from
documentation/general knowledge rather than a verified live API response, since egress to both
domains is blocked in this container — this is a real, tracked limitation (REVIEW_DEBT.md), not
an oversight; the same check-first approach should apply to EDGAR in M06.
