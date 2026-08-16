LAST COMPLETED

Night autonomous run, 2026-08-17. Fourteen commits on top of `6cb74fc`, none pushed (HG-001).
Baseline moved 209 → 247 tests, e2e 12 → 22 checks, live EDGAR contract checks 0 → 59.

The through-line: development moved from the Claude Code Web sandbox to a local Windows machine
with a real PostgreSQL 16.10, a real browser and real network egress. Every defect below was
found by running or reading work that the cloud environment had already reported as green.

Local-environment round (`5ea3b9b`, `de49452`, `49f1483`, `4d33f6d`, `9b20f01`):

- The H3 concurrency fix from the Codex REVISE round **was itself defective**. It found the
  revision chain's tail with `orderBy: retrievedAt desc` on a `timestamp(3)` column, so an
  original and its revision written in the same millisecond were indistinguishable. Not
  concurrency-only — a sequential re-ingest reproduced it. Re-fixed structurally: the tail is
  the row nothing else points at via `revisionOf`.
- The H1 migration-upgrade regression test had never executed on Windows (`npx` ENOENT/EINVAL),
  so it reported as a passing file while asserting nothing.
- `run-ingest-jobs.ts` spawned `npm`; `spawnSync` returns `status: null` rather than throwing,
  so every job would have read as FAILED instead of never-started.
- Real SEC schema drift: `fy: null, fp: null` on some companyfacts rows against non-nullable
  columns. Widened, not guessed.
- M19 Watchlist got its first real request path.

Hardening round (`e0eecf6`, `d590c11`, `3fd6533`, `eeeb9ba`, `453962f`, `af942f9`, `fe511e2`,
`19221e0`, `7407ec3`):

- **EDGAR was storing 45% of Apple's filing history.** `filings.recent` is capped by SEC at
  1000; everything older spills into `filings.files[]`, which the adapter never fetched. Real
  ingest went 1000 filings (oldest 2015-06-04) → 2240 (oldest 1994-01-26). Note this got past
  the live contract check the day before, which verified shape, printed "1000 recent filings"
  as an info line, and called it VERIFIED. Shape verification is not completeness verification,
  and a round number should be read as a cap.
- Silent pagination truncation in all three keyed adapters (FRED `count`, ECOS
  `list_total_count`, DART `total_page` — each received and ignored). Found by code reading.
- Watchlist audit: an unused exported server action (a "use server" export is a reachable
  endpoint whether or not a page calls it), no per-user row cap, and an upsert that could
  surface a raw P2002 under concurrent submission.
- 14 real bypasses closed in the Ask Market buy/sell guardrail, including "price target" — the
  reverse word order of the covered "target price", and an explicitly prohibited output — plus
  two bypasses the Codex packet itself had documented as open. Seven analytical controls guard
  the opposite failure.
- The impossible-date guard from 2026-08-16 had only reached FRED and ECOS; DART, EDGAR
  submissions and EDGAR XBRL were all missed. All four adapters now share it.
- The XBRL normalizer reported nothing about what it dropped; it now matches FRED/ECOS's
  `skippedMissing` convention.
- `tests/integration-coverage-guard.test.ts`: with `DATABASE_URL` unset, all 25 integration
  files skip themselves and the run still reports green. Now fails loudly in CI.

CURRENT TASK
None in progress. Everything unblocked has been done; remaining work is gated — see
`docs/HUMAN_GATE_QUEUE.md` (HG-001..HG-008) and docs/CURRENT_TASK.md.

CURRENT FAILURE
none.

TEST STATUS
247/247 against a real local PostgreSQL 16.10. `npm run e2e` 22/22 in a real browser.
`npm run verify:live:edgar` 59/59 against real data.sec.gov. Lint, typecheck, format and
production build all clean. Full suite ~25s.

NEXT EXACT ACTION

1. HG-001: `git push origin claude/market-os-development-7vnicg` once GitHub auth exists. 14
   commits are local-only. Nothing was rewritten; no force operation was attempted.
2. HG-002/003/004: when a FRED/ECOS/OpenDART key lands, run `npm run verify:live:<provider>`
   then the full sequence in docs/RELEASE_READINESS.md's header before classifying it
   LIVE_VERIFIED. Expect drift — EDGAR had it twice.
3. HG-005: Codex re-review, scope `9b34f8b..HEAD`, per docs/CODEX_REVIEW_PACKET.md §0.1.

IMPORTANT CONTEXT — LOCAL WINDOWS ENVIRONMENT

Postgres is a portable install, not a service. `.local/pgsql` (gitignored, ~322MB, EnterpriseDB
binaries-only zip — no installer, no admin, no Docker). Start each session with:

    .local\pgsql\bin\pg_ctl.exe -D .local\pgdata -l .local\pg.log -o "-p 55432 -c listen_addresses=127.0.0.1" -w start

Port 55432 deliberately, to avoid colliding with any system Postgres. Superuser `postgres` /
`devpassword`, database `market_os_dev`. Deleting `.local/` reverses the whole thing.

Bare `vitest`/`prisma` do NOT inherit `.env` — set `$env:DATABASE_URL` first. Run
`npx prisma generate` after every schema change.

`core.autocrlf=true`, so `git status` lists nearly every file as modified. Line-ending noise
only — check `git diff --stat`, not `git status`, before committing.

Two PowerShell 5.1 traps, both of which cost time tonight:

- Commit messages with double quotes get mangled by here-strings. Write the message to a
  scratchpad file and use `git commit -F <file>`.
- `Get-Content`/`Set-Content` round-trip **corrupts Korean text** (reads as ANSI). Never rewrite
  a file containing Hangul that way — use the Edit tool. This silently mangled a test file's
  Korean strings into an invalid regex before being caught.

Do not run `npx prettier --write .` without checking `.prettierignore` — `.local` holds 322MB of
Postgres files. `.local/` and `.tmp-test-artifacts/` are excluded from prettier and eslint.

**Restart `npm run dev` after `npx prisma generate`.** A running dev server holds the old
generated client, so any page touching a newly added model fails at runtime while the code,
tests, typecheck and build are all clean. This presented as four `/admin` e2e checks failing
together — including two that had passed minutes earlier — which reads like a regression and is
not one.

Playwright: `npx playwright install chromium`, standard `%LOCALAPPDATA%\ms-playwright` cache.
`PLAYWRIGHT_CHROMIUM_PATH` overrides only if needed. `npm run e2e` needs `npm run dev` running.

Network egress works. SEC returns 403 for a User-Agent that is not roughly "<name> <email>";
`EDGAR_USER_AGENT` is set in `.env` to the user's own contact address with their explicit
approval (2026-08-17).

The dev database is shared with the test suite, and several integration tests delete rows by
`corpCode` in `beforeAll`. After running the full suite, real ingested EDGAR data is partly
cleared — re-run `npx tsx scripts/ingest-edgar.ts` if you need it back. Not a defect, but
surprising if unexpected.

Standing user instructions: continue autonomously, never self-declare Codex APPROVE, never
activate paid APIs or services, record Human Gates in the queue and keep working around them.
Do not promote status to RELEASE_CANDIDATE_READY until every condition in PROJECT_STATE is met.
