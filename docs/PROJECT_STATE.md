CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00-M28 (see docs/RELEASE_READINESS.md for the precise, honest per-subsystem status — this
section is intentionally brief; that document is the source of truth for readiness).
Post-M28: timezone/staleness fixes, a security-review skill pass, M21's deterministic Ask
Market safe mode, and the Codex REVISE fix round (H1/H2/H3 + 3 P1s).

CURRENT
RELEASE CANDIDATE — **frozen, independently closed, awaiting human release gates.** Status:
**`RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES`** (2026-08-21).

|                              |                                                                         |
| ---------------------------- | ----------------------------------------------------------------------- |
| Reviewed code SHA            | `c03aa73e2ced798dd65a17c013c4a11051a74b4c`                              |
| Attestation SHA / PR #1 head | `fb3a72193ade11da265fbc496ffd1a38bdd734e4`                              |
| Remote CI                    | 32433898532 (reviewed) and 32434207834 (attestation head), both SUCCESS |
| Final closure                | `[CHATGPT_VERIFIED][ESC-011]` APPROVED, issue #2 comment 5364293844     |
| Follow-up branch             | `claude/post-rc-followup`, deliberately NOT in PR #1                    |

**The gate chain is closed and is not to be reopened.** Gates A through U ran; each of A–T found
at least one real defect and produced a new candidate, and Gate U reviewed `40dc7e3..c03aa73` and
returned "No findings" — the first clean gate in twenty rounds. Every superseded SHA is recorded
`SUPERSEDED_NOT_CLEAN` in `reviews/market-os-final-review.json` and listed in the attestation's
`notAttested`. The closing verdict lives in `docs/REVIEW_ATTESTATION.json`, not in the gate log,
and `npm run rc:verify-pair` checks the two-SHA relationship from the git objects.

**NOT `RELEASE_CANDIDATE_READY`.** Engineering-side conditions are met — P0 and P1 are both zero,
counted from the review register rather than declared, and the full chain is green. What remains
is eight human or external gates, none of which autonomous work can close, each carrying a
decision packet in `docs/HUMAN_GATE_QUEUE.md`. Three of the eight — the FRED, ECOS and OpenDART
keys — cost nothing and unblock the most. Do not promote the status because the engineering looks
finished.

**`PUSHED`** — HG-001 is closed. Branch published on
`origin/claude/market-os-development-7vnicg`, PR #1 open, CI running against real SHAs. Nothing
was rewritten and no force operation was used. The `PUSH_PENDING_AUTH` text that stood here was
true when written and false for most of the session that followed it; see the correction in
`docs/HUMAN_GATE_QUEUE.md` (HG-001).

**Post-RC work runs on `claude/post-rc-followup` and never on the candidate**, because an
executable commit after the reviewed SHA would invalidate the review the release rests on.

ESC-012 is answered and applied there. A trusted directive that answers no escalation is now
first-class input labelled `UNSOLICITED_DIRECTIVE`, reaching VALIDATED and never APPLIED; the
seven pre-cutover directives route to a reconciliation path that can only look, and twelve
mutations of the safety gates are each detected. Implementing it surfaced IR-086: the protocol tag
has three segments and the parser read two, so the ESC-012 escalation was recorded as an exchange
called MARKET-OS and its own decision matched nothing.

POST-RC UNIT — redirect / informational authority (branch `claude/ask-guardrail-architecture-20260823`)

The frozen RC is untouched and PR #1 is not involved. This branch carries one reproduced P1 and the
assurance apparatus that measures it.

    P1_REDIRECT_INFORMATIONAL_AUTHORITY   CLOSED STRUCTURALLY. ESC-015 item 4 removed the
                                          informational payload entirely, so a prohibited
                                          request publishes nothing and the class cannot
                                          recur through that path. Cost: the "refusing to
                                          advise is not refusing to inform" capability is
                                          withdrawn by decision.
    ESC015_UNKNOWN_SECOND_OBJECT          CLOSED. A relation role naming two things refuses,
                                          decided on request text with no repository lookup.
    P1_UNBOUNDED_CLAUSE_OPENING_CLASS     ESC-015 Option B applied, REWORK_REQUIRED from both
                                          reviews. The 38-tail matrix measures the `.`
                                          boundary ONLY: 0 of 38 swallowed there, 28 of 38 at
                                          `!` and again at `;`, which stay provisional
                                          because `Yahoo!` and `Smith; Jones` are real names.
                                          `?` is not in that table and carries its own pinned
                                          issuer exception.
                                          THREE THINGS BLOCK CLOSURE. A directive still
                                          reaches a served SOURCE region at `!` and `;` --
                                          `Should I buy stock! Reuters published about
                                          Alpha?` serves source `should i buy stock reuters`.
                                          10 of 31 ordinary entity suffixes are refused,
                                          `Corp.` among them. And no threshold fixes the
                                          second, because `Inc` must join at three letters
                                          while `CPI` must split at three.
    WAITING_DECISION                      ESC-015, issue #2 comment 5447598201, posted and
                                          read back 2026-08-28. Accept-as-known-risk vs
                                          redesign is not an engineering question, so it is
                                          not decided here. This blocks THIS unit's closure
                                          and nothing else.
    CODEX_AVAILABLE                       YES, verified by invocation per model id 2026-08-28
    HUMAN_GATE                            NONE for this unit

A second clause that did not authorize on its own could be swallowed into an open-class region of
the first; the worst instance put the advice directive inside a source region the redirect path
serves. A candidate boundary is now confirmed only when the fragment after it opens a clause AND
the run's head is itself a complete request, with `?` confirming on its own -- a measured
trade-off (258 swallows closed, 0 wrongly admitted) and NOT the invariant an earlier version of
this paragraph claimed. `?` does occur inside a registered issuer name; see REVIEW_DEBT.md.

