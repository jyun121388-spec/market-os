LAST COMPLETED
M11: Macro Regime Engine. Expanded `TRACKED_FRED_SERIES` from 4 to 11 series (added UNRATE,
INDPRO for Growth; M2SL, WALCL for Liquidity; VIXCLS for Risk; BAA10Y for Credit; DCOILWTICO
for Commodity — all free, stable FRED series IDs) so the engine's 8 planned axes
(Growth/Inflation/Liquidity/Risk/Rates/USD/Credit/Commodity) each map to at least one series.
Extracted shared "two most recent distinct observation dates" + "pure deterministic change
calc" logic from M10's whatChanged.ts into a new src/server/domain/seriesReadings.ts (used by
both whatChanged.ts and the new macroRegime.ts — a real DRY case, not premature abstraction,
since M10 already needed the exact same query). `computeRegimeSnapshot()` in
src/server/domain/macroRegime.ts reports per-series value/change/direction for every axis — it
deliberately does NOT compute a single composite "regime score" per axis, since no defensible
methodology for combining a policy rate, a volatility index, and a commodity price into one
number exists yet (documented in DECISIONS.md — the "no invented scores" principle applies to
deterministic code too, not just LLM output). Verified end-to-end with a real invocation script
(`npm run regime:print`) against actual data left in the dev database by other test suites —
confirmed GROWTH/RATES axes report real computed values while untouched axes correctly report
NOT_TRACKED/INSUFFICIENT_DATA rather than fabricating anything. 78/78 tests pass (35 unit + 43
integration against a real local Postgres, verified stable across repeated runs). Full verify
chain green.

Real-data caveat (logged in REVIEW_DEBT.md, not hidden): no FRED_API_KEY is configured in this
dev environment, so 5 of 8 axes currently have zero ingested observations and correctly report
NOT_TRACKED. This resolves once a real key is added (Human Gate) and `npm run ingest:fred` is
run — it is not a code defect.

CURRENT TASK
M12: Economic Calendar — see docs/CURRENT_TASK.md. Real open question before coding: no current
adapter supplies forward-looking consensus/surprise data; needs research into whether a free,
reachable source exists, or an explicit scope-down decision recorded in DECISIONS.md.

CURRENT FAILURE
none

CHANGED FILES (since M10 commit)
src/server/adapters/fred/types.ts (+7 tracked series), src/server/domain/seriesReadings.ts
(new, extracted from whatChanged.ts), src/server/domain/whatChanged.ts (refactored to use it),
src/server/domain/macroRegime.ts (new), scripts/print-regime.ts (new), package.json
(regime:print script), tests/domain/macroRegime.test.ts (new),
tests/integration/macro-regime.test.ts (new).

TEST STATUS
78/78 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M12: check reachability of candidate economic-calendar data sources first (WebFetch probe
— several domains in this project turned out egress-blocked; don't assume). If nothing free and
reachable provides real consensus/surprise data, scope M12 down explicitly and record the
decision in DECISIONS.md before writing any schema, rather than either blocking the milestone or
fabricating consensus numbers.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Eleven commits pushed so far (M00-M10) to
origin/claude/market-os-development-7vnicg; M11 is about to be committed and pushed. No PR
opened yet (none requested). The project consistently: (1) marks partial milestones as partial
in PROJECT_STATE.md, (2) logs real gaps in REVIEW_DEBT.md instead of hiding them, (3) verifies
new domain logic against a real Postgres with a real invocation script before calling a
milestone done. Keep that pattern for M12 onward.
