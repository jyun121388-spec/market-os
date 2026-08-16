LAST COMPLETED
M28: Release Candidate — closed with an honest BLOCKED status rather than a forced completion.
Ran a real cross-feature Claim Ledger audit: `verifyClaim` against all 11 real `Claim` rows in
the dev database (legitimate + deliberately-broken fixtures from `claimVerification.test.ts`) —
every legitimate claim VERIFIED, every broken one correctly rejected with the right failure code;
confirmed all 34 `Observation` rows have non-null `sourceId`/`retrievedAt`. Clarified (citing
`docs/ARCHITECTURE.md`'s actual wording) that Today Brief/Macro Regime not persisting a Claim per
page view is architecturally correct — the Claim Ledger covers AI-authored assertions, not every
raw sourced display. Logged two smaller open items (timezone/KST-boundary tests, user-facing
stale-data marking) as new `REVIEW_DEBT` rows rather than building them under time pressure.
`docs/RELEASE_CHECKLIST.md` now has its final honest per-item audit: everything achievable
without a human decision or a Codex session is closed; two genuine blockers remain (M21 Ask
Market — BLOCKED_HUMAN_GATE; Codex security review — PENDING, no Codex session available at any
point this entire session).

CURRENT TASK
None available to progress autonomously. The roadmap (M00-M28) has been worked as far as
possible without one of: (a) a human decision on M21's LLM provider/funding/credentials, (b) a
Codex session becoming available, (c) real API keys/reachable network for the data-source
REVIEW_DEBT items, or (d) production-deployment approval. See `docs/CURRENT_TASK.md` for the
exact resume conditions and next action once any of these change.

CURRENT FAILURE
none — this is a genuine stopping point (2 named Human Gates), not a failure state.

CHANGED FILES (since M27 commit)
docs/REVIEW_DEBT.md (+M28 timezone/KST row, +M28 stale-data-marking row),
docs/RELEASE_CHECKLIST.md (final honest audit: Claim Ledger item closed, overall-read updated),
docs/DECISIONS.md (+M28 entry), docs/PROJECT_STATE.md (status: BLOCKED_HUMAN_GATE, 2 named
blockers), docs/CURRENT_TASK.md, docs/SESSION_HANDOFF.md (this update).

TEST STATUS
157/157 unit/integration tests pass with DATABASE_URL set. `npm run e2e` (12/12 checks) verified
this session (M27). No code changes in M28 — audit and documentation only.

NEXT EXACT ACTION
See docs/CURRENT_TASK.md's "NEXT EXACT ACTION FOR A FUTURE SESSION." In short: check whether M21
or the Codex-review blocker has been resolved before doing anything else; if neither has, the
only available work is the smaller non-blocking REVIEW_DEBT items (timezone/KST tests,
stale-data marking, distributed rate limiting) — real and useful, but not roadmap-blocking.

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
e2e` (scripts/e2e-full-walkthrough.ts) is the persistent real-browser check; extend it rather
than writing new throwaway scripts. Twenty-seven commits pushed so far (M00-M27) to
origin/claude/market-os-development-7vnicg; M28 is about to be committed and pushed. No PR opened
yet (none requested — consider offering to open one now that the roadmap has reached its natural
stopping point, if the user hasn't already indicated otherwise). M21 remains BLOCKED_HUMAN_GATE —
do not attempt to unblock it without explicit human direction on LLM provider/funding/
credentials. No Codex session has been available at any point this session. Standing user
instruction (2026-08-16, Korean): resume from last completed point, do not stop at milestone/
phase transitions, auto-fix test failures and Codex REVISE findings, continue through the entire
roadmap autonomously, only stop for genuine high-risk Human Gates requiring real user
intervention — this session has now reached exactly that stopping point, with the reasoning
documented rather than the work simply halting.
