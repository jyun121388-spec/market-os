LAST COMPLETED
Post-M28 non-blocking follow-up: per CLAUDE.md's "switch to the next independent task" rule
(M21 and the Codex review both still blocked), closed the two smaller REVIEW_DEBT items M28 had
logged as open. Timezone/KST: audited every date-only parser (ECOS/DART) — both were already
correctly UTC-safe (`Date.UTC(...)`), added dedicated boundary tests (Korean New Year's Eve/Day,
leap day, year/quarter boundaries) to lock that in; also found and fixed a REAL bug the audit
surfaced — `/today` and `/admin` rendered timestamps with `.toLocaleString()` inside a Next.js
Server Component, which resolves using the SERVER's local timezone, not the viewer's; replaced
with an explicit `formatTimestampUtc()` helper (`src/lib/formatDate.ts`). Stale-data marking:
added `src/server/domain/staleness.ts` (`evaluateStaleness`, reusing Economic Calendar's
existing cadence-projection logic) wired into `buildMorningBrief` and a visible "STALE" badge on
`/today`. Verified with new unit tests, a new integration test seeding real stale/fresh series,
and a live check against `npm run dev` (seeded a real stale series in the dev DB, confirmed the
badge rendered via a real HTTP request, cleaned up after). 173/173 tests pass, full verify chain
green. `docs/REVIEW_DEBT.md`'s two M28 rows are now marked DONE (not deleted — kept as a record
of what was found and fixed) and `docs/RELEASE_CHECKLIST.md` reflects both items closed.

CURRENT TASK
None available to progress the core roadmap autonomously. Only two blockers remain, both
outside this session's ability to resolve unilaterally: (a) a human decision on M21 Ask Market's
LLM provider/funding/credentials, (b) a Codex session becoming available for the security review
owed since M22. See `docs/CURRENT_TASK.md` for exact resume conditions. Smaller optional,
genuinely non-blocking REVIEW_DEBT items remain (M26's distributed/IP-level rate limiting; the
various data-source live-verification rows, all gated on real API keys/reachable network) if
more independent work is wanted, but they're lower-value than what was just closed.

CURRENT FAILURE
none — this is a genuine stopping point (2 named Human Gates), not a failure state.

CHANGED FILES (since M28 commit)
src/lib/formatDate.ts (new), src/app/today/page.tsx (+STALE badge, UTC timestamp fix),
src/app/admin/page.tsx (UTC timestamp fix), src/server/domain/staleness.ts (new),
src/server/domain/morningBrief.ts (+staleness field on whatChanged entries),
tests/formatDate.test.ts (new), tests/staleness.test.ts (new), tests/adapters/ecos-normalize.test.ts
(+KST boundary tests), tests/adapters/dart-normalize.test.ts (+KST boundary tests),
tests/integration/morning-brief.test.ts (+staleness integration coverage), docs/REVIEW_DEBT.md
(2 rows marked DONE), docs/RELEASE_CHECKLIST.md (2 items closed), docs/DECISIONS.md (+entry),
docs/PROJECT_STATE.md, docs/SESSION_HANDOFF.md (this update).

TEST STATUS
173/173 tests pass with DATABASE_URL set (87 unit, 86 integration), verified stable. `npm run
e2e` still passes (unaffected by these changes — re-run if touching auth/admin again).

NEXT EXACT ACTION
Check whether M21 or the Codex-review blocker has been resolved before doing anything else on
the core roadmap. If neither has, the remaining optional non-blocking work is: M26's
distributed/IP-level rate limiting (needs a shared-infra decision — likely also worth flagging
as a small Human Gate rather than building against an unstated infra choice), or picking up any
data-source PENDING row in REVIEW_DEBT.md if real API keys/network become available.

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
than writing new throwaway scripts (any ad hoc verification script should be written inside the
repo root, since node's module resolution for `playwright` needs `node_modules`, then deleted
after use — this session again used and cleaned up `seed-stale.tmp.ts`/`cleanup-stale.tmp.ts`
this way). Twenty-eight commits pushed so far (M00-M28) to
origin/claude/market-os-development-7vnicg; this post-M28 follow-up is about to be committed and
pushed. No PR opened yet (none requested — consider offering to open one, the roadmap has reached
its natural stopping point). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it
without explicit human direction on LLM provider/funding/credentials. No Codex session has been
available at any point this session. Standing user instruction (2026-08-16, Korean): resume from
last completed point, do not stop at milestone/phase transitions, auto-fix test failures and
Codex REVISE findings, continue through the entire roadmap autonomously, only stop for genuine
high-risk Human Gates requiring real user intervention — the roadmap itself has reached that
stopping point; this session picked up additional independent non-blocking work per that same
instruction rather than idling.
