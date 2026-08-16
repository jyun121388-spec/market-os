LAST COMPLETED
M25: Performance / Cache / Background Jobs, scoped to what's buildable without deploying
anything (production deployment is a Human Gate — see docs/DECISIONS.md). Shipped:
`src/server/domain/cache.ts` (generic `TtlCache<T>`/`withCache()`, process-local `Map`, unit
tested for hit/miss/expiry/clear with vitest fake timers) applied to `computeSystemHealth()`
with a 30s TTL, plus `scripts/run-ingest-jobs.ts` (`npm run jobs:ingest-all`) which sequences
the five existing `ingest:*` npm scripts as subprocesses, logs per-job success/failure/duration,
continues past a failed job, and exits non-zero on any failure. Verified with a real invocation
in this environment: all five jobs correctly failed with their existing "API key not set — Human
Gate" errors (no real keys configured here), the runner logged each failure without crashing,
printed a summary, and exited 1 (confirmed via a separate `echo $?`, not just log text). No real
cron/queue scheduler wired up — logged as BLOCKED_HUMAN_GATE in docs/REVIEW_DEBT.md pending
production-deployment approval. 155/155 tests pass (69 unit + 86 integration against a real
local Postgres). Full verify chain (format/lint/typecheck/test/build) green.

CURRENT TASK
M26: Security Hardening — see docs/CURRENT_TASK.md. Self-review pass (no Codex session
available) against docs/LEGAL_GUARDRAILS.md and standard web-app security basics: session cookie
flags, scrypt parameters, login/signup rate-limiting, error-path secret leakage, and Next.js
Server Actions' CSRF posture.

CURRENT FAILURE
none

CHANGED FILES (since M24 commit)
src/server/domain/cache.ts (new), tests/cache.test.ts (new),
src/server/domain/systemHealth.ts (+cache wrapper, +clearSystemHealthCache test hook),
tests/integration/system-health.test.ts (calls clearSystemHealthCache after seeding),
scripts/run-ingest-jobs.ts (new), package.json (+jobs:ingest-all script), docs/DECISIONS.md
(+M25 entry), docs/REVIEW_DEBT.md (+M25 row), docs/PROJECT_STATE.md, docs/CURRENT_TASK.md,
docs/SESSION_HANDOFF.md (this update).

TEST STATUS
155/155 pass with DATABASE_URL set, verified stable. Integration suite skips gracefully without
a DB.

NEXT EXACT ACTION
Start M26: read `src/server/domain/auth.ts` and `src/server/actions/auth.ts` end to end, check
the session cookie's flags (httpOnly/secure/sameSite) in the cookie-setting code, check
`scryptSync`'s parameters against Node's documented minimums, and make a concrete decision on
whether a minimal in-memory login-rate-limiter belongs in this pass. Fix what's found, add tests
for any new protection, verify login/signup still work end-to-end with Playwright.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored) — running `npm run
verify`/vitest/prisma commands via a fresh non-interactive Bash tool call does NOT always
inherit `.env` (Next.js's own dev/build process loads `.env` itself, but bare `vitest run` does
not) — `export DATABASE_URL=...` explicitly before those commands in this kind of session, this
was hit again this session. Remember `npx prisma generate` after every schema.prisma change. For
schema changes that add a unique constraint (or anything else ambiguous), `prisma migrate dev`
fails non-interactively — use `prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` to get the SQL, then hand-write it into
`prisma/migrations/<timestamp>_<name>/migration.sql` and apply with `prisma migrate deploy`.
vitest.config.mts has fileParallelism: false, and every integration test file must scope cleanup
to rows it owns. `playwright` is a devDependency — use it (not curl) to verify any Server Action
/ interactive flow in a real browser, launching with `executablePath:
'/opt/pw-browsers/chromium'`. Twenty-four commits pushed so far (M00-M24) to
origin/claude/market-os-development-7vnicg; M25 is about to be committed and pushed. No PR
opened yet (none requested). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it
without explicit human direction on LLM provider/funding/credentials. Standing user instruction
(2026-08-16, Korean): resume from last completed point, do not stop at milestone/phase
transitions, auto-fix test failures and Codex REVISE findings, continue through the entire
roadmap autonomously, only stop for genuine high-risk Human Gates requiring real user
intervention.
