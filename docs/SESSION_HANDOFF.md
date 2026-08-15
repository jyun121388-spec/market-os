LAST COMPLETED
M13: Economic Causal Graph. Added `CausalEdge` model (migration 20260815172053_causal_edges)
with `counterexamples` as a REQUIRED field and `confidence` as a `LOW|MEDIUM|HIGH` enum rather
than a fabricated float — the database itself now rejects an edge that doesn't acknowledge a
limitation (docs/DECISIONS.md: "no invented precision" applies to schema design, not just
runtime logic). Seeded 7 well-established, textbook-level macro transmission mechanisms (oil→
inflation→rate expectations→bond yields; US-KR rate differential→USD/KRW→Korea import
inflation; yield curve inversion→recession probability with its correlational nature made
explicit in the edge itself; VIX→credit spreads) via `prisma/causalEdges.ts` (pure data) +
`prisma/seedCausalEdges.ts` (idempotent — verified by running it twice: 7 inserted, then 0
inserted/7 already present). `src/server/domain/causalGraph.ts` provides exact-match
`getEdgesFrom`/`getEdgesTo`/`getDirectEdge` — deliberately no fuzzy matching (would risk
misattributing a causal claim) and no multi-hop traversal yet (no real consumer needs it until
M21 Ask Market — logged as scoped-out, not forgotten). 90/90 tests pass (39 unit + 51
integration against a real local Postgres, verified stable). Full verify chain green.

CURRENT TASK
M14: Historical Analog Engine — see docs/CURRENT_TASK.md. Real constraint identified before
coding: this dev DB has very little historical data (no FRED_API_KEY here, so no real backfill
has run), so a genuinely useful historical-analog comparison isn't buildable end-to-end in this
environment yet. Plan is to build and test the deterministic similarity algorithm against
seeded/synthetic historical data, proving the math is correct, while being explicit that real
usage awaits real historical ingestion (Human Gate).

CURRENT FAILURE
none

CHANGED FILES (since M12 commit)
prisma/schema.prisma (+CausalEdge, +CausalDirection, +CausalConfidence),
prisma/migrations/20260815172053_causal_edges/, prisma/causalEdges.ts (new),
prisma/seedCausalEdges.ts (new), src/server/domain/causalGraph.ts (new), package.json
(db:seed-causal-edges script), tests/causalEdges.test.ts (new),
tests/integration/causal-graph.test.ts (new).

TEST STATUS
90/90 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M14: design the deterministic similarity methodology first (e.g. z-scored distance across
a small macro-state vector) and write it down in DECISIONS.md before touching schema/code.
Build src/server/domain/historicalAnalog.ts with a required sampleSize + limitations output,
test against seeded synthetic historical data (not live-ingested data, which doesn't exist in
meaningful volume in this dev environment yet).

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Thirteen commits pushed so far (M00-M12) to
origin/claude/market-os-development-7vnicg; M13 is about to be committed and pushed. No PR
opened yet (none requested). Consistent project pattern to continue: when a milestone's full
spec needs something this dev environment genuinely can't provide (blocked egress, thin real
data, no paid source), scope down explicitly, document why in DECISIONS.md, log the gap in
REVIEW_DEBT.md, and ship the honestly smaller real feature — never fabricate to look complete.
