LAST COMPLETED

**Fifth round — first real independent review, 2026-08-18.** 66 commits total, all local
(HG-001). Baseline 379 → 396 tests, 58 files.

**Codex access was restored by a plan upgrade.** Luna, Terra and Sol all probe AVAILABLE
(`docs/AI_REVIEW_RUNTIME_STATE.md`), so HG-005 is unblocked and this branch has finally had
independent eyes. Reviews ran **read-only** (`-s read-only`) — `codex exec` otherwise defaults to
`workspace-write` with `approval: never`, which would let a reviewer edit the tree.

Three defects came out of it, all reproduced before anything changed:

- **IR-009 (P1)** — `Math.round(days / 30.436875)` buckets a 13-week and a 14-week quarter both
  to 3 months. Real Apple data holds 492 quarters of 90 days beside 28 of 97, so Filing Diff
  reported **+54.29%** on a comparison where ~7.8% is just the extra week. Now discloses the day
  spans rather than refusing the comparison.
- **IR-010 (P2)** — `findRevisionChainTail` only threw when _every_ row was referenced, so a cycle
  beside an intact original returned the superseded value. DB-prevented, fixed anyway.
- **IR-011 (P3)** — `FilingDiffResult` was the output type missed when fixing IR-007/008.

Luna's full scoping matrix: **67 OK, 11 unscoped-safe, 1 risk, 1 output-gap** — discriminating,
not flag-everything, which is what made its two hits worth acting on.

Ollama's `qwen3.5:4b` and `gemma3:4b` remain **disqualified as reviewers** — they reported defects
in correct code on every blind sample and never once returned `NO_SUPPORTED_DEFECT`. Now that
Codex is available, prefer it for all real review; the local models keep only the one job where a
deterministic oracle grades them (Ask Market adversarial input generation).

**The first v2 implementation also landed**: the Reality Fabric read-only shadow projection
(`npm run fabric:shadow`). Nothing imports it, it writes nothing, and a test asserts row counts
are unchanged after a run. Against real dev data it immediately found the disagreement predicted
in `WORLD_DATA_FABRIC.md` — three series that `staleness.ts` calls STALE while `/admin` shows the
source healthy, one of them 220 days stale but retrieved yesterday. **Deliberately not "fixed":**
`systemHealth` measures ingestion recency and `staleness.ts` measures data currency; both are
accurate. The gap is that no operator view combines them, which is a Fabric concern rather than a
v1 freeze change. Recording that adjudication is what shadow mode is for.

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

396/396 (58 files) against a real local PostgreSQL 16.10, run against a disposable database.
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

1. **HG-001** — `git push origin claude/market-os-development-7vnicg`. 66 commits are local-only;
   this machine has no GitHub credential and cannot prompt. Nothing was rewritten, no force
   operation used.
2. **HG-005 — no longer blocked; now just unfinished.** Codex is available and the first pass is
   done (IR-009/010/011). What remains: the packet's A1–A14 have not all been covered. Sol has not
   been used at all — reserve it for the final Release Candidate adversarial pass and for any
   P0/P1. Always invoke with `-s read-only`.
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
