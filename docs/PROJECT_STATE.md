CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00-M28 (see docs/RELEASE_READINESS.md for the precise, honest per-subsystem status — this
section is intentionally brief; that document is the source of truth for readiness).
Post-M28: timezone/staleness fixes, a security-review skill pass, M21's deterministic Ask
Market safe mode, and the Codex REVISE fix round (H1/H2/H3 + 3 P1s).

CURRENT
RELEASE CANDIDATE — **[CODEX RE-REVIEW READY]**, now with a materially stronger evidence base
than when that status was set. Development moved from the Claude Code Web sandbox to a local
Windows/VS Code machine on 2026-08-17. That move is not cosmetic: the local environment has a
real PostgreSQL 16.10, a real browser, and real network egress, none of which the cloud sandbox
had. Standing the project up there immediately falsified four things the cloud runs had
reported as green. All four are fixed and committed; details below.

STATUS
Local environment is fully operational and reproducible:

- Portable PostgreSQL 16.10 under `.local/pgsql` (gitignored), port 55432, started via
  `.local/pgsql/bin/pg_ctl`. No system-wide install, no Docker, no admin rights, fully
  reversible by deleting `.local/`.
- All 12 migrations apply cleanly to a genuinely fresh database.
- Playwright Chromium installed; `npm run e2e` runs a real browser locally.
- Real egress confirmed to data.sec.gov, api.stlouisfed.org, ecos.bok.or.kr and
  opendart.fss.or.kr — the `LIVE_VERIFICATION_REQUIRED` classifications were an artifact of the
  cloud sandbox's blocked egress, not of the adapters.

What running on real infrastructure found (all fixed, each with regression coverage):

1. **Observation revision-chain race** (`src/server/domain/observationIngest.ts`). The H3 fix
   located the chain's "latest" row with `orderBy: { retrievedAt: "desc" }`. Prisma maps
   DateTime to `timestamp(3)`, so an original and its revision written in the same millisecond
   are indistinguishable and Postgres may return either first. On the wrong ordering the code
   compared against the ORIGINAL, tried to attach a second child to a parent that already had
   one, and threw a raw P2002 after exhausting its 20 retries. Not concurrency-only — a plain
   sequential re-ingest of already-revised data hit it. The tail is now found structurally (the
   row nothing else points at via `revisionOf`), which the existing unique constraint makes
   unambiguous regardless of timestamp resolution.
2. **The H1 migration-upgrade regression test was silently not running on Windows.** It spawned
   `npx`, which is ENOENT under the bare name and EINVAL as `npx.cmd` (Node's CVE-2024-27980
   mitigation). The suite failed before its first assertion. Now invokes Prisma's CLI entry
   point directly via `process.execPath`.
3. **`scripts/run-ingest-jobs.ts` spawned `npm`**, which is `npm.cmd` on Windows. `spawnSync`
   returns `status: null` rather than throwing, so every job would have been reported as a
   normal FAILED job instead of never having started.
4. **Real EDGAR schema drift.** SEC returns `fy: null, fp: null` on some companyfacts rows
   (facts republished for a `frame` under a later restating filing). Both adapter types and both
   DB columns were non-nullable, so a real ingest would have failed on the first such row —
   Apple alone has 20. Widened rather than dropped: the fact is fully sourced and only the
   fiscal label is absent, so deriving one from `periodEnd` would store an inference as reported
   data (docs/DATA_POLICY.md) and skipping the row would silently lose real history.

Also completed this pass: **M19 Watchlist now has a real user-facing request path**
(`src/server/actions/watchlist.ts` + `/watchlist`), closing the gap
docs/RELEASE_READINESS.md named precisely — the domain module had zero callers, so cross-user
isolation had never been exercised through an actual request.

Live provider verification (docs/RELEASE_READINESS.md "Data adapters"):

- **SEC EDGAR submissions + XBRL: `VERIFIED`.** 55/55 live contract checks against real
  data.sec.gov (`npx tsx scripts/verify-edgar-live.ts`), then a real ingest of 1000 filings and
  1099 financial facts, then a re-ingest confirming 0 inserted / all unchanged.
- FRED / ECOS / OpenDART remain unverified live: all three are reachable, but each needs a free
  API key the user registers for. The user has said they will obtain all three (2026-08-17);
  until the keys arrive this stays a Human Gate, not a defect.

Codex re-review status is unchanged and is still the one non-Product gate. Note that the
re-review scope has grown since the fix-round HEAD — see NEXT.

TESTS
218 / 218 PASS against a real local PostgreSQL 16.10 (up from 209 in the cloud environment:
+8 watchlist server-action tests, +1 null-fiscal-label regression). `npm run e2e` 17/17 checks
in a real browser (up from 12 — the watchlist add/list/remove pass is new).
Lint / typecheck / format / production build all clean.

Note on the old "209 pass" figure: it was accurate for the environment that produced it, and
still wrong about the product. Two of those tests failed the moment they met a real Postgres on
a fast machine, and a third had never executed on Windows at all. Treat a green suite as
evidence about the environment it ran in.

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md. docs/RELEASE_READINESS.md is the canonical per-subsystem
classification.

NEXT

1. **Codex re-review** — still the one non-Product gate. Run docs/CODEX_REVIEW_PACKET.md §12
   from a machine with `codex login` done, and drop the result at
   `reviews/market-os-final-review.json`. **The scope is no longer just the fix-round diff:**
   it now runs from `9b34f8bb6be120dacd381fe22577870f40d6e5fa` (the commit the first review
   examined) to current HEAD, which adds the local-verification round on top of the H1/H2/H3
   fixes. The H3 fix in particular was itself defective and has been re-fixed — a re-reviewer
   should be told that rather than left to rediscover it.
2. **FRED / ECOS / OpenDART API keys** — user is obtaining all three. When each key lands, put
   it in `.env` and live-verify that adapter the same way EDGAR was: real endpoint, real
   response shape, then a real ingest and a re-ingest for idempotency. FRED specifically would
   unblock the 5 Macro Regime axes currently reporting `NOT_TRACKED`.
3. Three named Product/Human Gates remain, unaffected by the above:
   (a) Full free-text LLM-based Ask Market — needs a funded LLM provider/credential decision.
   (b) Production deployment approval.
   (c) Payment/subscription activation.
