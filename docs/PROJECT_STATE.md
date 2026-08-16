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

**NOT `RELEASE_CANDIDATE_READY`.** That status requires all of: local commits pushed; FRED, ECOS
and OpenDART each live-verified or explicitly recorded as externally blocked; Codex independent
re-review complete; P0 = 0; P1 = 0; full verification green. Four of those are open — see
`docs/HUMAN_GATE_QUEUE.md`. Do not promote the status because the engineering looks finished.

**`PUSH_PENDING_AUTH`** — commits after `9b20f01` are local-only. GitHub authentication is not
configured on this machine and the environment cannot prompt for it (HG-001). All work is
committed on `claude/market-os-development-7vnicg`; nothing is at risk, nothing was rewritten,
and push is not being retried in a loop.

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
isolation had never been exercised through an actual request. A follow-up targeted security
audit of that path fixed three findings: an unused exported server action (a "use server"
export is a reachable endpoint whether or not a page calls it), an unbounded per-user row
count, and an upsert that could surface a raw P2002 under concurrent submission.

**Silent pagination truncation in all three keyed adapters** (found by reading them against
their own documented response shapes, 2026-08-17). FRED, ECOS and OpenDART each fetched the
first page and treated it as the whole answer, while the field that says otherwise (`count`,
`list_total_count`, `total_page`) was received and ignored. DART is the clearest: one request
capped at 100 rows, and Samsung Electronics files well over 100 disclosures a year. Nothing
failed and nothing warned — the database held a partial series that read as complete, feeding
every downstream What Changed / Macro Regime / Historical Analog calculation. Each client now
pages to the provider's own total and reports `truncated` when a result is knowably incomplete.
Also fixed: `rcept_dt` was missing the impossible-date guard FRED and ECOS received in the
2026-08-16 pass, so `20260230` would have silently become Mar 2.

Live provider verification (docs/RELEASE_READINESS.md "Data adapters"):

- **SEC EDGAR submissions + XBRL: `VERIFIED`.** 55/55 live contract checks against real
  data.sec.gov (`npm run verify:live:edgar`), then a real ingest of 1000 filings and 1099
  financial facts, then a re-ingest confirming 0 inserted / all unchanged.
- **FRED / ECOS / OpenDART: `LIVE_KEY_PENDING`** (HG-002/003/004). All three hosts are
  reachable; each needs a free API key the user registers for. `scripts/verify-{fred,ecos,dart}
-live.ts` are written and wired to `npm run verify:live:*`, built on the same harness as the
  EDGAR check. **The existence of a verification script is not verification** — none of the
  three may be classified `LIVE_VERIFIED` until the full sequence has actually run against a
  real endpoint. EDGAR found real drift on its first attempt; assume these will too.

Codex re-review is still the one non-Product gate, and its scope has grown materially — see
NEXT and `docs/CODEX_REVIEW_PACKET.md` §0.1.

SECOND ROUND (night autonomous run, 2026-08-17) — further defects found, all fixed:

5. **EDGAR was storing 45% of Apple's filing history.** `filings.recent` is hard-capped by SEC
   at 1000; everything older spills into `filings.files[]`, which the adapter never fetched.
   Real ingest went from 1000 filings (oldest 2015-06-04) to 2240 (oldest 1994-01-26). This got
   past the live contract check run the day before, which verified the response SHAPE, printed
   "1000 recent filings" as an informational line, and concluded VERIFIED. Shape verification is
   not completeness verification, and a suspiciously round total should be read as a cap.
6. **Silent pagination truncation in all three keyed adapters.** FRED's `count`, ECOS's
   `list_total_count` and DART's `total_page` were each received and ignored; every client
   fetched page one and treated it as the whole answer.
7. **Watchlist audit** — an unused exported server action (a `"use server"` export is a
   network-reachable endpoint whether or not a page calls it), no per-user row cap, and an
   upsert that could surface a raw P2002 under concurrent submission.
8. **14 real bypasses in the Ask Market buy/sell guardrail**, including "price target" (the
   reverse word order of the covered "target price", and an explicitly prohibited output) and
   two bypasses `docs/CODEX_REVIEW_PACKET.md` had itself documented as open.
9. **The 2026-08-16 impossible-date guard had only reached FRED and ECOS.** DART, EDGAR
   submissions and EDGAR XBRL were all missed; all four adapters now share it.
10. **The XBRL normalizer reported nothing about what it dropped** — a filer with no us-gaap
    taxonomy, or a concept in a non-USD unit, ingested as a confident zero. Now matches
    FRED/ECOS's `skippedMissing` convention.
11. **`DATABASE_URL` unset would silently skip all 25 integration files** and still report a
    green run. `tests/integration-coverage-guard.test.ts` now fails loudly in CI.

12. **Provider API keys were reaching logs, and then the database.** `HttpTimeoutError` embeds
    the request URL; ECOS puts its key in a path segment, FRED and DART in a query parameter.
    Persisting ingest-run errors turned a transient log line into a stored secret rendered on
    /admin. Redacted at both the error constructor and at persistence.