Reviews so far, none of them a formality: Luna twice on the harness (REWORK_REQUIRED, then
APPROVE), Terra five times on the architecture (APPROVE, REFINE_IN_THIS_UNIT, REFINE_FURTHER,
RECORD_AS_DEBT, then P1-BLOCKS-CLOSURE), Sol twice on P1 closure (REWORK_REQUIRED both times, and
both times it found a real defect no mutation score could). Every finding was reproduced before
being repaired, and reproducing three of them found MORE instances than the reviewer had named --
`who`/`why` became seven, `Summarize` became seven more, and the unknown-tail matrix then found 28
of 38. One review claim was checked and REFUTED rather than accepted: `headReads` is used in the
executed condition, contrary to the fifth architect round.

What is NOT established, recorded rather than rounded off: `CLAUSE_OPENING_TOKENS_COMPLETENESS =
UNESTABLISHED`. Six absent tokens sat behind a 9-of-9 mutation score, and the architect's answer to
"can this ever be checked" was no -- not at this design's level, because a generated opener corpus
only moves the unproved claim into its generator. The known instances are closed and pinned; the
next omission is not findable by anything this repository runs.

The mutation harness itself was reviewed and repaired BEFORE its numbers were used, across four
commits. Its lock took three designs; the first two looked correct and were measured admitting two
simultaneous holders. 54 self-test controls, 180 clean rounds of a four-way reclaim race. Explicitly
NOT claimed: POWER_LOSS_SAFE, FILESYSTEM_CRASH_SAFE, ARBITRARY_CONCURRENT_WRITER_SAFE.

STATUS
Local environment is fully operational and reproducible:

- Portable PostgreSQL 16.10 under `.local/pgsql` (gitignored), port 55432, started via
  `.local/pgsql/bin/pg_ctl`. No system-wide install, no Docker, no admin rights, fully
  reversible by deleting `.local/`.
- All 17 migrations apply cleanly to a genuinely fresh database, re-checked 2026-08-21 by
  applying them to an empty one: 17 recorded, 17 finished.
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
  uniform verdict. A second adapter followed, over Morning Brief's "What Changed" rows — the
  first output shape where the version question is genuinely open. The real run now reports three
  distinct verdicts across two shapes: 8 VERIFIED_WITH_LIMITATION, 3 SEMANTIC_REVISION_UNRESOLVED,
  3 STALE.
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

PROVIDER CAPABILITY MATRIX (2026-08-18, shadow)
`src/server/fabric/providerCapability.ts` — what each source can actually tell us, on 13 axes,
with the evidence for every cell. The direct continuation of the vintage work, and the answer to
the question it kept raising: is this absent because the provider withholds it, or because nobody
has looked?

The rule that gives it value is enforced by test: **`SUPPORTED` and `NOT_SUPPORTED` both require
`LIVE_RESPONSE`.** Asserting NOT_SUPPORTED from a documentation page is the same error as asserting
SUPPORTED from one, and worse in effect — it closes an inquiry instead of opening it. Every
`NOT_VERIFIED` must also name the gate that would clear it, so the matrix doubles as a work list.

Current standing: SEC_EDGAR has live evidence on all 13 axes (6 SUPPORTED, 3 NOT_SUPPORTED, 4
CONDITIONAL); FRED, ECOS and OpenDART have live evidence on none, and every axis reads
NOT_VERIFIED behind HG-002/003/004. SEC's cells carry counts rather than adjectives — 912 of 1431
facts have a period start and 519 do not; 86 filings and 17 facts carry a `/A` suffix.
`total_count_evidence` is CONDITIONAL because filings can be counted and facts cannot, which makes
fact completeness **permanently unconfirmable** rather than merely unconfirmed.

The vintage contract now DERIVES its availability states from this matrix instead of restating
them. Two tables describing the same providers is two things to keep true, and the whole
IDENTITY_MODELLING cluster is variations on that theme.

Propagated:

- **Verify** — `DimensionResult.evidenceGap` classifies why evidence was missing:
  STRUCTURAL_LIMITATION / VERIFICATION_DEBT / DATA_QUALITY_ISSUE / CONDITIONAL_ABSENCE /
  CAPABILITY_UNKNOWN. Two macro outputs can both be INSUFFICIENT_EVIDENCE and mean opposite
  things — SEC's missing vintage is a ceiling, FRED's is one API call. An output built from two
  sources gets no classification rather than the first source's answer.
- **Governance** — `PUBLISH_CURRENT_STATE_CLAIM` and `PUBLISH_COMPLETENESS_CLAIM` read the Fabric's
  reality state. A stale series DENIES a current-state claim; an unconfirmed total permits a
  completeness claim only with the limitation disclosed. `ExecutionOutcome` (EXECUTED / FAILED /
  DEFERRED / the three blockers) is now separate from `ExecutionStatus` readiness, and
  `observeExecution()` throws rather than record a DENIED action as EXECUTED.
- **Evolution** — `capabilityGapProposals()` generates evidence-backed proposals from the matrix,
  carrying all nine required fields with every evidence item labelled OBSERVED or INFERRED. Three
  CAP-DEBT proposals and one CAP-CEILING. No CAP-DEBT-SEC_EDGAR exists, which is the control: a
  generator that raises one per provider is not reading anything.

INDEPENDENT REVIEW OF THE SHADOW LAYERS (2026-08-18)

Two reviews were run once Codex became available, routed per the standing rules. **Terra** for the
cross-file work, **Luna** for the bounded fidelity audit. Sol remains unspent, reserved for the
final Release Candidate pass and for any v1 P0/P1.

