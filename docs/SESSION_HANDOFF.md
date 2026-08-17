LAST COMPLETED

**Fourth round — interim, 2026-08-18.** 61 commits total, all local (HG-001). Baseline 338 → 379
tests. Details in `docs/INTERIM_REVIEW_FINDINGS.md` and `docs/LOCAL_AI_CALIBRATION.md`.

Codex usage is exhausted until 2026-08-22, so Ollama's `qwen3.5:4b` and `gemma3:4b` were
calibrated as stand-in reviewers and **both failed**: they reported defects in correct code on
every blind sample and never once returned `NO_SUPPORTED_DEFECT`. They are hypothesis generators
only. **This range has had no independent review** — say so to Codex rather than implying the
interim work was checked.

Two things worth carrying forward from this round:

- **Enumerate, don't probe.** Random adversarial probing found guardrail bypasses one at a time.
  Walking the pattern list for English-only concepts with no Korean mirror found ten in one pass.
  Standing rule now: a pattern added in one language must be added in the other, or recorded as
  not applicable.
- **The one safe use of a weak local model** is generating candidate inputs that a deterministic
  oracle scores. It cannot be wrong in that role because it never judges. Anything else needs
  re-calibration against a positive AND a negative control, recorded in LOCAL_AI_CALIBRATION.md.

Do not run the test suite while a model is resident in Ollama: 2.9 GB at 100% CPU on this 16 GB
machine pushed morning-brief past vitest's 5-second default timeout. `ollama stop <model>` first.

**Third hardening round, 2026-08-18.** Twelve commits on top of the 43 from the previous rounds —
55 total. Baseline moved 281 → 338 tests, e2e 28 → 30 checks against the production build.

Every finding this round came from working through this project's own review packet
(`docs/INDEPENDENT_REVIEW_PACKET.md`) rather than waiting for a reviewer. Two of them were in
code written the previous day.

- **Destructive-test DB selection now fails closed.** The old protection fell back to
  `DATABASE_URL`, so it only helped people who already knew they needed it. Now refuses on: no
  test DB named, same database as dev, a name not identifying itself as disposable, or a
  production-looking name. All four paths exercised against the real config, not just the pure
  function.
- **Fourth read-then-write race, in event ingest.** Reproduced first: four concurrent ingests of
  one URL rejected three of four with a raw P2002. `Event` and its first `EventMention` were also
  written non-atomically, so a failure between them left an Event claiming a mention that did not
  exist. Both now one transaction.
- **The no-database run never actually worked.** The Prisma client was built at module scope, so
  importing any module that touches the DB required `DATABASE_URL`; four unit files failed
  outright. Client is lazy now. A skipped suite that parsed the URL at describe scope was the
  fifth failure.
- **Fifth identity-representation mismatch**: `IngestRun.target` recorded the unpadded CIK while
  the data it describes is stored padded. Nothing joined them yet — and the completeness lookup
  built minutes later would have reported UNKNOWN forever, which reads as an unfinished feature
  rather than a broken join.
- **Truncation now reaches the reader.** `/company/[corpCode]` shows COMPLETE /
  KNOWN_INCOMPLETE (with shortfall) / LAST_RUN_FAILED / UNKNOWN.
- **Persisted errors leaked paths and source.** The DB password is NOT in Prisma errors (checked,
  not assumed) but the code frame is, and `ingest_runs.error` renders on /admin.
- **14 more Ask Market bypasses** — stop loss, entry/exit price, portfolio percentage, allocation,
  roleplay, "if you were me", quoted advisor, mixed Korean/English.
- **Unit vocabulary guard** — `computeChange` matches `unit === "percent"` exactly, so a
  "Percent" typo would silently disable basis points.

CURRENT TASK
None in progress. Every independent, unblocked release-hardening task identified has been
completed. What remains is gated — see `docs/HUMAN_GATE_QUEUE.md`.

CURRENT FAILURE
none.

TEST STATUS
All figures below were re-verified end to end at the close of the round, not carried forward.

