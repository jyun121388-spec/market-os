LAST COMPLETED
M04: ECOS (Bank of Korea) adapter (src/server/adapters/ecos/: client.ts, types.ts, normalize.ts,
ingest.ts, __fixtures__/base-rate.json), mirroring the FRED adapter's shape. Extracted the
shared revision-aware observation upsert into src/server/domain/observationIngest.ts once the
same logic was needed a second time (see docs/DECISIONS.md). ECOS's missing-value marker could
not be verified against a live API (network to ecos.bok.or.kr is blocked in this dev
environment — WebFetch confirmed this); normalize.ts is deliberately conservative (any
non-finite DATA_VALUE is treated as missing) rather than guessing at an unverified convention.
Logged as REVIEW_DEBT, not silently assumed correct. Real invocation path
`npm run ingest:ecos`, verified to fail safely without ECOS_API_KEY. 32/32 tests pass (16 unit +
16 integration against a real local Postgres). Full verify chain green.

CURRENT TASK
M05: OpenDART adapter — see docs/CURRENT_TASK.md. This is the first genuinely different adapter
shape (filings/documents, not time-series observations) — don't force-fit it into
Series/Observation; a new Filing model is likely needed.

CURRENT FAILURE
none

CHANGED FILES (since M03 commit)
src/server/adapters/ecos/* (new), src/server/domain/observationIngest.ts (new, extracted from
fred+ecos ingest.ts duplication), src/server/adapters/fred/ingest.ts (refactored to use the
shared helper), scripts/ingest-ecos.ts (new), package.json (ingest:ecos script),
tests/adapters/ecos-normalize.test.ts (new), tests/integration/ecos-ingest.test.ts (new).

TEST STATUS
32/32 pass with DATABASE_URL set. Integration suite skips gracefully without a DB.

NEXT EXACT ACTION
Start M05: research OpenDART's real API shape (WebSearch, since direct fetch to
opendart.fss.or.kr may also be blocked — check before assuming), design a Filing schema
addition + migration, then build the adapter.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). vitest.config.mts has
fileParallelism: false (required — integration tests share one live DB). WebFetch to
ecos.bok.or.kr is EGRESS_BLOCKED in this environment; check egress access for any new external
domain (opendart.fss.or.kr, sec.gov, etc.) with a quick WebFetch/WebSearch probe before relying
on it, and design adapters to degrade to "unverified, documented as such" rather than blocking
entirely when live verification isn't possible. Four commits pushed so far (M00-M03) to
origin/claude/market-os-development-7vnicg; M04 is about to be committed and pushed. No PR
opened yet (none requested).