`gpt-5.6-luna` — governance rule-vs-citation fidelity and ledger completeness:

- **IR-029** — `PURCHASE_AI_CREDITS` was `DEFERRED_HUMAN_GATE`, looser than both documents it
  cites, which prohibit buying credits outright and prescribe `USAGE_LIMIT_PAUSE` instead. Now
  `DENIED`. Note the direction: the previous fidelity correction made a rule less strict, this one
  makes it stricter. Corrections that only ever loosen would be a pattern to distrust.
- **Ledger: 28 entries checked, zero fabrications**, eight documented defects with no entry. All
  eight now recorded as `VF-01`..`VF-08` — every one a defect in **Verify itself**, left out
  because they felt like construction noise. They are the ledger's most direct evidence that a
  verifier is not exempt from the failure modes it verifies against, and omitting them was
  under-counting `IDENTITY_MODELLING` by four. That cluster now stands at 9 instances, P0.

**IR-028 — found by probing, not by a model, and NOT fixed.** `Apple revenue`, `Apple net income`
and `What did Apple report?` all return `NOT_FOUND` against 2240 Apple filings and 1431 Apple
facts, while `Apple` and `Apple Inc revenue` both work. `mentionsEachOther` scores
`overlap / smaller.size` at 0.6, and `Apple Inc.` tokenises to `{apple, inc}` — the legal suffix is
a full token in the denominator. P2, so the freeze holds: the output is honest, just empty.
Recorded as a **release-critical candidate** for the release owner to decide, with the full
reproduction matrix in IR-028.

`gpt-5.6-terra` — cross-file review of the shadow layers:
Codex became available again and one cross-file review was run over `b6eb8fd..HEAD`, scoped to the
v2 shadow layers. **Five findings, all five reproduced before any change, all five valid, all
fixed** — recorded as IR-022..IR-026. Terra was the right routing: the target was interactions
between a capability matrix, a contract deriving from it, and two consumers.

- **IR-022** a stored `releaseDate` was promoted to KNOWN evidence for providers whose release
  semantics have never been observed. The same promotion had been written independently at two
  call sites and was wrong at both; one shared `withStoredReleaseDate()` now decides it.
- **IR-023** `observeExecution` accepted an EXECUTED record for an `AUTO_ALLOWED_WITH_VERIFY`
  action with no statement that the verification had passed.
- **IR-024** `compareVintage` dropped to release time whenever the two sides did not BOTH carry a
  vintage, so weaker evidence could answer while stronger evidence was held.
- **IR-025** `revision_integrity` returned NOT_APPLICABLE whenever both figures carried an
  accession. A figure restated by a later 10-K/A carries the accession of the filing it was first
  reported in, so the dimension was standing down for the case it exists to catch.
- **IR-026** `classifyEvidenceGap` implied it had checked a condition it was never given enough to
  check.

**IR-027 — the ECOS shadow disagreement, investigated.** `REVISED_WITHOUT_VINTAGE` on
`ECOS:722Y001:0101000` led to something the flag did not predict: the revision carries a
`retrievedAt` nine hours EARLIER than the original it supersedes. v1 handles it correctly — the
chain is walked structurally rather than sorted — but no fixture covered inversion, only the
equal-timestamp collision. `tests/integration/revision-retrieval-inversion.test.ts` closes that,
including a three-row chain retrieved in exact reverse order.

Every fix is paired with a positive control. Four of the five narrow something, and a narrowing
that goes too far produces a layer answering "cannot tell" to everything — a failure this project
has already caused itself twice. The eight real SEC outputs are unchanged at
VERIFIED_WITH_LIMITATION, which is the control that matters.

A THIRD VERIFY ADAPTER — ASK MARKET (2026-08-18, shadow)
`adversarial_resilience` had never done any work: NOT_APPLICABLE for every calculation, and
INSUFFICIENT_EVIDENCE for everything else. Ask Market is the only path in the product whose output
could genuinely read as advice, and `verificationInputFromAskMarket` points the dimension at it.

**What it surfaced.** Ask Market refuses a buy/sell question and STILL returns the factors, which
`/ask` renders underneath — so "Should I buy Apple Inc?" produces a refusal followed by ten Apple
figures. That is defensible, and what makes it defensible is one property: the factors are
identical to the neutral query's, in the same order. Nothing enforced it.
`tests/integration/ask-market-refusal-invariant.test.ts` now does, order included, because
re-ranking the same true figures to lead with the flattering ones would be a recommendation
assembled entirely out of facts.

The output-side advice detector is deliberately NOT the request-side one. That list is tuned to
over-block, because a wrongly-redirected question is a small harm; over-flagging our own output is
the larger one, and the product's real refusal message contains the words "buy/sell
recommendations". A detector that cannot read a negation would condemn the sentence that does the
refusing. The real message is a test fixture, verbatim. Korean mirrors are present — 적정가,
목표주가, 매수 의견, 매도 의견.

EVOLUTION — FROM COUNTING TO PREDICTING (2026-08-18, shadow)
`clusterProposals()` turns each detected cluster into a claim that can be wrong. Every cluster now
carries a `prediction` and a `falsifiedBy` — the second is the load-bearing field and the easiest
to omit, because a prediction with no stated way to be wrong is a slogan. Observation, instances,
subsystems and per-instance evidence are generated from the ledger, so a proposal cannot overstate
a cluster; the prediction and countermeasure are authored once per category, on the same principle
that assigns `category` at write time. A missing category fails a test rather than producing a
silently empty recommendation.

`npm run evolution:shadow` prints 44 ledger entries, 10 clusters, and every proposal with the
governed actions it would require — decided by the policy engine rather than asserted. No database,
no writes.

