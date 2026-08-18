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

Status: **`RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES`.**

**NOT `RELEASE_CANDIDATE_READY`.** That requires all of: local commits pushed; FRED, ECOS and
OpenDART each live-verified on the success path; independent re-review complete; P0 = 0; P1 = 0;
full verification green. Engineering-side conditions are met — P0 and P1 are both zero and the
full chain is green — but four external gates are open, and none of them is something autonomous
work can close. Do not promote the status because the engineering looks finished; see
`docs/HUMAN_GATE_QUEUE.md`.

**`PUSH_PENDING_AUTH`** — every commit after `6cb74fc` is local-only. This machine has no GitHub
credential and the environment cannot prompt for one (HG-001). One push is attempted per
meaningful credential-state change, not on a loop. All work is committed on
`claude/market-os-development-7vnicg`; nothing was rewritten and no force operation was used.

**`INDEPENDENT_REVIEW_PENDING_USAGE_RESET`** — the blocker here changed on 2026-08-18. `codex-cli`
is installed and IS authenticated against the ChatGPT subscription, so the environment limitation
recorded in earlier rounds is gone. What blocks review now is included-usage exhaustion, account
level rather than model level, resetting 2026-08-22. No credits purchased, no API key configured
(HG-005). `docs/INDEPENDENT_REVIEW_PACKET.md` is prepared against the current range with ten
ranked attack targets — and working through that packet's own questions is what produced findings
23-29 below, so it has already paid for itself before any reviewer has read it.

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

- **SEC EDGAR submissions + XBRL: `VERIFIED`.** 67/67 live contract checks against real
  data.sec.gov (`npm run verify:live:edgar`), then a real ingest of 2240 filings and 1428
  financial facts, then a re-ingest confirming 0 inserted / all unchanged. (The earlier
  "1000 filings, 1099 facts" figures were themselves the symptom of two defects — see items 5
  and 17 below.)
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

19. **Filing Diff reported a fabricated +233% revenue increase** — the most serious defect found,
    and invisible until real financial data existed. It compared the nine-month and three-month
    figures from the SAME filing (same period end, same accession) and called the difference
    growth. A period-over-period comparison now requires the same period length and a different
    period, or reports INSUFFICIENT_DATA. Post-fix the same concepts read −1.59% and −0.53%
    quarter-over-quarter, which is what Apple actually did.
20. **Company X-Ray had no revenue after 2018** — US GAAP's ASC 606 transition moved revenue to
    a different tag and the adapter tracked only the legacy one. Coverage now runs 2007→2026.
21. **Two figures sharing a fiscal label were indistinguishable on screen** — `/ask` showed
    $122.4B and $35.7B both as "Q3 2026". The page now renders the period covered.

Two patterns account for most of what was found, and both are worth carrying forward.

_Identity and ordering keys that cannot bear the weight put on them_ — H3, the watchlist upsert,
the three read paths, the filing ingests, the fact-identity key, event ingest, and
`IngestRun.target`. Almost all were found only after the first was fixed and its shape was known,
including two in code written the day before. Assume there is another one.

_Silence where there should be a signal_ — every truncation defect, plus the two above. The most
reliable way to find these was not reading code but looking at real numbers and asking whether
they were plausible: 1000 filings is a suspiciously round total; 168 rows "unchanged" against an
empty table is impossible; 2240 filings and 933 facts with zero joinable rows is not a
coincidence. None had a failing test, and several had passing ones.

The sharpest lesson of the night is #19: every fixture had one figure per period, so every test
passed, and the defect was invisible until a real provider response was in the database. Fixture
coverage says nothing about shapes the fixture author did not know existed.

Also shipped: **Company X-Ray finally has a view** (`/company`, `/company/[corpCode]`). M15 built
the adapter and the store, M16 built the diff, and nothing ever assembled them — the same
built-but-unreachable gap the Watchlist had. With 2240 filings and 1428 facts now correct, the
only way to see any of it was a keyword search. The read model carries no field capable of
holding a score, rating, valuation or target, and a test asserts that structurally.

22. **CALCULATION claims never verified their own source attribution.** `verifyFactClaim` always
    compared `claim.sourceId` against its evidence; `verifyCalculationClaim` did not, and the
    claim text does not mention the source — so a change attributed to the wrong provider
    verified as VERIFIED. Found by examining the neighbours of the Codex-reported H2 rather than
    only H2 itself.