13. **`filings.files[].name` was interpolated straight into a request URL** — a small SSRF
    surface from a third-party response. Now constrained to the filename shape SEC documents.
14. **`truncated` was a field nobody read.** Every adapter reported completeness and all of it
    went to `console.warn`. Now persisted as `IngestRun` and surfaced on /admin as "Ingest
    completeness" (fetched vs. the provider's own total).

15. **The revision-ordering bug was in the READ path too** — three independent instances, in the
    layer that decides which number a user is shown. `getRecentObservationPair` (What Changed,
    Macro Regime, Ask Market, Today), `economicCalendar` (`lastObservedValue`) and
    `historicalAnalog` (z-scores every point) all resolved "which row wins for this date" by
    `retrievedAt`, which cannot separate an original from a revision written in the same
    millisecond. A superseded value could be displayed as current, non-deterministically. Now
    resolved structurally through one shared `revisionChain.ts`.
16. **A third read-then-write treated as atomic**: the EDGAR/DART/XBRL ingests did
    `findUnique` → `create`. Confirmed real rather than theoretical — the old pattern run four
    ways concurrently rejected 3 of 4 with P2002.

17. **168 financial facts were silently discarded on every ingest.** A fact's identity includes
    the period START — SEC reports a year-to-date and a quarterly figure under the same period
    end and accession, distinguished only by `start` (Apple: $3.698B over nine months vs $1.072B
    over one quarter). The unique key omitted it, so one of each pair was dropped and reported
    as "unchanged". Enforced now as two partial unique indexes, because `periodStart` is NULL
    for instant concepts and a NULL in a unique key stops enforcing anything.
18. **The two EDGAR adapters identified companies differently** — filings under `0000320193`,
    facts under `320193`. 2240 filings, 933 facts, zero joinable rows, and Ask Market's "Company
    facts" section silently empty for every EDGAR company.

Two patterns account for most of what was found, and both are worth carrying forward.

_Identity and ordering keys that cannot bear the weight put on them_ — H3, the watchlist upsert,
the three read paths, the filing ingests, and the fact-identity key. Four of the five were found
only after the first was fixed and its shape was known.

_Silence where there should be a signal_ — every truncation defect, plus the two above. The most
reliable way to find these was not reading code but looking at real numbers and asking whether
they were plausible: 1000 filings is a suspiciously round total; 168 rows "unchanged" against an
empty table is impossible; 2240 filings and 933 facts with zero joinable rows is not a
coincidence. None had a failing test, and several had passing ones.

TESTS
272 / 272 PASS against a real local PostgreSQL 16.10 (up from 209 in the cloud environment).
`npm run e2e` 24/24 checks in a real browser (up from 12) — the walkthrough now drives the Ask
Market guardrail through the real page, not just the domain function. `npm run verify:live:edgar`
59/59 against real data.sec.gov. All 13 migrations apply cleanly to a genuinely fresh database.
Lint / typecheck / format / production build all clean. Full suite runs in ~22s.

Note on the suite runtime: it briefly reached ~137s when pagination was first tested by pushing
14,000 synthetic rows through the real ingest. That was moved to client-level tests, which is
where the behaviour actually lives — the assertion is about how many requests an adapter makes
and when it stops, and the database round trip proved nothing extra.

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

All open items are tracked with owner and unblock steps in `docs/HUMAN_GATE_QUEUE.md`
(HG-001..HG-008). Summary:

0. **Push the local commits** (HG-001, `PUSH_PENDING_AUTH`). One `git push` once GitHub auth
   exists on this machine. Blocks the `RELEASE_CANDIDATE_READY` promotion and CI.
1. **Codex re-review** — still the one non-Product gate. Run docs/CODEX_REVIEW_PACKET.md §12
   from a machine with `codex login` done, and drop the result at
   `reviews/market-os-final-review.json`. **The scope is no longer just the fix-round diff:**
   it now runs from `9b34f8bb6be120dacd381fe22577870f40d6e5fa` (the commit the first review
   examined) to current HEAD, which adds the local-verification round on top of the H1/H2/H3
   fixes. The H3 fix in particular was itself defective and has been re-fixed — a re-reviewer
   should be told that rather than left to rediscover it.
2. **FRED / ECOS / OpenDART API keys** (HG-002/003/004, `LIVE_KEY_PENDING`) — user is obtaining
   all three. When each key lands, run `npm run verify:live:<provider>`, then the full sequence
   before classifying it `LIVE_VERIFIED`: compare the real schema against types/parser/DB, test
   nullability, missing fields, revisions, units, dates, timestamps and pagination, fix any
   drift, add regression tests, do a small real ingest, re-ingest for idempotency, verify
   provenance. FRED specifically would unblock the 5 Macro Regime axes currently reporting
   `NOT_TRACKED`. Do not treat provider documentation as equivalent to the real API — EDGAR's
   documentation was wrong about nullability, and that was the first provider actually checked.
3. Three named Product/Human Gates remain, unaffected by the above:
   (a) Full free-text LLM-based Ask Market — needs a funded LLM provider/credential decision.
   (b) Production deployment approval.
   (c) Payment/subscription activation.