THE FOURTH VERIFY ADAPTER — MACRO REGIME (2026-08-18, shadow)
Covers the last v1 output shape, and the only one assembled from more than one provider. Against
the real database both axes with data come back **TRUNCATED** — a verdict no other adapter can
produce. GROWTH stands on one of its two configured series; RATES stands on one of its three, and
the one that computes is the Bank of Korea base rate, which `/today` renders as the RATES reading.
Correctly attributed with provider and date, and with nothing anywhere saying the axis is standing
on a third of its inputs.

The adapter takes the axis's CONFIGURED size rather than counting the readings it was handed, since
counting what arrived would make every axis complete by definition — the completeness failure this
project already shipped once at 1000 of 2240 filings. Axis freshness is the WORST state among the
computed readings: a claim about the present assembled from a stale input is stale.

`cross_source_consistency` still returns NOT_APPLICABLE on real data, because only one series per
axis computes today — the two US Treasury series are untracked pending FRED (HG-002). The
multi-source branch is exercised on a fixture shaped exactly like what RATES becomes once a key
exists, rather than left untested until it silently starts mattering.

All four real v1 output shapes now have adapters, and the shadow run reports four distinct
verdicts: 8 VERIFIED_WITH_LIMITATION, 5 SEMANTIC_REVISION_UNRESOLVED, 3 STALE, 2 TRUNCATED.

REVIEW PACKET A1-A8, WORKED THROUGH (2026-08-18, `gpt-5.6-terra`)
The first pass over the independent-review packet against CURRENT code rather than the range it
was written for. **Seven of eight targets: NO FINDINGS** — A1 Filing Diff, A2 fact identity, A3
revision chain, A5 company identity, A6 test-database guard, A7 secret redaction, A8 CALCULATION
provenance.

**IR-030 (P1, A4) — a short page reported as a complete answer, in all three keyed adapters.** FRED,
ECOS and DART each stopped looping on a short page and returned `truncated: false`, conflating the
reason they stopped with whether they hold everything. `recordIngestRun` marks SUCCESS off that
boolean and `/company` renders completeness from the run, so a partial ingest read as complete —
the 1000-of-2240 defect in a different provider's clothes, with the contradicting field (`count`,
`list_total_count`, `total_count`) received and never consulted.

Reproduced first with three failing tests, then fixed: `truncated` is now derived from
held-versus-declared at every return. A control test asserts that a short page which IS everything
the provider declared still reports complete — every real series ends on a short page, and turning
that into a permanent warning would make the signal worthless. **A v1 change, permitted by the
freeze because it is a reproduced P1.**

REVIEW PACKET A9-A14, WORKED THROUGH (2026-08-18, `gpt-5.6-terra`)
Four findings. **IR-031 (P1, A9/A12) — the long/short vocabulary was missing entirely.** Terra
reported one bypass; reproducing it found seven, in both languages. `Should I short Apple?`,
`Should I go long TSLA today?`, `테슬라 롱 잡을까?` and four more all passed through, while the same
intent phrased as "buy" was caught by four separate patterns. A guardrail that depends on the user
choosing retail vocabulary over trading vocabulary is not a guardrail. Fixed; `long` and `short`
are anchored to a position verb so "short-term rates" stays answerable.

The same review found `fair value` over-blocking legitimate accounting questions, and **the first
fix was wrong**: narrowing the pattern stopped blocking a pinned must-block case from an earlier
round, trading a false positive for a false negative in a legal guardrail. Reverted in favour of a
short exclusion list of fixed accounting collocations, which cannot be used as a bypass and whose
failure mode is over-blocking. One known false positive remains, pinned by a test rather than left
as an oversight.

**Reported and NOT fixed: A11 (P1, latent)** — `/company/[corpCode]` cannot address two providers
sharing a corp code, the IR-001/IR-002 precondition rebuilt at the routing layer. The fix changes a
public URL shape and deserves its own round; recorded in `docs/REVIEW_DEBT.md`. **A14 (P2)** — the
shadow Verify run collapses provider identity the same way, and fixing the copy before the original
would be the wrong order.

**No findings: A10** watchlist authorization, **A13** test-database guard and test realism.

IR-032 — A CORP CODE CHOSE ITS OWN PROVIDER (2026-08-18, P1 latent, fixed)
The A11/A14 items deferred earlier the same day, closed rather than carried. `computeCompanyXray`
resolved the provider by taking the most recent filing carrying the code, and `/company` linked
every `(sourceCode, corpCode)` row to the same URL — so a second company sharing a code was
**unreachable**, and with equal receipt dates the choice was not stable between requests. IR-001 and
IR-002 rebuilt one layer up: scoping fixed the pooling and left the CHOICE untouched.

Reproduced against this repository's own IR-001/IR-002 fixture, which already creates two providers
sharing one corp code. The fix broke all eleven calls in that file, which is the demonstration:
before it, none of them needed to name a provider.

Fixed as a refusal rather than a better tiebreak — `computeCompanyXray` returns null when the code
is ambiguous and no provider is named, `listCompanySources` reports the candidates, links carry
`?source=`, and the page asks. A better tiebreak would still be choosing which company the reader
meant. The shadow Verify run now carries `(sourceCode, corpCode)` pairs and its output ids name the
provider: `filingDiff:SEC_EDGAR:0000320193:Assets:USD`.

Control: an unambiguous code still resolves with no `?source=`, because every real company today
has exactly one provider and a disambiguation prompt for all of them would be worse than the defect.

