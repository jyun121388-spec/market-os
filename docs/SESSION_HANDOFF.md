LAST COMPLETED
M18: Real Estate Intelligence (Korea), scoped to schema + median-based price-change analysis,
no ingestion adapter (data.go.kr confirmed egress-blocked via WebFetch, consistent with every
other financial-data domain tested this session). Added `RealEstateTransaction` model
(migration 20260815174238_real_estate) matching MOLIT's well-known 실거래가 (actual
transaction price) data shape. `src/server/domain/realEstateAnalysis.ts`'s
`computeRegionalPriceChange` compares MEDIAN price-per-sqm between two time windows (not a
two-point delta like whatChanged.ts) — deliberately chosen because individual real-estate
transactions have high per-unit variance, so a median over a window is more honest than
comparing two arbitrary transactions. Requires a minimum sample size in each window (default 3)
or returns INSUFFICIENT_DATA. Verified against hand-computed seeded data — all exact values
(median 110 vs 95, absolute change 15, percent change 15.7895%) matched on the first test run.
114/114 tests pass (46 unit + 68 integration against a real local Postgres, verified stable).
Full verify chain green.

CURRENT TASK
M19: Watchlist — see docs/CURRENT_TASK.md. Resolved a real dependency question before coding:
Watchlist needs "whose list is this" but Auth is M22. Decision (recorded in DECISIONS.md):
ship a minimal placeholder User model (id + createdAt only) now, which M22 extends with real
auth fields later rather than replacing.

CURRENT FAILURE
none

CHANGED FILES (since M17 commit)
prisma/schema.prisma (+RealEstateTransaction, +RealEstateDealType),
prisma/migrations/20260815174238_real_estate/, src/server/domain/realEstateAnalysis.ts (new),
tests/integration/real-estate-analysis.test.ts (new).

TEST STATUS
114/114 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Implementing M19 now in this same session: add User + WatchlistItem models, migrate, build
src/server/domain/watchlist.ts with idempotent add/remove/list, test against real Postgres.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Eighteen commits pushed so far (M00-M17) to
origin/claude/market-os-development-7vnicg; M18 is about to be committed and pushed. No PR
opened yet (none requested). This dev environment's egress restrictions are now well-established
(ecos.bok.or.kr, opendart.fss.or.kr, data.sec.gov, api.stlouisfed.org, ssga.com, ishares.com,
data.go.kr all blocked) — for any future milestone needing an external data source, probe once,
then move directly to scoping down if blocked rather than re-litigating the pattern.