379/379 (56 files) against a real local PostgreSQL 16.10, run against a disposable database.
`npm run e2e` 30/30 in a real browser against the production build.
`npm run verify:live:edgar` 67/67 against real data.sec.gov.
16 migrations apply cleanly to a genuinely fresh database, followed by a real ingest of 2240
filings and 1428 facts and an idempotent re-ingest (0 inserted, all unchanged).
With no database at all: 228 unit tests pass, 30 integration files skip cleanly.
Lint (0 problems, warnings included), typecheck, format and production build clean.

The dev database survived the full suite — checked afterwards by re-ingesting, which reported
everything unchanged. That is the guard working, and it is worth re-checking the same way after
any future change to test setup.

NEXT EXACT ACTION

1. **HG-001** — `git push origin claude/market-os-development-7vnicg`. 61 commits are local-only;
   this machine has no GitHub credential and cannot prompt. Nothing was rewritten, no force
   operation used.
2. **HG-005** — independent review. `codex-cli` IS installed and authenticated ("Logged in using
   ChatGPT"); the blocker is included-usage exhaustion resetting **2026-08-22**. Re-check once
   after that date, then run against `docs/INDEPENDENT_REVIEW_PACKET.md` **plus `a0eb92a..HEAD`**,
   which the packet predates. Give Terra the cross-file sweep IR-001/IR-002 imply: queries keyed
   on an identifier that is unique only within a source. Local AI is not a substitute — it was
   tried and disqualified.
3. **HG-002/003/004** — FRED/ECOS/OpenDART keys. All three hosts reachable and partially verified
   (request shape and error envelopes confirmed against the real APIs with deliberately invalid
   keys; no key leaked). The success shape — where EDGAR's drift hid — still needs a real key.
   `npm run verify:live:<provider>` is written and waiting for each.

IMPORTANT CONTEXT — LOCAL WINDOWS ENVIRONMENT

Start Postgres each session (it does not survive a reboot):

    .local\pgsql\bin\pg_ctl.exe -D .local\pgdata -l .local\pg.log -o "-p 55432 -c listen_addresses=127.0.0.1" -w start

Port 55432 deliberately. Superuser `postgres` / `devpassword`. Databases: `market_os_dev` (holds
real ingested SEC data — 2240 filings, 1428 facts) and `market_os_test` (disposable).

**Tests now REFUSE to run without `TEST_DATABASE_URL`.** That is deliberate and is the whole
point — set it and leave `DATABASE_URL` alone:

    $env:TEST_DATABASE_URL = 'postgresql://postgres:devpassword@127.0.0.1:55432/market_os_test?schema=public'

Setting `DATABASE_URL` as well is fine; the guard only refuses if it resolves to the same
database, an undisposable name, or nothing at all.

Run `npx prisma generate` after every schema change, and **restart `npm run dev`/`next start`
afterwards** — a running server holds the previously generated client, and a page touching a new
model fails at runtime while code, tests and build are all clean.

Two PowerShell 5.1 traps, both of which have bitten:

- Commit messages with double quotes get mangled by here-strings. Write to a scratchpad file and
  use `git commit -F <file>`.
- `Get-Content`/`Set-Content` round-trips **corrupt Korean text and em dashes** unless BOTH ends
  pass `-Encoding UTF8`. `tests/encoding-guard.test.ts` now fails the build if it happens again.

`core.autocrlf=true`, so `git status` lists nearly every file as modified. Line-ending noise
only — check `git diff --stat` before committing.

Do not run `npx prettier --write .` without checking `.prettierignore`: `.local` holds 322MB of
Postgres binaries.

Network egress works. SEC returns 403 for a User-Agent that is not roughly "<name> <email>";
`EDGAR_USER_AGENT` is set in `.env` to the user's own contact address with their approval.

Standing instructions: continue autonomously, never self-declare an independent review as passed,
never activate paid APIs or purchase credits, record Human Gates and keep working around them.
Status stays `RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES` until every condition in PROJECT_STATE is
actually met.

THE THING MOST WORTH CARRYING FORWARD

Across three rounds, almost every real defect was found by looking at a number and asking whether
it was plausible — not by reading code, and never by a failing test. A round 1000. 168 rows
"unchanged" against an empty table. 2240 filings and 933 facts with zero joinable rows. 244
net-income rows against 13 revenue rows. A +233% quarterly revenue increase. Three of four
concurrent calls rejected. If you ingest something new, look at what landed before trusting that
it landed correctly.