PHASE — AUTONOMOUS META-LOOP HARDENING (2026-08-18, shadow)
`src/server/evolution/scheduler.ts` wires the three layers that already existed separately.
Evolution proposes, Governance classifies each proposal's required actions, and the scheduler
returns `{ actionable, deferred }` — what an agent may start now, and what cannot start with the
reason attached.

**It approves nothing.** Every authority comes from `evaluateAction`. The scheduler adds exactly
one rule: a proposal is only as permitted as its MOST RESTRICTED required action, which is what
stops "add a test, then deploy to production" being scheduled as an auto-allowed test. A gated
action stays REQUIRES_HUMAN even when a credential is also missing — reclassifying it as an
environment block would file a decision the user is entitled to make as a thing to fix.

**Blocked is not finished.** `isWorkExhausted` is true only when nothing is STARTABLE. A queue of
purely deferred items is blocked work, and treating that as exhaustion is how a missing API key
becomes "the project is done".

**There is no `execute()`**, and a test asserts the module exports exactly two functions, neither
matching `execute|apply|run|commit|perform|mutate`. A scheduler that could run its own output would
close the loop with nothing in between.

Against the real ledger with no provider keys: **9 startable, 5 deferred on HG-002/003/004**. The
first run contradicted a judgement made minutes earlier in the same session — a report had described
the remaining work as gated, and the scheduler found nine startable items from the same evidence.
A queue derived from the ledger is harder to fool than a summary written from memory.

PHASE — ORDERING ENUMERATION (2026-08-18), chosen by the scheduler itself
The meta-loop's first output was `CLUSTER-IDENTITY_MODELLING`, whose countermeasure reads:
enumerate every ordering in `src/server/domain`, state the scope each is unique within, and the
mismatches are the next instances before they happen. Done, as a test rather than a document.

`tests/orderingDeterminism.test.ts` parses every `orderBy` in the domain layer by bracket matching
and requires each to be total — ending on `id` — or to carry an `ORDERING_WAIVER:` saying why ties
cannot matter there. The waiver must be a real sentence, because an escape hatch that costs nothing
becomes the default.

**Twelve sites. Ten genuinely safe**, each now carrying its reason: `Source.code` is unique;
`distinct` on the ordering column leaves nothing to tie; `filingDiff` re-sorts everything through
the total `compareFactCurrency` so the database order decides nothing; the rest are display lists
where position carries no meaning.

**Two are not safe, both in Ask Market, and both deferred (IR-033, P2).** One decides which company
answers a topic; the other selects ten financial facts ordered only by `periodEnd`, where Apple has
**nine** rows sharing `2026-06-27` — including a nine-month NetIncomeLoss of 101.5B and a quarterly
one of 29.8B. `companyXray` and `filingDiff` both fixed this class; this path was missed by both,
which is the cluster's own lesson arriving on schedule: the fix went where the defect had been seen
rather than everywhere the pattern was written.

Not fixed under the freeze — nothing wrong is displayed, both figures carry their period, and the
answer is simply not guaranteed to be the same twice. The deferred pair is held in a list checked in
BOTH directions, so a new undecided ordering fails and so does an entry that has since been fixed.

PHASE — JOIN-KEY ENUMERATION (2026-08-18), the second half of the same countermeasure
The orderings pass covered `orderBy`. This covers the joins, and the one it found is
`IngestRun.target`: a key that five ingest scripts write with five separate string literals and one
reader reconstructs two of by guessing.

```
edgar        padCik(company.cik)
edgar-xbrl   xbrl: + padCik(company.cik)
dart         company.corpCode
ecos         statCode:itemCode1
fred         series.seriesId
```

`assessCompleteness` finds a company's runs with `target: { in: [corpCode, "xbrl:" + corpCode] }`.
It works — 37 Apple runs resolve, 19 filings and 18 XBRL — and it works because five literals happen
to agree with one reader's guess about two of them. That is `RF-02` exactly: a join key written in
display form on one side and storage form on the other, which last time cost a completeness lookup
that returned UNKNOWN forever and read as missing data rather than as a mismatched key.

Under the freeze the answer is not to refactor five scripts. `tests/ingestTargetConvention.test.ts`
makes the convention CHECKED — every script must be recorded, must still write the shape it is
recorded as writing, and the reader must still reconstruct exactly the two EDGAR forms. A sixth
script with a new shape, or a change to either side, now fails here instead of silently detaching a
page from its evidence.

PHASE — GUARDRAIL CONCEPT COVERAGE (2026-08-18), the scheduler's second item
`CLUSTER-GUARDRAIL_COVERAGE`, countermeasure applied: enumerate the CONCEPTS rather than the
patterns. **IR-034 — eighteen direct instructions went straight through, across eight concept
families with nothing covering them**: leverage/margin, options, averaging down, third-party
requests in Korean, hypothetical framing, timing without a verb, portfolio construction, crypto.
`Should I use margin to buy Apple?` was answered normally.

Fixed, with every pattern anchored to an instruction frame — each of these words is also ordinary
financial vocabulary, and matching them bare would break the analytical half of the product to
protect the advisory half. An eighteen-question must-not-flag corpus makes that checkable.

One over-block was caught by that corpus **before it shipped**: the first `dollar cost average`
pattern refused "How does dollar cost averaging work as a concept?", the same mistake `fair value`
made and which took a reviewer weeks to find. Same minute this time.

PHASE — FIXTURE CARDINALITY (2026-08-18), the scheduler's third item
`CLUSTER-FIXTURE_REALISM`, five instances at P0, every one of the form "the suite was green because
its data could not express the failure". Countermeasure: list the dimensions the real data varies on
and mark which are represented by exactly one value.

