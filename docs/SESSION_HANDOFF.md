LAST COMPLETED
M06: SEC EDGAR adapter (src/server/adapters/edgar/: client.ts, types.ts, normalize.ts,
ingest.ts, __fixtures__/apple-submissions.json), reusing the M05 Filing model. EDGAR needs no
API key — only a descriptive `EDGAR_USER_AGENT` header (SEC fair-access policy) — a different
auth pattern from FRED/ECOS/DART, handled with its own EdgarUserAgentMissingError. Normalizes
`filings.recent`'s parallel-array structure into per-filing rows, with an explicit
length-mismatch guard (assertParallelArraysAligned) that throws rather than risking
misattributed data. EDGAR's field shape is unverified against a live response (data.sec.gov is
egress-blocked in this dev environment too) — logged in REVIEW_DEBT, built from SEC's own
published docs via web search.

Also fixed a real bug found while adding EDGAR: tests/integration/schema.test.ts was doing a
global `prisma.source.deleteMany()` in its beforeAll, which broke once multiple adapter test
suites started persisting their own Source rows in the same live database (FK violation once
Filing/M05 existed). Fixed by giving that suite its own dedicated source code
(TEST_SCHEMA_SOURCE) and scoping all cleanup to it — see docs/DECISIONS.md. Verified stable
across 3 repeated `npm test` runs after the fix.

Real invocation path `npm run ingest:edgar`, verified to fail safely without EDGAR_USER_AGENT.
49/49 tests pass (24 unit + 25 integration against a real local Postgres). Full verify chain
green.

CURRENT TASK
M07: Event model + news-intelligence foundation — see docs/CURRENT_TASK.md. First milestone
past the adapter pattern (FRED/ECOS/DART/EDGAR — M03-M06 — are all done now).

CURRENT FAILURE
none

CHANGED FILES (since M05 commit)
src/server/adapters/edgar/* (new), scripts/ingest-edgar.ts (new), package.json (ingest:edgar
script), .env.example (+EDGAR_USER_AGENT), tests/adapters/edgar-normalize.test.ts (new),
tests/integration/edgar-ingest.test.ts (new), tests/integration/schema.test.ts (scoped cleanup
fix — was a latent bug, not EDGAR-specific).

TEST STATUS
49/49 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M07: design an Event/EventMention Prisma schema addition (see docs/CURRENT_TASK.md for
the shape), add a migration, then build clustering logic + tests using fixture data. No live
news source is wired in this environment yet — that's a separate follow-on adapter once a
suitable free source is identified, analogous to M03-M06.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change (caused a typecheck failure once already this
project — see M05 handoff history). vitest.config.mts has fileParallelism: false — required,
AND every integration test file must scope its cleanup queries to rows it owns, never a bare
deleteMany() on a shared table (see docs/DECISIONS.md "Integration tests must never
deleteMany()..." — this bit us once already). Six commits pushed so far (M00-M05) to
origin/claude/market-os-development-7vnicg; M06 is about to be committed and pushed. No PR
opened yet (none requested). Egress is blocked to ecos.bok.or.kr, opendart.fss.or.kr, and
data.sec.gov in this container — check reachability before assuming any new external domain
(e.g. a news API for M07) is usable.
