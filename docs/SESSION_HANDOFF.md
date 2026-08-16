LAST COMPLETED
M24: Admin / Monitoring, scoped to an internal pipeline-health view built entirely from data
already in the DB (see docs/DECISIONS.md) — `src/server/domain/systemHealth.ts`'s
`computeSystemHealth()` (per-source last-ingest timestamp across Observation/Filing/
FinancialFact/Etf/EventMention, plus unresolved DataConflict count) and `src/app/admin/page.tsx`
(gated by `getCurrentUser()`, redirects unauthenticated visitors to `/login`). No external
monitoring/error-tracking/uptime service integrated — that would be a Human Gate the moment it's
paid. Verified end-to-end with a real Playwright browser session against `npm run dev`:
unauthenticated `/admin` redirects to `/login`; a signed-up user sees the Pipeline Health
heading, their email, a FRED source row, and a last-ingest value. 147/147 tests pass (61 unit +
86 integration against a real local Postgres, verified stable across repeated runs). Full verify
chain (format/lint/typecheck/test/build) green. Test admin user and dev server cleaned up after
verification.

CURRENT TASK
M25: Performance / Cache / Background Jobs — see docs/CURRENT_TASK.md. Scoped to (a) a generic
TTL in-memory cache helper applied to one expensive read path, and (b) a dev/CI-invocable script
sequencing existing `ingest:*` commands with logging. Real production cron/queue infrastructure
deferred pending the production-deployment Human Gate.

CURRENT FAILURE
none

CHANGED FILES (since M23 commit)
src/server/domain/systemHealth.ts (new), tests/integration/system-health.test.ts (new),
src/app/admin/page.tsx (new), docs/DECISIONS.md (+M24 entry), docs/PROJECT_STATE.md,
docs/CURRENT_TASK.md, docs/SESSION_HANDOFF.md (this update).

TEST STATUS
147/147 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M25: write `src/server/domain/cache.ts` (generic TTL-based in-memory cache, unit-tested
for hit/miss/expiry), apply it to `computeSystemHealth`, then write a job-runner script
(`npm run jobs:ingest-all` or similar) sequencing the existing `ingest:*` commands with
structured success/failure logging. Verify with real invocation, not just unit tests.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored) — when running `npm run
verify`/tests outside a shell that already sources `.env` (e.g. a fresh Bash tool call), `export
DATABASE_URL=...` first or the vitest run will report "DATABASE_URL is not set" even though
`.env` exists (Next.js loads `.env` itself, but bare `vitest run`/`prisma` via `npm run` do not
always inherit it from a non-interactive shell — confirmed this session). Remember `npx prisma
generate` after every schema.prisma change. For schema changes that add a unique constraint (or
anything else ambiguous), `prisma migrate dev` fails non-interactively — use `prisma migrate
diff --from-config-datasource --to-schema prisma/schema.prisma --script` to get the SQL, then
hand-write it into `prisma/migrations/<timestamp>_<name>/migration.sql` and apply with `prisma
migrate deploy`. vitest.config.mts has fileParallelism: false, and every integration test file
must scope cleanup to rows it owns. `playwright` is a devDependency — use it (not curl) to
verify any Server Action / interactive flow in a real browser, launching with `executablePath:
'/opt/pw-browsers/chromium'`. Twenty-three commits pushed so far (M00-M23) to
origin/claude/market-os-development-7vnicg; M24 is about to be committed and pushed. No PR
opened yet (none requested). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it
without explicit human direction on LLM provider/funding/credentials. Standing user instruction
(2026-08-16, Korean): resume from last completed point, do not stop at milestone/phase
transitions, auto-fix test failures and Codex REVISE findings, continue through the entire
roadmap autonomously, only stop for genuine high-risk Human Gates requiring real user
intervention.