Measured across all five adapter fixtures. The EDGAR companyfacts fixture carries the variety that
cost the most — two forms, `fy` both null and numeric, `start` present and absent, facts sharing a
period end — and `tests/fixtureRealism.test.ts` now pins each of those, since each was a separate
defect before it was a fixture dimension.

Three dimensions are genuinely single-valued and each is covered by an INLINE stub elsewhere rather
than by the shared fixture: EDGAR's `filings.files[]` overflow, DART's `total_page > 1`, and a short
page before a declared total. The test records the pairing, so a single-valued dimension stays
acceptable only while something else exercises it.

**Two of the five reported gaps were my own measurement error, caught by the assertions before they
became findings.** The probe counted MATCHING ROWS and I read the answer as a CARDINALITY — one row
with a `.` value came back as "1", which looks identical to "one distinct value" and means the
opposite. Both fixtures already carry the missing-value marker they were reported as lacking.
Writing that up would have produced a confident, well-formed, wrong finding from a script rather
than a model, which is not a meaningful difference. Pinned by a test named for what it is.

PHASE — SILENT DEGRADATION (2026-08-18), the scheduler's fourth item
Countermeasure: make every path that can return a subset report the size of the subset AND the size
it expected. Enumerated the subset-returning paths in the domain layer; the one that matters is Ask
Market.

**IR-035 — `findCompanyFacts` caps at ten and `findSeriesFactors` at five. Asking about Apple
returns 10 of 1428 held facts**, and nothing in the result or on `/ask` says the other 1418 exist.
A limit is a reasonable product decision; an undisclosed limit is this cluster's definition, and the
same shape as 1000 of 2240 filings reading as a complete history.

P2, so not fixed in v1 — no figure shown is wrong, and disclosing it means changing the answer
surface. **Closed in shadow instead**: the Verify adapter now carries the shortfall, and the real
shadow run reports both Ask Market answers as **TRUNCATED** with `data_completeness` failing. The
gap is measured and visible in a verdict before it is visible on a page.

Controls both ways: an answer showing everything held is not flagged, and absent holdings report
INSUFFICIENT_EVIDENCE rather than becoming "complete".

PHASE — READ-THEN-WRITE ENUMERATION (2026-08-18), the scheduler's fifth item
`CLUSTER-CONCURRENCY`, countermeasure: list every place that reads a row, decides something, and
writes based on the decision; each is either transactional, constraint-protected, or an instance
waiting to happen.

Enumerated. The event ingest paths are inside `$transaction`, the observation chain is
constraint-protected by a partial unique index, and the watchlist upsert was fixed as CC-03. One
was left: **`signUp` reads `user.findUnique({ email })`, decides the address is free, and creates.**

**IR-036, reproduced with three concurrent signups: exactly one account created — the constraint
holds — and the two losers receive a raw Prisma P2002 rather than the `AuthError` the sequential
path produces.** On the signup form that is a 500 for a user who did nothing unusual. The same
shape as CC-03 and CC-04, both fixed before the freeze: the constraint was added and the HANDLER
was not, so the race was made safe without being made presentable.

P2 and not fixed — nothing corrupted, nothing exposed. The test pins both halves, and the error
shape is asserted **as it currently is, deliberately the wrong way round, so that fixing it breaks
the test.** A known gap asserted as correct behaviour is how a defect becomes a specification.

PHASE — PROVENANCE AT THE PAGE (2026-08-18), the scheduler's sixth item
`CLUSTER-PROVENANCE`, countermeasure: assert provenance where the reader SEES it, because both
instances were rendering failures a domain-level test could not see.

Audited every page. Every FIGURE is properly attributed, including the Macro Regime axes that were
this cluster's last instance — now pinned by a test that reads the page rather than the domain.

