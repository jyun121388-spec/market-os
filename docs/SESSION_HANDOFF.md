LAST COMPLETED
M12: Economic Calendar, deliberately scoped down from the full spec. Confirmed via WebFetch
that api.stlouisfed.org (FRED, including its Releases API which would give real release dates)
is egress-blocked in this dev environment, same pattern as ecos.bok.or.kr/opendart.fss.or.kr/
data.sec.gov before it. Rather than guess at specific FRED release_id-to-series mappings
without being able to verify them live (a real risk of displaying wrong dates as if confirmed),
built `src/server/domain/economicCalendar.ts`'s `computeCalendarEntry`/`computeCalendar`: a
deterministic projection of each series' next expected observation date from the median
historical interval between its own past observation dates — using only data the app has
already verifiably ingested itself. No consensus/surprise/actual-vs-expected (logged as a real,
documented gap in REVIEW_DEBT.md, not silently dropped). Verified against real data with
`npm run calendar:print`. 81/81 tests pass (35 unit + 46 integration against a real local
Postgres, verified stable across repeated runs). Full verify chain green.

CURRENT TASK
M13: Economic Causal Graph — see docs/CURRENT_TASK.md. Different shape from M03-M12: not a
data-ingestion milestone (no external API for causal edges), but schema design + careful,
conservatively-scoped seed data. Hard constraint: never present correlation as confirmed
causation — every CausalEdge must carry a required counterexample/limitation field, not just an
optional one, so epistemic honesty is enforced by the schema itself.

CURRENT FAILURE
none

CHANGED FILES (since M11 commit)
src/server/domain/economicCalendar.ts (new), scripts/print-calendar.ts (new), package.json
(calendar:print script), tests/integration/economic-calendar.test.ts (new).

TEST STATUS
81/81 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M13: add a `CausalEdge` model to prisma/schema.prisma (fromVariable, toVariable,
direction, confidence as an enum not a fabricated float, evidence, lag as descriptive text,
conditions, and a REQUIRED counterexamples field), migrate, then seed 5-10 well-established
macro transmission mechanisms with real, defensible reasoning — not novel causal claims.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Twelve commits pushed so far (M00-M11) to
origin/claude/market-os-development-7vnicg; M12 is about to be committed and pushed. No PR
opened yet (none requested). Recurring pattern in this project worth continuing: when a
milestone's full spec needs data this dev environment can't verify (blocked egress, no paid
source), scope down explicitly, document the decision and the gap, and ship the honestly
smaller real feature rather than blocking or fabricating. api.stlouisfed.org,
ecos.bok.or.kr, opendart.fss.or.kr, and data.sec.gov are ALL confirmed egress-blocked in this
container as of this session — don't re-probe them without a reason to think network policy
changed.
