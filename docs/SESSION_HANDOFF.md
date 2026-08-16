LAST COMPLETED
A human ran the local-Codex review path (docs/CODEX_REVIEW_PACKET.md §12, prepared in a prior
session) and relayed a real verdict: REVISE, with 3 P0/HIGH blockers (auth migration upgrade
safety, claim verification substring collision, concurrent observation ingestion race) and 3
recommended P1/MEDIUM items. Per explicit instruction, Claude implemented every fix directly
(Codex quota reserved, not spent on implementation), each with a dedicated real-Postgres
regression test — see docs/DECISIONS.md's 2026-08-16 "Fixed all 3 P0 blockers from the first
real Codex REVISE verdict" entry for exact BEFORE/AFTER/regression-test/changed-files per
blocker, and docs/CODEX_REVIEW_PACKET.md §0 for the same information restructured for a
re-reviewer. Full verification chain re-run and green: 209/209 tests (up from 184), npm run e2e
12/12, lint/typecheck/build clean. Explicitly did NOT self-declare APPROVE — stopped at
[CODEX RE-REVIEW READY] per instruction.

CURRENT TASK
None — this is the terminal state for this fix round. The next action is a Codex RE-REVIEW
(not further autonomous code changes) against fix-round HEAD
8f4f76ca74e01f1b9541a7f7295521f3eda08803, using docs/CODEX_REVIEW_PACKET.md §12 (updated for
this round, scoped to §0's fix-round diff first). If that re-review returns REVISE again, resume
the same fix-loop discipline this round used. If APPROVE, follow §15's status-update procedure.

CURRENT FAILURE
none — this is a genuine stopping point (awaiting external Codex re-review), not a failure state.

CHANGED FILES (this pass)
Code/tests (commit 8f4f76ca74e01f1b9541a7f7295521f3eda08803, parent 9b34f8bb6be120dacd381fe22577870f40d6e5fa):
prisma/schema.prisma, prisma/migrations/20260816001500_auth/migration.sql (rewritten in place —
never applied to any real external deployment), prisma/migrations/20260816090000_original_observation_unique/
(new), src/server/domain/auth.ts, src/server/domain/claimStore.ts,
src/server/domain/claimVerification.ts, src/server/domain/whatChanged.ts,
src/server/domain/observationIngest.ts, src/server/domain/askMarket.ts,
src/server/adapters/httpTimeout.ts (new), src/server/adapters/dateValidation.ts (new),
src/server/adapters/{fred,ecos,dart,edgar,edgar-xbrl}/client.ts, src/server/adapters/{fred,ecos}/normalize.ts,
scripts/run-ingest-jobs.ts, plus matching test files (see commit for full list) — 28 files
changed total.
Docs (this commit, separate per project convention — code commits and doc commits stay
distinct): docs/DECISIONS.md, docs/REVIEW_DEBT.md, docs/RELEASE_READINESS.md,
docs/CODEX_REVIEW_PACKET.md, docs/PROJECT_STATE.md, docs/SESSION_HANDOFF.md (this file).

TEST STATUS
209/209 tests pass (up from 184 — 25 new regression tests this round), npm run e2e 12/12,
lint clean, typecheck clean, production build succeeds. All re-run at fix-round HEAD after every
individual fix and again as a full chain at the end, per the exact verification order specified
by the user (targeted test -> related integration test -> full suite -> migration-upgrade
regression -> concurrency regression -> claim adversarial regression -> e2e -> lint -> typecheck
-> full release verification). The stale "184 tests" count was NOT used as the success
criterion — each of Codex's 3 named failure modes was reproduced against the pre-fix code path
(by reading it) and confirmed closed by its new dedicated regression test.

NEXT EXACT ACTION
Wait for a human to run the Codex re-review (docs/CODEX_REVIEW_PACKET.md §12) and produce
reviews/market-os-final-review.json. Do not self-declare APPROVE. Do not resume PR-status
polling (still stopped per the 2026-08-16 instruction) — only act on a real inbound GitHub
webhook event, an explicit user follow-up, or a produced review result. If asked to "continue"
with no new information, report this exact status rather than inventing new scope.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored) — bare `vitest run`/`prisma`
commands via a non-interactive Bash tool call do NOT inherit `.env` automatically; `export
DATABASE_URL=...` first. Remember `npx prisma generate` after every schema.prisma change (this
round required it after adding `isLegacyAccount`, or Prisma Client validation errors on the new
field). `prisma migrate reset --force` is hard-blocked by Prisma's own AI-agent safety guard and
requires fresh, explicit human consent every time — before ever running it, check whether a
non-destructive alternative exists first (this round's H1 fix used a plain `ALTER TABLE ADD
COLUMN` + a manual `_prisma_migrations` checksum reconciliation instead, since the local dev DB's
actual column state already matched everything except the one new column). For schema changes
needing hand-written SQL, `prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` gets the SQL; apply with `prisma migrate deploy`.
vitest.config.mts has fileParallelism: false, every integration test file must scope cleanup to
rows it owns. A real-Postgres migration-upgrade test (new this round,
tests/integration/auth-migration-upgrade.test.ts) creates/drops its own throwaway database
(`market_os_migration_upgrade_test`) via the `pg` package directly and runs `prisma migrate
deploy --config <generated temp config>` as a subprocess — the generated temp
`prisma.config.ts` must live under the repo's own node_modules resolution chain (a
`.tmp-test-artifacts/` dir under the repo root, gitignored), not a bare OS tmpdir, or Prisma's
config loader can't resolve `require("prisma/config")`. `playwright` is a devDependency, browser
at `/opt/pw-browsers/chromium` — `npm run e2e` (scripts/e2e-full-walkthrough.ts) requires `npm
run dev` running first in another process/shell. Standing user instruction (2026-08-16, Korean,
this round): accept Codex REVISE as authoritative, never self-declare APPROVE/merge/production
deployment, Claude implements fixes directly (Codex quota limited, don't delegate back to it),
fix all P0s completely with the specific regression scenarios named, fix P1s if reasonably sized
without weakening P0 verification, record LOW items as debt rather than force-implementing every
limitation, verify in the specified order without trusting the stale test count, update the
Codex review packet to prioritize the fix diff so a re-reviewer doesn't need to re-read the whole
repo, and stop at exactly "[CODEX RE-REVIEW READY]" reporting the exact HEAD SHA and re-review
scope. PR-status polling remains stopped (separate, still-standing 2026-08-16 instruction) — do
not re-arm it as part of resuming work on this fix round.