**IR-037 — the causal graph is not.** `CausalEdge.evidence` is stored and schema-required ("why
this is believed — established literature/precedent, not a citation-shaped guess"). `CausalFactor`,
the domain type between the database and the page, has no such field, so `/ask` renders direction,
confidence, mechanism, lag and counterexamples and CANNOT render the basis.

The asymmetry is the tell: `evidence` and `counterexamples` are schema-required for the same reason,
and the limitation is shown while the basis is not. A reader sees "MEDIUM confidence" with the
caveats and no way to ask why anyone believes it.

P2, deferred — nothing false is shown, something true is omitted, and the only stored edge is a test
fixture. Pinned the self-correcting way: the absence is asserted as it currently is, so fixing it
breaks the test.

PHASE — THE LOOP'S OWN MEMORY (2026-08-18)
Re-running the scheduler after six completed phases returned the same nine items. It had no way to
tell "not started" from "finished and unrecorded" — an absence read as a state, which is the defect
class this layer exists to notice, in the layer itself.

`COMPLETED_WORK` records each finished proposal with its commit, what exists now that did not
before, and what the countermeasure did NOT cover. A completion needs evidence, not a tick: an
entry with no artefact is a claim that work happened, which is what this project refuses to accept
from any other source.

Four of the six carry a `remaining` note — IR-033, IR-035, IR-036 and IR-037 are each partly
deferred by the freeze — so a partially-addressed cause does not read as a closed one.

**The first version had the semantics wrong**, caught by its own tests: an explicit `completed`
argument REPLACED the record instead of adding to it, so a caller marking one item done silently
un-completed the other six. Now a union.

The queue converges: **3 startable, 5 deferred on provider keys**, down from 9 and 5.

PHASE — ENVIRONMENT MODES (2026-08-19), the scheduler's seventh item
`CLUSTER-ENVIRONMENT_DRIFT`, countermeasure: for each guard, ask what two different strings could
denote the same thing, and what differs between the places this runs. Four hypotheses probed against
the real environments; **all four refuted**, and recording that is the point — a cluster does not get
to keep producing findings just because it exists.

1. _CI skips every integration test, because it blanks `DATABASE_URL`._ Refuted: `vitest.config`
   rewires it from the guard's decision, so the 39 integration files run there as they do locally.
2. _File-content assertions break on CRLF._ Refuted: no test asserts a multi-line literal against
   file text.
3. _The no-database path is broken._ Refuted: 569 pass, 205 skip, 39 files skipped, cleanly, in 28s.
   The documented "350 unit tests, 30 files" was stale and is corrected.
4. _ADMIN_EMAILS is frozen into the production build._ Refuted: `/admin` is `force-dynamic` and
   builds as `ƒ`, so the allowlist is read per request.

`tests/environmentModes.test.ts` pins the two mechanisms those answers depend on — the DATABASE_URL
rewiring, and that every integration file gates on one identical idiom so the rewiring covers all of
them. Remove either and CI would create a test database, migrate it, then skip everything that would
use it while reporting green.

PHASE — CAP-CEILING / GENERALIZED COMPLETENESS + THE FLAKE (2026-08-19)
Two findings, both P1-or-cause and both reproduced.

**IR-038 — EDGAR reported complete from its own page cap.** IR-030 fixed FRED, ECOS and DART, each
deriving `truncated` from why its loop stopped. EDGAR was not in that finding and had the identical
line: `truncated: overflowFiles.length > MAX_OVERFLOW_FILES` — a statement about OUR page cap, not
about holding what SEC says exists. `providerTotal` was computed two lines above, carefully, and
never compared. Reproduced: declared 501, held 101, reported complete. **This is the live path** —
EDGAR is the only provider with real data. Fixed; checked against the real runs first
(`providerTotal=2240, fetched=2240`), so live behaviour is unchanged and the fix fires only on a
genuine disagreement.

**IR-039 — the flake, identified.** Found by capturing full output on a failing run instead of
rerunning green ones; eight reruns were never going to find it, because the failing run's output had
been piped through `tail`. `watchlist-actions`'s `beforeAll` exceeds the 10s hook timeout under
contention, leaving ids unset, and the `afterAll` that dereferences them throws — **and the
teardown's error is the one that gets reported.** Fixed with a guard and a 60s hook. Deliberately
not `deleteMany`, which reads `undefined` as "no condition" and would delete every user.

CONTINUATION PROTOCOL — STATE-BASED (2026-08-19)
Recorded in `CLAUDE.md` (read first every session) and `docs/DECISIONS.md`. Work continues while a
safe runnable task exists; absolute time is never a completion condition. Checking the repository
first found that **no time-based termination had ever been persisted** — the deadlines lived only in
chat, so there was nothing to replace.

`evaluateStopSentinel()` extends the existing scheduler rather than starting a second mechanism. It
answers the protocol's six conditions instead of the queue's one, and **an unsupplied count blocks
stopping rather than defaulting to zero** — the scheduler cannot see a failing build or an unread
review finding and must not pretend to. Unknown is not success, applied to the thing that decides
whether to stop, where the wrong default would be self-concealing.

Open escalations are recorded and never obeyed as a halt.

TESTS
2588 / 2588 PASS across 145 files against a real local PostgreSQL 16.10 (up from 209 in the cloud
environment) -- 2569 passing plus 19 pinned `it.fails`, which are reproduced defects deliberately
NOT closed and which the total must not quietly absorb.

MEASURED 2026-09-01 on `claude/ask-guardrail-architecture-20260823` at `ccff24d` plus the open-id
correction committed on top of it. `scripts/inbox-triage.ts` mechanises the check `CLAUDE.md` states
and nothing enforced, read-only, and it now answers BOTH questions the rule names: commit staleness
and whether the protocol id is open. The earlier `11 STALE_REFRESH_REQUIRED` was over-claiming —
the outbox records no escalation posted from here, so no id's standing can be established and all 11
are `NOT_ACTIONABLE (STANDING_UNVERIFIABLE / STALE_REFRESH_REQUIRED)`. Nothing applied, resolved or
refreshed. Recorded under IR-114.

Previously at `bbf452e` plus the operator-boundary repair committed on top of it. Relational operators (`< <= > >=`) run ToPrimitive
on object operands, and this schema's generated rows carry `Decimal`, `DateTime` and `Json`, so a
proven-inert READ was still admitting a coercing USE; both now need separate proof. Five controls
added; order-reach mutations 11/11 ISOLATED. Corpus unmoved at 34 / 16 ORDER_SURVIVES / 18 UNREAD.

Previously at `15bf018` plus the stop evidence gatherer, from one fresh run on that tree. One new file,
`tests/stopEvidence.test.ts`. `evaluateStopSentinel()` -- the only normal completion sentinel -- had
one non-test caller supplying one of its nine inputs, so eight conditions had never been evaluated
against reality. `scripts/stop-evidence.ts` now establishes what the machine can prove and reports
the rest WITH THE REASON. Against the live runtime root it immediately found 11 unjudged decisions
in the durable inbox and a STOPPED watcher -- see `docs/REVIEW_DEBT.md` IR-114. Date, SHA and what changed are written in one edit, because the last correction here
was a count revised upward while the date was left alone.

`tests/documentedCounts.test.ts` caught this line being stale before a human did, which is what it
is for: it failed with "PROJECT_STATE says 138 test files; 139 exist" on the run that added the
file. A documented number nobody re-measures is the failure class this whole section is about, and
here the suite re-measures it.

PROVENANCE CORRECTION, and the defect is instructive. This line read `2412 / 2412 ... measured
2026-08-28`, and the count had been revised upward on 2026-08-30 while the DATE was left alone.
Independent review caught it: the tests being counted did not exist on 2026-08-28, so a current
number was inheriting an old measurement's authority. A count and the date it was taken are one
fact, not two, and updating half of it silently is how a document starts self-certifying. Both
halves move together from here, and the SHA is named so the claim can be re-run rather than
believed.

CORRECTED: an earlier version of this line said 2297 / 2297 and then, two clauses later, 2285
passing plus 12 -- numbers that could not both be right and were not. Both reviews caught the
inconsistency. The figures above come from one fresh run on the exact tree rather than from
arithmetic over remembered ones; earlier that day 2214 across 127 on 2026-08-26 (2192, 2188, 2184, 2182, 2178, 2176 and 2169 earlier that day, 2165 on 2026-08-25, 2048 on 2026-08-24,
1894, 1888 and 1878 earlier that day, 1847 on 2026-08-23, 1838 on 2026-08-21; the hundred and
eighty-five since are IR-100 publication-authority, IR-101 output-authority, IR-102
publication-class, IR-103 candidate-relevance, IR-104 subject/operation-authority, IR-105
direction/nesting, IR-106 relation-cardinality/polarity, and IR-107 request-authority
corpus-integrity, operation-envelope, temporal-period and Korean-morphology controls). Counts here
are measured, never estimated. Two further tests are PENDING invariants marked `it.fails` and are
NOT counted as passes. `requestAuthorityKorean.test.ts` states that an overt Korean case marker
should not by itself prove a nominal host; `integration/ask-market.test.ts` states that two stored
names differing only in punctuation are not the same subject. Both throw today, which is what
`it.fails` expects, and each begins failing the day the invariant becomes true — a constituent
analyser for the first, a lossless canonical subject key for the second. The frozen release candidate
c03aa73 measured 1580 / 1580 across 110 files; the three files since are release tooling that is
deliberately not in it.
`npm run e2e` 33/33 checks in a real browser against the **production build** (up from 12) — the
walkthrough drives the Ask Market guardrail and the Company X-Ray page through real rendered
HTML, not just the domain functions. `npm run verify:live:edgar` **67/67** against real
data.sec.gov. **Gate status, one line, no contradiction: lint clean, typecheck clean, build clean
UNDER WEBPACK, format ENVIRONMENT_LIMITED.** This sentence used to end "lint / typecheck / format /
production build all clean" and then two paragraphs explained that two of those four cannot run
here — a summary asserting PASS above the measurement that says otherwise, which is the failure mode
this file exists to prevent. Details follow and the summary must keep agreeing with them.
**In this worktree the build
gate must be run as `next build --webpack`** (2026-08-26): `node_modules` here is a symlink to the
main checkout's, and Turbopack refuses it — `Symlink [project]/node_modules is invalid, it points
out of the filesystem root` — during module resolution, before compiling anything. Webpack builds
the identical tree clean. It is an environment limitation of the linked worktree, not a defect in
the tree, and it must not be "fixed" by changing product code.

**`npm run format:check` cannot pass in this worktree either** (2026-08-26), and the earlier claim
that it did was never measured. `core.autocrlf=true` checks every file out with CRLF — measured,
not inferred: `tsconfig.json` 34/34 CR lines, `vitest.config.mts` 43/43, `askMarket.ts` 1576/1576 —
while `.prettierrc` sets no `endOfLine`, so prettier's `lf` default flags the whole repository. 292
files, most untouched for weeks. `prettier --write` on individual files is what has actually been
run, and that is a weaker claim than the gate passing. Do NOT reformat 292 files to make it green:
that is a repo-wide diff fighting a checkout setting, and it hides an environment fact behind a
product change. Record the gate as ENVIRONMENT_LIMITED.

**Read a gate's OWN exit status.** `npx next build | tail` reported exit 0 while the build was
failing, and `npx prettier --check | tail -6; echo $?` reported 0 directly beneath "issues found in
240 files" — both times `$?` belonged to `tail`. Redirect to a file and capture the exit code of the
command itself. This mistake has been made twice in one session, the second time an hour after
writing the first one down. Full suite 136-516s against a live
database across several runs — the variance is real and is the integration files contending for
one Postgres, not noise worth averaging away.

A run measured on 2026-08-20 reported 947 passed and **205 skipped across 39 skipped files** in
179s and looked, at a glance, like a pass. It was not one: `TEST_DATABASE_URL` was absent from that
shell, the fail-closed guard correctly declined to fall back to `DATABASE_URL`, and every
database-backed file skipped. Same tree, same command, 179s versus 516s. The skip count is the
tell, and it matches the documented no-database baseline exactly. Recorded because the failure
looks like success in every line of the summary except the one that says `skipped`.

Tests run against a disposable database, enforced fail-closed. With no database at all, **569 tests
pass and 205 skip across 39 skipped files**, cleanly, in 28s (measured 2026-08-19; the "350 unit
tests, 30 files" recorded here for several rounds was stale) — a path that is
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

0. ~~Push the local commits~~ **DONE** (HG-001 closed 2026-08-20). Branch published, PR #1 open.
1. ~~Codex re-review~~ **DONE for Gate A** — `reviews/market-os-final-review.json` holds the
   machine-readable result against candidate `6103ad8`, per `[CHATGPT_DECISION][RC-GATES-001]`.
   What remains is mechanical rather than gated: the two P1 fixes it produced are not contained
   in `6103ad8`, so they form a new candidate that needs its own review, its own green remote
   CI, and its own two-SHA attestation. Correctness outranks SHA stability
   (`[CHATGPT_DECISION][MARKET-RESUME-002]` item 4), so the candidate moves rather than the
   findings being deferred.
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
