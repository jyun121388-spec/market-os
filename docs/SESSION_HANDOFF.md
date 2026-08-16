LAST COMPLETED
M26: Security Hardening, a self-review pass (no Codex session available in this environment for
the whole session so far — see docs/REVIEW_DEBT.md) against `src/server/domain/auth.ts` and
`src/server/actions/auth.ts`. Two concrete fixes: (1) session tokens (`Session.id`, which doubles
as the bearer token) are now generated explicitly via `crypto.randomBytes(32).toString("hex")`
instead of relying on Prisma's `@default(cuid())`, which is designed for collision-resistance
not unpredictability; (2) `signIn` now locks out an email after 5 failed attempts within 15
minutes (in-memory, process-local — no new hosted service, matching M25's pattern), returning
the identical "Invalid email or password" message whether wrong-password or locked-out so the
lockout itself can't be used to enumerate accounts. Cookie flags (httpOnly/secure-in-production/
sameSite:lax) and scrypt parameters (N=16384/r=8/p=1) were reviewed and found already correct —
no change needed there. CSRF was reviewed and confirmed to be handled by Next.js Server Actions'
built-in same-origin enforcement, not something this project needs to implement itself.
Distributed/IP-level rate limiting is explicitly out of scope (would need shared infra) — logged
as a new REVIEW_DEBT row, not silently skipped. Verified with new integration tests (session
token format, lockout-then-reset) AND a real Playwright browser session against `npm run dev`
(64-char hex cookie confirmed, 5 wrong attempts then a 6th CORRECT-password attempt still
rejected). 157/157 tests pass, full verify chain green.

CURRENT TASK
M27: Production QA — see docs/CURRENT_TASK.md. Scoped to one persistent, version-controlled
Playwright test file covering the full real user walkthrough (signup → login → /today → /admin
→ logout → wrong-password → lockout → session expiry), plus an honest pass over
docs/RELEASE_CHECKLIST.md comparing its criteria to actual current state.

CURRENT FAILURE
none

CHANGED FILES (since M25 commit)
src/server/domain/auth.ts (+explicit session-token generation, +login-lockout tracking,
+resetLoginAttemptTracking test hook), tests/integration/auth.test.ts (+2 new test cases),
docs/DECISIONS.md (+M26 entry), docs/REVIEW_DEBT.md (+M26 row, updated M01-M22 row),
docs/PROJECT_STATE.md, docs/CURRENT_TASK.md, docs/SESSION_HANDOFF.md (this update).

TEST STATUS
157/157 pass with DATABASE_URL set, verified stable. Integration suite skips gracefully without
a DB.

NEXT EXACT ACTION
Start M27: read docs/RELEASE_CHECKLIST.md (if present) for its actual criteria, then write a
persistent `tests/e2e/full-walkthrough.spec.ts` (or similar path) exercising the complete real
user flow end-to-end with Playwright, run it for real against `npm run dev`, then update
RELEASE_CHECKLIST.md honestly against current state.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored) — bare `vitest run`/`prisma`
commands via a non-interactive Bash tool call do NOT inherit `.env` automatically; `export
DATABASE_URL=...` first. Remember `npx prisma generate` after every schema.prisma change. For
schema changes that add a unique constraint (or anything else ambiguous), `prisma migrate dev`
fails non-interactively — use `prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` to get the SQL, hand-write it into
`prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `prisma migrate deploy`.
vitest.config.mts has fileParallelism: false, and every integration test file must scope cleanup
to rows it owns. `playwright` is a devDependency, browser at `/opt/pw-browsers/chromium` — ad hoc
verification scripts so far have been written to a temp file INSIDE the repo root (not /tmp,
since /tmp is outside the module resolution the script doesn't need but node require() there
failed for the `playwright` package — resolved by writing the throwaway script into the repo
root, which has node_modules, then deleting it after) and deleted immediately after use; M27
should instead make one of these persistent as a real committed test file rather than continuing
to write-and-delete throwaway scripts every milestone. Twenty-five commits pushed so far (M00-
M25) to origin/claude/market-os-development-7vnicg; M26 is about to be committed and pushed. No
PR opened yet (none requested). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it
without explicit human direction on LLM provider/funding/credentials. Standing user instruction
(2026-08-16, Korean): resume from last completed point, do not stop at milestone/phase
transitions, auto-fix test failures and Codex REVISE findings, continue through the entire
roadmap autonomously, only stop for genuine high-risk Human Gates requiring real user
intervention.
