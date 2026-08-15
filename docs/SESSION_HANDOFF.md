LAST COMPLETED
M19: Watchlist. Added minimal `User` model (id + createdAt only — M22 Auth extends this same
table later, doesn't replace it, per docs/DECISIONS.md) and `WatchlistItem` (migration
20260815174600_watchlist) with a composite unique constraint on (userId, itemType, itemRef).
`src/server/domain/watchlist.ts` provides idempotent `addWatchlistItem` (upsert — re-adding the
same item is a no-op, doesn't overwrite the label), `removeWatchlistItem` (idempotent, reports
whether anything was actually removed), and `listWatchlist` (optionally filtered by itemType).
119/119 tests pass (46 unit + 73 integration against a real local Postgres, verified stable).
Full verify chain green.

CURRENT TASK
M20: Today / Morning Intelligence — see docs/CURRENT_TASK.md. First milestone that's a genuine
presentation-layer aggregator, not new data ingestion — composes M07/M10/M11/M12/M15/M16's
existing domain modules into one brief. Real decision to make before coding: the app has almost
no UI yet (only the M01 scaffold page). Leaning toward shipping a real minimal page this time
(src/app/today/page.tsx calling a server-side buildMorningBrief()), not just another
data-only module, per the project's "verify the actual user path" completion standard.

CURRENT FAILURE
none

CHANGED FILES (since M18 commit)
prisma/schema.prisma (+User, +WatchlistItem, +WatchlistItemType),
prisma/migrations/20260815174600_watchlist/, src/server/domain/watchlist.ts (new),
tests/integration/watchlist.test.ts (new).

TEST STATUS
119/119 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M20: record the UI-scope decision in DECISIONS.md, then build a server-side
buildMorningBrief() composition function pulling from existing domain modules, plus a real
minimal page rendering it. Verify by actually starting `npm run dev` and loading the page (not
just unit tests) — this is the first milestone where that verification step actually applies.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Nineteen commits pushed so far (M00-M18) to
origin/claude/market-os-development-7vnicg; M19 is about to be committed and pushed. No PR
opened yet (none requested). All prior milestones (M03-M19) are data/domain-logic only, with
zero real UI beyond the M01 default scaffold — M20 is a natural inflection point to start
building actual user-facing pages, worth being deliberate about since it sets the pattern for
M21 (Ask Market) and beyond.
