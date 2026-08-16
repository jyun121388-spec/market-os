LAST COMPLETED
M27: Production QA. Shipped `scripts/e2e-full-walkthrough.ts` (`npm run e2e`) — a persistent,
committed, real-browser Playwright script covering the full user path in one continuous session
(unauthenticated `/admin` redirect → signup → session-cookie shape check → authenticated
`/admin` → logout → wrong-password rejection → M26's five-attempt lockout → expired-session
redirect), replacing this session's prior pattern of writing and deleting throwaway verification
scripts each milestone. Run for real against `npm run dev` this session: all 12 checks passed.
Also did an honest, item-by-item audit of `docs/RELEASE_CHECKLIST.md` against actual current
state (it had never been touched before) — surfaced two genuine Release-Candidate blockers (M21
Ask Market BLOCKED_HUMAN_GATE; no Codex security review has happened, no Codex session available
this entire session) plus two smaller open items (timezone/KST-boundary test coverage; user-
facing stale-data marking — distinct from M24's operator-facing pipeline health view). 157/157
unit/integration tests pass, full verify chain green.

CURRENT TASK
M28: Release Candidate — see docs/CURRENT_TASK.md. Cannot be honestly declared DONE while M21
and the Codex review remain blocked; scoped to closing what IS achievable (Claim Ledger
cross-feature provenance audit, timezone/KST tests, stale-data marking) and writing an accurate
final status rather than papering over the two genuine blockers.

CURRENT FAILURE
none

CHANGED FILES (since M26 commit)
scripts/e2e-full-walkthrough.ts (new), package.json (+e2e script), docs/RELEASE_CHECKLIST.md
(full honest audit, previously untouched template), docs/DECISIONS.md (+M27 entry),
docs/PROJECT_STATE.md, docs/CURRENT_TASK.md, docs/SESSION_HANDOFF.md (this update).

TEST STATUS
157/157 unit/integration tests pass with DATABASE_URL set. `npm run e2e` (12/12 checks) run for
real against a live `npm run dev` server this session — not part of `npm run verify`/CI since it
needs a running dev server as a precondition; run manually when verifying auth/admin flows.

NEXT EXACT ACTION
Start M28: do a Claim Ledger cross-feature provenance audit (trace one real Today-Brief claim
and one Macro-Regime reading back to their stored Observation/Source, confirm `verifyClaim`
accepts them) — pure verification, no new code needed if it passes. Then decide concretely on
timezone/KST test coverage and user-facing stale-data marking (build or explicitly log as
scoped-out, record either way in DECISIONS.md). Finish with an honest M28 status entry stating
the two remaining Human-Gate blockers plainly.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored) — bare `vitest run`/`prisma`
commands via a non-interactive Bash tool call do NOT inherit `.env` automatically; `export
DATABASE_URL=...` first. Remember `npx prisma generate` after every schema.prisma change. For
schema changes that add a unique constraint (or anything else ambiguous), `prisma migrate dev`
fails non-interactively — use `prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` to get the SQL, hand-write it into
`prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `prisma migrate deploy`.
vitest.config.mts has fileParallelism: false, every integration test file must scope cleanup to
rows it owns. `playwright` is a devDependency, browser at `/opt/pw-browsers/chromium` — `npm run
e2e` (scripts/e2e-full-walkthrough.ts) is now the persistent real-browser check; prefer extending
it over writing new throwaway scripts. Twenty-six commits pushed so far (M00-M26) to
origin/claude/market-os-development-7vnicg; M27 is about to be committed and pushed. No PR opened
yet (none requested). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it without
explicit human direction on LLM provider/funding/credentials. No Codex session has been available
at any point this session — the security-review and Codex-critical-review checklist items stay
open until one is. Standing user instruction (2026-08-16, Korean): resume from last completed
point, do not stop at milestone/phase transitions, auto-fix test failures and Codex REVISE
findings, continue through the entire roadmap autonomously, only stop for genuine high-risk
Human Gates requiring real user intervention.
