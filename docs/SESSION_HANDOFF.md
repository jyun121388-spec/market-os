LAST COMPLETED
M10: What Changed. Added `src/server/domain/whatChanged.ts`'s `computeSeriesChange(seriesId)`:
finds the two most recent distinct observation dates for a series (respecting revisions — the
retrievedAt-desc tiebreak means a revised value is used, not the originally-ingested one),
computes absolute/percent/bps change with plain deterministic `Number` arithmetic (documented
precision tradeoff in docs/DECISIONS.md), and persists the result as a CALCULATION claim via
`createClaim`. Extended `claimVerification.ts`'s `verifyClaim` to handle CALCULATION claims
too (recomputes the delta independently from the evidenced observations and compares within a
1e-6 tolerance) rather than leaving that as another FACT-only gap. Returns INSUFFICIENT_DATA
rather than fabricating a change for a series with <2 observation dates. 74/74 tests pass (34
unit + 40 integration against a real local Postgres, verified stable across repeated runs).
Full verify chain green.

CURRENT TASK
M11: Macro Regime Engine — see docs/CURRENT_TASK.md. Real constraint identified before coding
even started: only 5 series are currently tracked (4 FRED + 1 ECOS), too few to assess most of
the regime engine's 8 planned axes (Growth/Inflation/Liquidity/Risk/Rates/USD/Credit/
Commodity). Plan is to expand FRED series coverage and explicitly return
"insufficient data" for axes that still can't be assessed, rather than fabricating scores.

CURRENT FAILURE
none

CHANGED FILES (since M09 commit)
src/server/domain/whatChanged.ts (new), src/server/domain/claimVerification.ts (extended for
CALCULATION), tests/integration/what-changed.test.ts (new).

TEST STATUS
74/74 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M11: decide the minimal viable axis set for V1 (Rates/USD/Inflation are well-supported by
current series; Growth/Liquidity/Risk/Credit/Commodity need more FRED series first — GDP,
unemployment, credit spreads are all on FRED and free). Add those series to
TRACKED_FRED_SERIES, then design computeRegimeSnapshot() in a new
src/server/domain/macroRegime.ts reusing the deterministic-calc → CALCULATION-claim pattern.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Ten commits pushed so far (M00-M09) to origin/claude/market-os-development-7vnicg;
M10 is about to be committed and pushed. No PR opened yet (none requested). The project
consistently marks partial milestones as partial and logs real gaps in REVIEW_DEBT.md rather
than claiming full completion — M11 should identify its own axis-coverage gap up front (as
CURRENT_TASK.md now does) rather than discovering it after declaring the milestone done.