THIRD ROUND (2026-08-18) — release hardening, all found by working through this project's own
independent-review packet rather than waiting for a reviewer:

23. **Destructive-test database selection now fails closed.** The previous protection fell back
    to `DATABASE_URL` when `TEST_DATABASE_URL` was unset, so the protection only reached people
    who already knew they needed it. Now: no test DB named → refuse; same database as the dev
    one → refuse; a name that does not identify itself as disposable → refuse; a
    production-looking name → refuse. 21 tests, plus all four paths exercised against the real
    config.
24. **A fourth read-then-write race, in event ingest.** Reproduced before fixing — four
    concurrent ingests of one URL rejected three of four with a raw P2002. Worse, `Event` and
    its first `EventMention` were separate statements, so a failure between them left an Event
    claiming `mentionCount: 1` with nothing attached. Both now in one transaction.
25. **A no-database test run did not actually work**, despite the guard documenting it as
    supported. The Prisma client was constructed at module scope, so importing any module that
    touches the database required `DATABASE_URL` — four unit test files failed outright. Client
    is lazy now; a skipped suite that parsed the URL at describe scope was fixed too.
26. **A fifth identity-representation mismatch**, in yesterday's own code: `IngestRun.target`
    recorded the unpadded CIK while the data it describes is stored padded. Nothing joined them
    yet, so nothing looked broken — and the completeness lookup built next would have silently
    reported UNKNOWN forever.
27. **Truncation now reaches the reader, not just the operator.** `/company/[corpCode]` carries
    a completeness note: COMPLETE, KNOWN_INCOMPLETE (with the shortfall), LAST_RUN_FAILED, or
    UNKNOWN when no run was recorded — absence is not evidence of completeness.
28. **Persisted errors leaked filesystem paths and application source.** The `DATABASE_URL`
    password does not appear in Prisma errors (checked, not assumed), but the code frame does,
    and `ingest_runs.error` is rendered on /admin.
29. **14 more Ask Market bypasses**, found by adversarial probe across the attack classes in the
    release directive: stop loss, entry/exit price, portfolio percentage, allocation, roleplay,
    "if you were me", quoted advisor, and mixed Korean/English forms.

META ARCHITECTURE V2 — SHADOW MODE, DOES NOT AFFECT V1
Contracts drafted 2026-08-18 while v1 is frozen: `docs/META_ARCHITECTURE_V2.md` (start here),
`WORLD_DATA_FABRIC.md`, `VERIFY_ARCHITECTURE.md`, `GOVERNANCE_OS.md`, `EVOLUTION_ENGINE.md`,
`EVOLUTION_LEDGERS.md`. Four layers now have running implementations under `src/server/fabric`,
`verify`, `governance` and `evolution` — all read-only, none imported by any v1 file, and
`tests/architectureBoundary.test.ts` proves both properties rather than asserting them.

The finding worth carrying: most of the Reality Fabric is already built, just scattered and
unnamed. `Observation` already separates observedAt / releasedAt / retrievedAt; `IngestRun`
already records `providerTotal` vs `fetched` and `truncated`; `DataConflict`, `SourceTier`,
`staleness.ts` and the Claim Ledger already exist. What is missing is one vocabulary — three
places currently decide what "stale" means with no shared type and no guarantee they agree. The
first shadow deliverable was a read-only projection that runs all three and reports disagreements,
because each disagreement is a v1 defect hypothesis. It currently reports 8 against real data.

**Provider vintage and semantic recency** (2026-08-18, `src/server/fabric/vintage.ts`). The concept
IR-021 forced into existence, and the answer to the question that finding left open. v1 decides
which of two values is current by asking which arrived last; the replay guard added for IR-021 is a
heuristic standing in for evidence no provider currently gives us. The contract models that evidence
provider-neutrally — `providerVintageAt`, `sourceReleasedAt`, `providerRevisionId` — with an
availability state per field (`KNOWN` / `UNKNOWN` / `NOT_PROVIDED` / `NOT_VERIFIED`) so an absence
says WHY it is absent and whether anything can be done about it. `compareVintage` orders by vintage,
then by release, then stops at `UNRESOLVED`. **`retrievedAt` is deliberately not a rung**, and a
negative control test fails if it ever becomes one.

Propagated through all four layers in shadow only:

- **Fabric** — `SeriesFabricRow` carries `vintage` and `revisionCount`, and raises a
  `REVISED_WITHOUT_VINTAGE` disagreement where a series has actually been revised with no provider
  evidence saying which version won. Fires for `ECOS:722Y001:0101000` against the real database.
