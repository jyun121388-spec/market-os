LAST COMPLETED
M22: Auth / User System. Built `src/server/domain/auth.ts` from scratch (Node's built-in
`crypto.scryptSync` for password hashing — no third-party auth library; see docs/DECISIONS.md
for the reasoning). Migration `20260816001500_auth` adds `email`/`passwordHash` to `User` and a
new `Session` model (opaque bearer token = the row's id, validated by DB lookup — no JWT, no
signing secret, revocation is deleting the row). `signIn` returns an identical error message
regardless of whether the email or password was wrong (no user-enumeration signal).

Real pages shipped: `/signup`, `/login` (client components using React 19's `useActionState`
with server actions in `src/server/actions/auth.ts`), and `/today` now shows the logged-in
user's email + a logout link, or a login link when signed out.

Verified the FULL real flow with Playwright driving an actual browser against `npm run dev` —
not just tests: signup creates a session and redirects to `/today` with the email visible;
logout clears the session and redirects to `/login`; a wrong password is rejected with the
correct error while staying on the login page. `curl` could NOT be used for this (it can't
drive a Next.js Server Action directly — confirmed by an actual 500 error first, diagnosed, and
switched to Playwright, which was added as a devDependency; the browser binary was already
pre-installed in this environment). 137/137 tests pass (52 unit + 85 integration against a real
local Postgres, stable across repeated runs). Full verify chain green, all 5 routes (/,
/signup, /login, /today, /_not-found) build correctly.

Migration note for future sessions: `prisma migrate dev` fails in this non-interactive shell
whenever there's an ambiguous-change warning (e.g. adding a unique constraint) — even with
`--create-only`. Workaround used: `prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` to get the raw SQL, then hand-write it into a
`prisma/migrations/<timestamp>_<name>/migration.sql` file (following the existing timestamp
format) and apply with `prisma migrate deploy` (non-interactive-safe). Worth repeating for any
future schema change that isn't a trivial additive one.

CURRENT TASK
M23: Subscription-ready architecture — see docs/CURRENT_TASK.md. Real question to resolve
before coding: no feature currently gates on a paid tier, so there may be nothing real to build
yet beyond a minimal forward-compatible placeholder (leaning toward a small `plan` field +
always-true entitlement helper, mirroring the M19 User-model precedent) — confirm the
reasoning holds, don't default to adding a field out of momentum.

CURRENT FAILURE
none

CHANGED FILES (since M20 commit)
prisma/schema.prisma (+email/passwordHash on User, +Session model),
prisma/migrations/20260816001500_auth/, src/server/domain/auth.ts (new),
src/server/actions/auth.ts (new), src/app/signup/page.tsx (new), src/app/login/page.tsx (new),
src/app/today/page.tsx (shows logged-in state), tests/auth.test.ts (new),
tests/integration/auth.test.ts (new), tests/integration/watchlist.test.ts (fixed to supply
email/passwordHash for its test User), package.json (+playwright devDependency).

TEST STATUS
137/137 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB. `/signup` → `/login` → `/today` flow verified via a real
Playwright browser session, not just automated tests.

NEXT EXACT ACTION
Resolve the M23 scoping question in docs/CURRENT_TASK.md (add minimal plan field + entitlement
helper, or defer to M24) and record the decision in DECISIONS.md before writing any code.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change, AND use the migrate-diff-then-hand-write-SQL
workaround above for any non-trivial schema change (adding unique constraints, etc.) since
`prisma migrate dev` fails non-interactively for those. vitest.config.mts has
fileParallelism: false, and every integration test file must scope cleanup to rows it owns.
Twenty-one commits pushed so far (M00-M20) to origin/claude/market-os-development-7vnicg; M22
is about to be committed and pushed (M21 skip is already recorded in the M20 commit). No PR
opened yet (none requested). Auth is flagged in REVIEW_DEBT.md with extra emphasis as
Codex-review-required (security-sensitive) per AGENTS.md's stated scope — prioritize this if a
Codex session ever becomes available in a future session.
