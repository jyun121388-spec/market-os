LAST COMPLETED
Moved development from the Claude Code Web sandbox to a local Windows/VS Code machine and ran
everything the sandbox could not. Four commits on top of `6cb74fc`:

- `5ea3b9b` — three defects found by running the suite on real infrastructure: the
  revision-chain race in `observationIngest.ts` (see below), `run-ingest-jobs.ts` spawning
  `npm` (ENOENT on Windows, and `spawnSync` reports it as a normal FAILED job rather than
  throwing), and the H1 migration-upgrade test spawning `npx` (ENOENT/EINVAL on Windows, so
  that regression had never actually executed on this platform).
- `de49452` — M19 Watchlist's real request path: `src/server/actions/watchlist.ts` +
  `/watchlist`, 8 new integration tests through the session boundary, real-browser e2e
  coverage, and `PLAYWRIGHT_CHROMIUM_PATH` replacing the hardcoded `/opt/pw-browsers/chromium`.
- `49f1483` — `scripts/verify-edgar-live.ts`, a live contract check for both EDGAR adapters.
- `4d33f6d` — the schema drift that check found, fixed end to end.

The revision-chain one is worth reading carefully, because it means the H3 fix from the Codex
REVISE round was itself wrong. It found the chain's "latest" row with
`orderBy: { retrievedAt: "desc" }`. Prisma maps DateTime to `timestamp(3)`, so an original and
its revision written in the same millisecond get identical timestamps and Postgres may return
either first. On the wrong ordering the code compared the incoming value against the ORIGINAL,
decided a revision was needed, tried to attach a second child to a parent that already had one,
and threw a raw P2002 after burning all 20 retries. Not concurrency-only — a plain sequential
re-ingest of already-revised data hit it. The tail is now found structurally: the row nothing
else points at via `revisionOf`, which the existing 4-column unique constraint makes
unambiguous no matter how coarse the timestamps are.

The EDGAR drift: SEC returns `fy: null, fp: null` on some companyfacts rows (facts republished
for a `frame` under a later restating filing). Types and DB columns were non-nullable, so a real
ingest would have failed on the first one — Apple alone has 20 across the six tracked concepts.
Widened rather than dropped, because the fact is fully sourced and only the label is missing;
deriving a fiscal year from `periodEnd` would store an inference as reported data.

CURRENT TASK
None in progress. Next work is gated on the three free API keys — see docs/CURRENT_TASK.md.

CURRENT FAILURE
none.

TEST STATUS
218/218 against a real local PostgreSQL 16.10 (was 209 in the cloud env). `npm run e2e` 17/17
in a real browser (was 12). Lint, typecheck, format, production build all clean. Live EDGAR
contract check 55/55 against real data.sec.gov.

NEXT EXACT ACTION
See docs/CURRENT_TASK.md. Short version: if a FRED/ECOS/OpenDART key has arrived, live-verify
that adapter using `scripts/verify-edgar-live.ts` as the template and expect to find drift. If
not, there is no further live-verification work — say so rather than inventing scope.

IMPORTANT CONTEXT — LOCAL WINDOWS ENVIRONMENT (this supersedes the old Linux-sandbox notes)

Postgres is a portable install, not a service. It lives in `.local/pgsql` (gitignored, ~322MB,
downloaded from EnterpriseDB's binaries-only zip — no installer, no admin rights, no Docker).
Start it each session with:

    .local\pgsql\bin\pg_ctl.exe -D .local\pgdata -l .local\pg.log -o "-p 55432 -c listen_addresses=127.0.0.1" -w start

Port 55432 deliberately, to avoid colliding with any system Postgres. Superuser `postgres` /
`devpassword`, database `market_os_dev`. `DATABASE_URL` is in `.env` (gitignored). Deleting
`.local/` reverses the whole thing. Stop with the same `pg_ctl` and `stop`.

Bare `vitest`/`prisma` invocations do NOT inherit `.env` — set `$env:DATABASE_URL` first in the
PowerShell session. Run `npx prisma generate` after every schema.prisma change.

Do NOT use `npx prettier --write .` without checking `.prettierignore` first — `.local` holds
322MB of Postgres files and prettier will try to walk all of it. `.local/` and
`.tmp-test-artifacts/` are now excluded from both prettier and eslint.

`core.autocrlf=true` on this machine, so `git status` lists nearly every file as modified. This
is line-ending noise only — `git diff --stat` shows the real content changes, and git normalizes
to LF on the index side, so commits are clean. Check `git diff --stat`, not `git status`, before
committing. Repo-local git identity is set to `Claude <noreply@anthropic.com>` to match history.

PowerShell here-strings mangle git commit messages containing double quotes. Write the message
to a scratchpad file and use `git commit -F <file>`.

Playwright: browsers installed via `npx playwright install chromium` to the standard
`%LOCALAPPDATA%\ms-playwright` cache. `scripts/e2e-full-walkthrough.ts` no longer hardcodes a
path — set `PLAYWRIGHT_CHROMIUM_PATH` only if you need to override it. `npm run e2e` requires
`npm run dev` already running in another shell.

Network egress works from here. data.sec.gov, api.stlouisfed.org, ecos.bok.or.kr and
opendart.fss.or.kr are all reachable — the `LIVE_VERIFICATION_REQUIRED` labels were about the
old sandbox, not the adapters. SEC returns 403 for a User-Agent that is not roughly
"<name> <contact email>"; a bare product name or repo URL is rejected. `EDGAR_USER_AGENT` is set
in `.env` to the user's own contact address, with their explicit approval on 2026-08-17.

Standing user instructions still in force: continue autonomously through the roadmap, do not
stop at milestone/phase transitions or ask for routine approval, never self-declare Codex
APPROVE, never activate paid APIs or services, and stop only for genuine Human Gates. The user
approved obtaining free FRED/ECOS/OpenDART keys themselves (2026-08-17) — those are pending
their action, not blocked on anything here. PR-status polling remains stopped.