- **Verify** — a tenth dimension, `revision_integrity`, and a new verdict
  `SEMANTIC_REVISION_UNRESOLVED`. Applicability is derived from the figures: where both name the
  filing they came from, the version question is already settled by that identity, which is why the
  8 real Apple outputs are unchanged at VERIFIED_WITH_LIMITATION rather than collapsing to one
  uniform verdict.
- **Evolution** — two new weakness categories, both clustering at 2 instances. `SEMANTIC_RECENCY`
  joins IR-021 to the E2E pass that was served by a pre-fix dev server; `EVIDENCE_FABRICATION`
  joins the Codex reviewer that quoted a reproduction it never ran to the four local-model findings
  that survived nothing.
- **Governance** — `ExecutionStatus` gains `BLOCKED_PROVIDER_KEY` and `BLOCKED_USAGE_LIMIT`, so a
  free-but-uncallable provider and an exhausted included quota are recorded as environmental
  blockers rather than policy positions. Two invariants are now enforced across the whole table by
  test: an execution blocker never coincides with `DENIED`, and never raises a gate.

FRED is where this becomes actionable. `realtime_start`/`realtime_end` are exactly the fields the
contract wants, they are already declared in `fred/types.ts`, and no adapter reads them — so the
capability table records them `NOT_VERIFIED` and a test forbids upgrading that to `KNOWN` without a
live response. One key (HG-002) closes the largest open item in this design.

TESTS
554 / 554 PASS against a real local PostgreSQL 16.10 (up from 209 in the cloud environment).
`npm run e2e` 33/33 checks in a real browser against the **production build** (up from 12) — the
walkthrough drives the Ask Market guardrail and the Company X-Ray page through real rendered
HTML, not just the domain functions. `npm run verify:live:edgar` **67/67** against real
data.sec.gov. Lint / typecheck / format / production build all clean. Full suite 136-206s against a live
database across two runs on the same tree — the variance is real and is the integration files
contending for one Postgres, not noise worth averaging away.

Tests run against a disposable database, enforced fail-closed. With no database at all, 350 unit
tests pass and the integration suite skips cleanly (30 files) — a path that is now actually
verified rather than assumed.

**2026-08-18 interim round** (`a0eb92a..HEAD`, `docs/INTERIM_REVIEW_FINDINGS.md`). Codex usage is
exhausted until 2026-08-22, so a local model was calibrated as a stand-in reviewer and
**disqualified** — both installed models reported defects in correct code on every sample and
never once cleared a clean control (`docs/LOCAL_AI_CALIBRATION.md`). This range therefore has had
no independent review at all. Three findings, all reproduced before being fixed:

- **IR-001 / IR-002** — Ask Market and Company X-Ray keyed financial facts on `corpCode` alone,
  although both unique indexes on `financial_facts` begin with `sourceId`. Latent today (one fact
  source), but the X-Ray page named one provider in its header while pooling filings, ticker,
  figures and filing list across all of them.
- **IR-006** — 21 Ask Market guardrail bypasses. The last ten came from _enumerating_ the pattern
  list for English-only concepts with no Korean mirror, rather than probing for them; 적정가,
  당신이라면, 어디에 투자할까요 and the advisor proxy all had no counterpart. Over-blocking is
  tracked as a failure too: 18 legitimate macro questions are pinned as must-not-flag.

The fail-closed guard was itself verified the way that matters: after the full 338-test suite ran
against `market_os_test`, a re-ingest against `market_os_dev` reported 0 inserted / 2240 unchanged
/ 1428 unchanged. The real data was still there. Three earlier rounds had silently destroyed it.

End-to-end verification on a genuinely fresh database: all 16 migrations applied, real ingest of
2240 filings and 1428 financial facts, re-ingest returning 0 inserted / all unchanged, and 67/67
live contract checks. Every migration added in these rounds was also applied to a POPULATED
database, not just an empty one — the H1 discipline.

Note on the suite runtime: the 14,000-row pagination test that once dominated it was moved to
the client level, but the figure did NOT come back down — measured again on 2026-08-18 it is
136-206s, and the ~25s recorded here for several rounds was stale. The cost is the integration
files, each of which sets up and tears down against a real database. Recorded rather than
quietly corrected, because a performance number that only ever moves when someone notices it
is a number nobody is measuring.

The original note, kept for the reasoning: it reached ~137s when pagination was first tested by pushing
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
