# Review Debt

Tracks Codex reviews that are pending, deferred, or resulted in an unresolved disagreement
(`HUMAN_DECISION_REQUIRED`). Empty entries mean no debt.

> **2026-08-17 correction.** Many "Reason deferred" cells below say a provider host is
> "egress-blocked in dev". That described the Claude Code Web sandbox and is **no longer true**:
> development moved to a local machine, and data.sec.gov, api.stlouisfed.org, ecos.bok.or.kr and
> opendart.fss.or.kr are all reachable. The real blocker for FRED/ECOS/OpenDART is now a free API
> key the user must register for (`docs/HUMAN_GATE_QUEUE.md` HG-002/003/004), and for SEC EDGAR
> there is no blocker at all — it has been live-verified. Individual rows are corrected below;
> treat any remaining "egress-blocked" wording elsewhere as historical.
>
> The same round found that H3's fix was itself defective and re-fixed it structurally; see that
> row and `docs/CODEX_REVIEW_PACKET.md` §0.1 R1.

| Milestone | Item                                                                                                           | Reason deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status             |
| --------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| M01-M22   | DB schema + full adapter/domain pipeline through Auth                                                          | 2026-08-16: a human ran the local-Codex review path (`docs/CODEX_REVIEW_PACKET.md` §12) and got a real verdict — **REVISE**, 3 P0/HIGH blockers (auth migration upgrade safety, claim-verification substring collision, concurrent-ingestion race). All 3 were fixed directly by Claude (Codex quota limited) with dedicated real-Postgres regression tests per blocker — see DECISIONS.md's "Fixed all 3 P0 blockers from the first real Codex REVISE verdict" entry for BEFORE/AFTER detail on each. 3 recommended P1s were fixed too. Awaiting Codex **re-review** against the new HEAD — this row stays `PENDING` until that re-review returns `APPROVE` (a fix round is not a self-declared pass; see CLAUDE.md/CODEX_REVIEW_PACKET.md §14)                                                | PENDING            |
| H1        | Auth migration upgrade safety — FIXED, awaiting Codex re-review                                                | Was: `ADD COLUMN ... NOT NULL` with no `DEFAULT` on `users`, only survivable against an empty table. Fixed as a staged migration (nullable → legacy backfill with synthetic identity/sentinel hash → NOT NULL) plus a `signIn()` check that rejects `isLegacyAccount` before ever touching the sentinel hash. Real-Postgres upgrade regression test added (`tests/integration/auth-migration-upgrade.test.ts`) — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                               | PENDING            |
| H2        | Claim verification structural redesign — FIXED, awaiting Codex re-review                                       | Was: FACT verification via `claimText.includes(value)`, vulnerable to substring collisions (e.g. "3.5" inside "13.50") and to a claim whose free text disagreed with its own evidence. Fixed with exact-text reconstruction (shared builders reused by both the creation and verification paths) plus explicit series/source identity and chronological-order checks, and full recomputation of CALCULATION's derived numeric fields. 9 new adversarial regression tests — see DECISIONS.md                                                                                                                                                                                                                                                                                                     | PENDING            |
| H3        | Concurrent observation ingestion race — first fix was DEFECTIVE, re-fixed 2026-08-17, awaiting Codex re-review | Was: read-then-create, with no real DB guarantee against two concurrent "original" inserts. The first fix (partial unique index + atomic INSERT-ON-CONFLICT-DO-NOTHING + bounded retry) was right about the constraint and wrong about how it found the chain's "latest" row: `orderBy: retrievedAt desc` on a `timestamp(3)` column, so an original and its revision written in the same millisecond were indistinguishable and Postgres could return either first. All 3 concurrency tests passed against the defective version, and the bug was not even concurrency-only — a sequential re-ingest of already-revised data reproduced it. Re-fixed structurally: the tail is the row nothing else points at via `revisionOf`. See DECISIONS.md 2026-08-17 and CODEX_REVIEW_PACKET.md §0.1 R1 | PENDING            |
| M21       | Ask Market: deterministic topic-search safe mode DONE; free-text conversational Q&A still BLOCKED_HUMAN_GATE   | `src/server/domain/askMarket.ts` + `/ask` ship a zero-LLM-cost topic search (matches a query against tracked Series/CausalEdge/FinancialFact data) with a deterministic personalized-advice-request detector and redirect, enforcing the LEGAL_GUARDRAILS.md "삼성전자 지금 살까?" requirement today. Full natural-language Q&A (arbitrary free text, INFERENCE claims) still needs a live LLM call at product runtime — a different cost category from this session's own Claude Code/Max 20x usage — and still requires a human decision on provider/funding/credentials — see DECISIONS.md                                                                                                                                                                                                   | BLOCKED_HUMAN_GATE |
| M04       | ECOS missing-value marker unverified against a live API response                                               | Host IS reachable (the old egress note was the cloud sandbox). Blocked only on a free ECOS_API_KEY — HG-003. `scripts/verify-ecos-live.ts` is written and specifically reports every distinct non-numeric `DATA_VALUE` marker it observes, and says so explicitly when a window contains no gaps at all rather than treating that as confirmation                                                                                                                                                                                                                                                                                                                                                                                                                                               | LIVE_KEY_PENDING   |
| M05       | OpenDART list.json field names/status codes unverified against live API                                        | Host IS reachable. Blocked only on a free DART_API_KEY — HG-004. `scripts/verify-dart-live.ts` written, including a real check of the `013` no-data mapping the client branches on. Two related defects were found by code reading and already fixed: single-page truncation (100-row cap with `total_page` ignored) and a missing impossible-date guard on `rcept_dt`                                                                                                                                                                                                                                                                                                                                                                                                                          | LIVE_KEY_PENDING   |
| M06       | EDGAR submissions.json field names verified against live API — CLOSED                                          | 2026-08-17: live-verified from a local machine, 55/55 contract checks (`npm run verify:live:edgar`), including the parallel-array alignment of `filings.recent` that the adapter's correctness depends on. Followed by a real ingest of 1000 Apple filings and a re-ingest confirming idempotency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | DONE               |
| M07       | No live news/metadata source wired                                                                             | ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov were all egress-blocked; a news source wasn't assumed reachable without checking — deferred until one is identified and confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PENDING            |
| M08       | `releaseDate` unset by every adapter (only `observationDate` is populated)                                     | Still deferred, and 2026-08-17 sharpened why so nobody "fixes" it wrongly. FRED's `realtime_start` looks like the missing release date and is not one: under default parameters FRED answers with the vintage as of today, so every row — including a 1990 observation — comes back stamped with today's date. Mapping it to `releaseDate` would fill a provenance column with a confident, checkable, wrong answer, which is worse than null (docs/DATA_POLICY.md). Real publication dates need an explicit realtime range (1776-07-04..9999-12-31), which returns multiple vintage rows per observation date — a different ingest shape. `scripts/verify-fred-live.ts` reports the distinct `realtime_start` values so the decision rests on evidence rather than on this reasoning           | PENDING            |
| M08       | No automatic cross-source `DataConflict` detection                                                             | The model and manual-insert path are tested (M02/M07 tests), but no adapter yet compares its own value against another source covering the same real-world variable — needs ≥2 overlapping sources tracked for the same series first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PENDING            |
| M09       | `verifyClaim` doesn't support INFERENCE claims                                                                 | No real INFERENCE producer exists yet (that's M21 Ask Market); FACT and CALCULATION are both supported and tested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PENDING            |
| M11       | 5 of 8 regime axes (Inflation/Liquidity/Risk/USD/Credit) have no ingested data yet                             | Blocked only on a free FRED_API_KEY (HG-002), not on reachability — api.stlouisfed.org answers from this machine. Series are tracked and computeRegimeSnapshot correctly reports NOT_TRACKED/INSUFFICIENT_DATA rather than fabricating readings. This is the largest visible product gap and the reason FRED is the first key to action                                                                                                                                                                                                                                                                                                                                                                                                                                                         | LIVE_KEY_PENDING   |
| M12       | Economic Calendar has no consensus/surprise/actual-vs-expected data                                            | Host reachable; still no free consensus source identified, and guessing at FRED release_id mappings without live verification remains rejected as unsafe for financial-calendar data — see DECISIONS.md. The FRED Releases API becomes explorable once HG-002's key lands, but a consensus/expectations feed is a separate question the key does not answer                                                                                                                                                                                                                                                                                                                                                                                                                                     | PENDING            |
| M13       | No multi-hop causal-path traversal                                                                             | No real consumer needs it yet (that's M21 Ask Market); would be speculative work ahead of a real caller — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PENDING            |
| M14       | Historical Analog Engine is single-series only, untested against real multi-year history                       | Multi-variable regime-state analog deferred as materially more complex for a first version; this dev DB has little real ingested history yet (no FRED_API_KEY — Human Gate) so real-world usage is unverified beyond the algorithm's correctness tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PENDING            |
| M06/M15   | EDGAR filing-shape and XBRL companyfacts-shape verified against live API — CLOSED, and it found real drift     | 2026-08-17: both endpoints live-verified. The XBRL shape, built from SEC's published documentation, was **wrong**: SEC returns `fy: null, fp: null` on some companyfacts rows (facts republished for a `frame` under a later restating filing — Apple alone has 20 across the six tracked concepts), while both the adapter types and the `financial_facts` columns were non-nullable. A real ingest would have failed on the first such row. Fixed by widening, not by guessing a label or dropping the row. This entry is the evidence for the standing rule that provider documentation is not the provider                                                                                                                                                                                  | DONE               |
| M15       | Company X-Ray covers only 6 core XBRL concepts, EDGAR only, no filing text                                     | Risk factors / management-language changes need filing document text (HTML/PDF), which no adapter fetches yet; DART/Korean structured financials are separate future work — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PENDING            |
| M16       | Filing Diff text-half (new/removed risk factors, management-language changes) not built                        | Requires a filing-text-fetching adapter (raw document HTML/text) that doesn't exist yet — DART/EDGAR/XBRL adapters all stop at metadata/structured facts; blocked on that prerequisite, not forgotten — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | PENDING            |
| M17       | No ETF holdings ingestion adapter — schema + guardrail enforcement + aggregation only                          | ssga.com and ishares.com both confirmed egress-blocked in dev via WebFetch; issuer holdings files also aren't a stable documented public API the way FRED/ECOS/DART/EDGAR are, so a guessed-format adapter was rejected as too fabrication-prone — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PENDING            |
| M18       | No MOLIT/data.go.kr ingestion adapter — schema + median-based analysis only                                    | data.go.kr confirmed egress-blocked in dev via WebFetch, consistent with every other financial-data domain tested this session — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PENDING            |
| M25       | No real cron/queue scheduler — job runner is a manually-invoked script                                         | An unattended scheduler only makes sense once something is actually deployed unattended; production deployment is a Human Gate per CLAUDE.md until approved. `scripts/run-ingest-jobs.ts` is deployment-agnostic and ready to be wired behind whatever scheduler the deployment platform provides once that gate clears — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                      | BLOCKED_HUMAN_GATE |
| M26       | Login brute-force protection is process-local/per-email only, no IP-level or distributed rate limiting         | A distributed/IP-aware limiter needs shared infrastructure (Redis, an edge/WAF rate limiter) — the same "no new hosted service without a human decision" boundary M25 respects; the current per-email in-memory lockout covers the realistic single-attacker-vs-single-account threat but not credential stuffing across many accounts/IPs — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                   | PENDING            |
| M28       | Timezone/KST-boundary test coverage — CLOSED                                                                   | Confirmed ECOS/DART date-only parsing was already correctly UTC-safe (`Date.UTC(...)`); added dedicated boundary tests (Korean New Year's Eve/Day, leap day, year/quarter boundaries) locking that in. Also found and fixed a real gap: `/today`/`/admin` rendered timestamps with `toLocaleString()`, which resolves in the SERVER's local timezone in a Next.js Server Component, not the viewer's — replaced with an explicit `formatTimestampUtc()` helper — see DECISIONS.md                                                                                                                                                                                                                                                                                                               | DONE               |
| M28       | User-facing stale-data marking — CLOSED                                                                        | Added `src/server/domain/staleness.ts` (`evaluateStaleness`, reusing `economicCalendar.ts`'s existing cadence projection) and wired it into `buildMorningBrief`'s `whatChanged` entries plus a visible "STALE" badge on `/today`. A series with too little history to project a cadence is UNKNOWN, never falsely marked FRESH — see DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                               | DONE               |
| M16       | Filing Diff cannot show an original-vs-restated comparison                                                     | Deliberate, recorded 2026-08-18 so it is not mistaken for the +233% bug returning. A period-over-period change now requires a DIFFERENT period end, which by construction excludes a restatement of the same period (same length, same end, different accession). That exclusion is correct: a restatement is not a period-over-period change and showing it in that section would be the same category error the +233% defect was. But it does mean restatements are currently invisible in the UI even though both rows are stored and provenance is intact. A "this figure was later restated" surface would be a real feature; it is not built, and is not being built speculatively                                                                                                        | PENDING            |
| M11       | Unit strings are matched exactly and case-sensitively                                                          | `computeChange` branches on `unit === "percent"` to decide whether basis points are meaningful, and a series declared "Percent"/"pct"/"%" would silently return `bpsChange: null` while every other number stayed correct. No such typo exists today. `tests/unitVocabulary.test.ts` pins every tracked series to a known unit vocabulary so the next one fails at test time; a stricter type-level unit would be the fuller fix and is not warranted at five units                                                                                                                                                                                                                                                                                                                             | MITIGATED          |

## IR-113 — a nondeterministic factor order, found through a one-off test failure (explained 2026-09-01)

    tests/integration/ask-market.test.ts
      "serves a current level as a level, with no change and no mechanism attached"
      AssertionError: expected 530 to be 102

**MY FIRST WRITE-UP OF THIS WAS WRONG, and correcting it is most of the entry.** I recorded it as a
latent CROSS-FILE interaction on the shared test database, exposed by timing, with two candidate
causes and neither established. Looking instead of theorising found the cause inside a single file,
and it is not a race.

TWO series carry the same name. `ask-market.test.ts` seeds `TEST Widget Price Index` under
`SOURCE_CODE` at 102 and a SECOND one under `OTHER_SOURCE_CODE` at 530 — deliberately, because the
attribution test in the same file exists to prove a reader can tell two providers apart. The failing
assertion then selected with

    result.seriesFactors.find((f) => f.seriesName === SERIES_NAME)

which matches BOTH. It was asking an ambiguous question and getting one of its two right answers.
Nothing was wrong with the answer.

**THE PRODUCTION SIDE IS THE REAL FINDING.** `findSeriesFactors` in `src/server/domain/askMarket.ts`
reads its candidates from

    prisma.series.findMany({ where: sourceId ? { sourceId } : undefined, include: { source: ... } })

with NO `orderBy`. So the ORDER in which factors are presented to a user is whatever Postgres hands
back. Two providers reporting the same indicator can appear in either order, and the same request
can answer differently between runs. The values and their attributions are correct either way —
this is a determinism defect, not a wrong-fact defect.

`scripts/recency-audit.ts` classifies that site STRUCTURAL: "arrival-keyed but no local selection —
orders presentation rather than deciding a winner here." That classification is RIGHT about
recency and it is exactly where this defect was sitting. Nondeterministic PRESENTATION order is a
different question the recency audit does not ask, and the STRUCTURAL bucket is where it hides.

FIXED HERE: the test, which now selects by `sourceCode` and separately asserts the name. A test
that asks an ambiguous question is a defective test whatever the production code does.

NOT FIXED: the ordering itself. Adding an `orderBy` to that query is a V1 product change, and the
freeze admits reproduced P0/P1 only. Severity is P2 on the evidence available — the output stays
honest and attributed, and no figure is wrong — so it is recorded rather than slipped in behind a
test fix. The minimal repair, when the freeze permits, is a deterministic total order on that
query; `sourceCode` then `externalId` would do, and it needs its own must-not-move controls because
it changes the order of every multi-source answer.

## IR-112 — a politeness hedge is read as a prohibited request (reproduced 2026-08-31, P1)

    "Latest reading on the eurozone unemployment rate."                  -> CURRENT_OBSERVATION
    "Latest reading on the eurozone unemployment rate, if you have it."  -> PROHIBITED
    "What is the current US headline CPI, if you have it?"               -> PROHIBITED
    "What is a Eurodollar, if you have it?"                              -> PROHIBITED

Appending `, if you have it` to an otherwise answerable request makes it PROHIBITED. It is not
specific to one operation — a definition goes the same way — and `, if available` does NOT, so the
trigger is the second-person possession wording rather than the hedge itself.

MECHANISM, LOCALIZED BY MEASUREMENT (2026-08-31, HEAD `c772c4d`). The heading above is wrong about
what this is, and the correction is the finding. It is not a hedge-vocabulary problem. A trailing
construction's SUBJECT REGION runs to the end of the request, and only ONE trailing constituent —
the interval, via `withoutInterval` — is ever taken back out of it. Everything else after the
subject is absorbed INTO the subject and then tested as if it were the subject. Printing the bound
region says so directly:

    "What is the latest US CPI reading?"                    subj=[ us cpi reading ]
    "What is the latest US CPI reading, if available?"      subj=[ us cpi reading if available ]
    "What is the latest US CPI reading, thanks?"            subj=[ us cpi reading thanks ]
    "What is the latest US CPI reading, if the desk has it?"
                                                    subj=[ us cpi reading if the desk has it ]
    "What is the latest US CPI reading, if you have it?"    PROHIBITED

So `, if available` is not handled correctly — it is handled WRONGLY AND QUIETLY. The adjunct binds
as part of the subject the repository will be asked to match; the row only survives because English
subject identity is `OCCURRENCE`, so a stored name occurring inside the corrupted region still
matches. `, if you have it` is the same absorption with a louder consequence: `you` lands in
`PERSONAL_PRONOUNS`, whose own comment justifies the class as "a question about the person asking",
which the addressee is not.

The exact-cover machinery that should have caught this is present and correct — `match.residue`
refuses anything the grammar did not read, as UNSUPPORTED. It never fires here because the region
is a SINK: material that was never read is nonetheless counted as read, by being called the subject.

WHAT THE MEASUREMENT ALSO SHOWS, and it is the part that makes a repair tractable. The genuine
negative controls do NOT rent their refusal from this mechanism. All three mixed factual+directive
corpus rows are refused by the advice detector on its own absolute precedence, not by the absorbed
pronoun:

    DEV-EN-171 / 173 / 178   PROHIBITED  "asks the product to decide, choose or act on the
                                          reader's behalf"
    DEV-EN-024               PROHIBITED  "the subject of the request is the reader"   <- only this
                                          one is the false positive

Whole development corpus, 500 rows: 18 carry a trailing comma-adjunct; of those, 4 are PROHIBITED
(3 correctly, 1 falsely), 2 are AUTHORIZED with a visibly corrupted subject (DEV-EN-015,
DEV-EN-030, both `please`), and both of those are stopped downstream at `blocked/FRAME_NOT_PROVEN`,
so the corruption is latent rather than serving-visible today. Baseline at this HEAD: 78 AUTHORIZED
/ 52 PROHIBITED / 16 AMBIGUOUS / 354 UNSUPPORTED, 0 planner calls across all 500, 0 THREW, real
local PostgreSQL through `answerWithInference()`.

DIRECTION OF REPAIR, recorded so the next unit does not start from the wrong end: stop the subject
region being a sink. Its right edge must be a boundary, and the remainder must be a constituent
that is either CONSUMED as a licensed adjunct or routed to residue and refused. Licensing must be
derivable rather than listed — an adjunct that binds no operand, carries no clause connective and
no first-person possessive, and does not trip the advice detector — because a phrase list of
politeness forms is the open-class enumeration this project has already paid for repeatedly. An
unlicensed adjunct must REFUSE, never admit.

MEASURED WITH, all read-only and committed alongside this entry: `scripts/ir112-probe.ts`,
`ir112-subject.ts`, `ir112-negative.ts`, `ir112-corpus.ts`, `ir112-counterfactual.ts`. English only;
the Korean path was not measured and no claim is made about it. No sealed holdout was opened.

THE REPOSITORY ALREADY RUNS THE EXPERIMENT, and this is the part that decides the repair. Of the
twelve construction rows, ELEVEN have `markers: [<opener>, null]` — no closing marker, so the
subject runs to the end. Exactly one has a real right edge: `what does X mean`. Put the same tails
on both and the correct behaviour is already there, on the closed one only:

    closed   "What does quantitative easing mean, if you have it?"
                 UNSUPPORTED   residue carries "if", "you", "it"
    open     "What is the latest US CPI reading, if you have it?"
                 PROHIBITED    `you` absorbed into the subject

    closed   "What does quantitative easing mean, please?"   subj=[ quantitative easing ]
    open     "What is the latest US CPI reading, please?"    subj=[ us cpi reading please ]

So the target behaviour is not a design that has to be argued for — it is what this grammar does
wherever a subject right edge exists, and the defect is the eleven rows that have none.

AND THE PRICE IS LOWER THAN THIS ENTRY FIRST SAID. `please` is already in `FRAMING_TOKENS`, so it
is exempt from the residue check; `thanks` and `if` are not. Under a right edge, DEV-EN-015 and
DEV-EN-030 therefore bind a CLEAN subject and stay AUTHORIZED rather than being lost. The corpus
cost is one row moving PROHIBITED -> UNSUPPORTED and no recall loss at all — not the two-row loss
recorded above, which was assumed rather than measured.

WHAT STILL BLOCKS IT. Nothing supplies the right edge for the eleven open rows. Normalization has
already removed the punctuation by the time the subject region is formed (`Smith, Jones` arrives as
`smith jones`, `Yahoo! Finance` as `yahoo finance`, `U.S.` as `u s`), so a comma rule is not merely
unsafe, it is not available. Deciding the edge from stored names would make repository inventory
segment the sentence, which was removed before. A closed subordinator class (`if`, `unless`,
`while`, ...) is finite and positively statable, but its omission direction is wrong: a subordinator
left out keeps its clause inside the subject, which ADMITS. Recorded as considered and rejected.

THE COUNTERFACTUAL, AND IT COMES BACK NEGATIVE. `scripts/ir112-counterfactual-boundary.ts`. This
repository has already solved "where does a constituent end" once, for sentence terminators:
`fragments` carry RAW-query coordinates, and `confirmedBoundary` accepts a break only on the TAIL'S
TEXT — a clause-initial token, a boundary-adjacent determiner, or Hangul carrying a predicate. Its
own comment says why nothing cheaper works: "At the cover level the bad case and the good one are
the SAME OBJECT: fragment 0 reads, fragment 1 does not, the join reads."

So the counterfactual changes exactly one thing and holds the authority fixed — candidate geometry
widened from terminators to the COMMA, accept/reject still the existing positive tail-text rule.
Punctuation as geometry, clause-opening evidence as authority. Over the 29 comma-bearing corpus
rows it is well behaved: 24 confirmed, 5 not, and `Smith, Jones revenue` is correctly among the 5,
so the old comma/identity failure class does not return.

It still does not repair IR-112, and the reason is exact:

    "if you have it"   CONFIRMED      but because `have` is an auxiliary in the class,
                                      not because of anything about the adjunct
    "if available"     NOT CONFIRMED
    "thanks"           NOT CONFIRMED
    "please"           CONFIRMED      it is an imperative opener

The mechanism splits the very class IR-112 names, along a line unrelated to the defect, and the one
member it catches it catches by luck. That is coverage, not grammar. Per item 6 of
`[CHATGPT_DECISION][MARKET-IR112-RIGHT-EDGE-REFRAME-20260831]`:
**`NO_SAFE_REPAIR_FOR_THAT_CONSTRUCTION`** — the eleven opener-only constructions stay fail-closed
and IR-112 stays open debt rather than being closed on a guessed boundary.

SIDE FINDING, checked before being claimed and then downgraded. `CLAUSE_OPENING_TOKENS` carries
`will would can could may might must` but not `should` or `shall` — a hand-written closed modal
paradigm with two members missing, which is the omission pattern this module's own comments keep
recording. It has NO measured consequence: `scripts/ir112-modal-gap.ts` varies only the modal
across a real sentence boundary, and `Should`/`Shall` come back PROHIBITED via the advice detector
while all seven present modals are UNSUPPORTED. The advice screen's precedence happens to cover
exactly the two that are missing. Recorded as inert, not as a P1.

WHY THIS IS WORSE THAN A RECALL GAP. UNSUPPORTED says the product could not read the request.
PROHIBITED says the request was not allowed to be asked, and `docs/LEGAL_GUARDRAILS.md` gives that
screen absolute precedence over every other reading. A reader who politely writes "if you have it"
is told their question about a public price index is disallowed. That is a false positive on the
one check that is designed to be unappealable.

NOT YET REPAIRED, and deliberately not repaired in the same breath as it was found. The advice
guardrail is the most safety-sensitive surface in the product and its false-NEGATIVE direction is
what IR-085/IR-090 were about; loosening it to fix a false positive is exactly the trade that needs
measurement and an architecture pass rather than a quick edit. The holdouts must not be opened for
it either.

HOW IT WAS FOUND, because the route matters more than the row. An architecture pass proposed a
`<marker> <MEASURE_HEAD> of|on|for <SUBJECT>` construction to close six CURRENT_OBSERVATION rows,
diagnosing a closed head-noun slot. Reproduction refuted that diagnosis:

    head varied, frame constant   print / observation / value / reading / number / figure
                                  -> ALL SIX already recognised
    frame varied, head constant   "The most recent value of X, please."      -> recognised
                                  "I'd like the most recent value of X."     -> UNSUPPORTED
                                  "I'd like the most recent print of X."     -> UNSUPPORTED

So there is no MEASURE_HEAD gap at all. The six rows fail on their REQUEST FRAME. Imperatives are
handled (`Give me`, `Show me`, `Tell me`, `Please give me`); first-person desideratives
(`I'd like`, `I need`, `I want`) and polite interrogatives (`Could you pull`, `Can you get`) are
not, and one trailing hedge crosses into PROHIBITED.

Building the proposed construction would have added a whole family for a defect that does not
exist. The frame inconsistency and IR-112 are the real findings, and both need their own measured
units — the frame list is open-class vocabulary and must not simply be enumerated.

## IR-111 — the LEGACY_BYPASS readiness verdict cannot reach CONCLUSIVE (measured 2026-08-31)

PARTIALLY ADDRESSED 2026-09-01, output only. The verdict no longer ends "Seed fixtures for those
rows and re-run". That imperative was FALSE for DEV-EN-215 rather than merely unfollowed, and a
false instruction sends a reader after nothing. `inconclusiveVerdict()` is exported and asserted in
`tests/legacyBypassClassification.test.ts`, so the honesty of the message is a test rather than
prose somebody may tidy away.

The CLASSIFICATION is unchanged and deliberately so. A read-only architecture pass returned REFRAME
with the smallest safe repair being output-only, and named the reason: separating "unmeasured" from
"unmeasurable" needs a NON-AUTHORIZING arity diagnostic from the request grammar, because a refused
parse carries no authorized subject by contract. Adding one now risks an accidental second
authority grammar, so it is its own scoped change with grammar-level tests.

Recorded so it is not re-derived: the obvious discriminator does not work. Asking the SHELF how
many stored names a query mentions cannot separate "unmeasurable in principle" from "not seeded
yet", because no-stored-name-occurs IS the unseeded state.

DEV-EN-214 remains out of scope and behind a Human Gate: seeding it means storing a real causal
claim with `mechanism`, `evidence` and a `counterexample`, which `docs/DATA_POLICY.md` governs, and
it would alter the live shelf that whole-corpus transition matrices are measured against.

`scripts/legacy-bypass-readiness.ts` ends every run with the same instruction: "Seed fixtures for
those rows and re-run." For one of the two remaining rows that instruction cannot be followed, and
the verdict is therefore permanently INCONCLUSIVE under the approved rule rather than one fixture
away from clean.

    DEV-EN-214  "How does the unemployment rate work with inflation?"
    DEV-EN-215  "What is the mechanism for the policy rate?"

Both are `expected=REFUSED/AMBIGUOUS_CARDINALITY`, both `plannerCalled=false`, both currently
PROBE_INCONCLUSIVE. They land there through the second branch of `classify()`: the row should
refuse, and `evidenceSufficient` says the shelf held nothing it could have been answered from, so a
no-call cannot be told apart from an empty shelf.

`evidenceSufficient` treats AMBIGUOUS_CARDINALITY exactly as STORED_MECHANISM: an edge counts only
when BOTH endpoints are named in the request.

**DEV-EN-215 names ONE subject.** "The policy rate" is the only nominal in it — that is precisely
why the corpus expects it refused as under-specified. No causal edge can have both endpoints named
in a request that names one endpoint, so no fixture makes this row evidence-backed. It is
structurally unmeasurable, not unmeasured, and it belongs with the cases `evidenceSufficient`
already returns `false` for on principle (MISSING_INTERVAL, MISSING_ATTRIBUTION, DEFINITION,
OBSERVED_CHANGE) rather than in a bucket that reads as a measurement failure someone could fix.

**DEV-EN-214 could be made evidence-backed**, and doing so is a decision rather than a chore. It
names two subjects, so an edge between them would satisfy the rule and convert the row into a
genuinely meaningful measured refusal — the guard declining because the request never said which
subject acts on which, with an edge sitting right there that could have answered a well-formed
version. But `CausalEdge` requires `mechanism`, `evidence` ("established literature/precedent, not
a citation-shaped guess") and at least one `counterexample`. Seeding it means storing a real
economic claim, which is available here — the Phillips relation, with its own well-known
counterexamples — but it is still the deliberate insertion of a sourced causal assertion into the
fixture set, and `docs/DATA_POLICY.md` governs that.

NOT DONE, deliberately, and the reason is about evidence hygiene rather than effort: the readiness
shelf is read live from the database, so seeding changes the substrate that
`[ESCALATION][MARKET-OS][DEC-INTERVAL-FAMILY-20260831]` and the whole-corpus transition matrices are
currently measured against. Changing the measurement input while a measurement-dependent decision
is open is how a comparison quietly stops being one.

A related observation worth recording separately: that shelf is whatever the dev database happens to
hold. It currently carries 27 series and 7 causal edges, most of them plainly other units' fixtures
(`TEST Canonical Cause Alpha`, `Test Output freight index`). The readiness measurement is therefore
not reproducible by a second party from the repository alone. That is a property of the
measurement, not a defect in the code it measures, and it bounds how much any single run of it can
be claimed to establish.

Decision needed: whether DEV-EN-214 gets a sourced fixture edge, and whether
`evidenceSufficient` should classify a one-endpoint relation request as structurally unanswerable
instead of PROBE_INCONCLUSIVE. The second is a semantics change to an independently APPROVED script
and is NOT being made unilaterally.

## IR-110 — a compounded temporal modifier is a definition (found by review 2026-08-31, PRE-EXISTING)

    오늘주가가 뭐야?     -> AUTHORIZED / DEFINITION, subject `오늘주가`
    현재주가가 뭐야?     -> AUTHORIZED / DEFINITION, subject `현재주가`

"What is today's share price" is a CURRENT_OBSERVATION. `koreanCopularMatch` reads two eojeol,
takes `오늘주가` as the nominative subject, and `뭐야` as the WHAT copula.

**NOT introduced by MARKET-DEFINITION-GRAMMAR-001, and this was measured rather than argued.** The
unit's own Korean recogniser was disabled entirely and the string still returned DEFINITION;
`koreanCopularMatch` is byte-for-byte identical between `24d1f48` and the unit's HEAD. A two-eojeol
Korean request never reaches `koreanDefinitionalMatch`, because `readings` is not empty by then.

The spaced form `오늘 주가가 뭐야?` IS refused, by the two-eojeol cardinality proof the new
recogniser borrows. The gap is exactly the compounded form.

**Why it is deferred rather than fixed here.** 오늘주가 and 종합주가 are the same shape: a
multi-syllable stem carrying a nominative. Separating them needs either a term lexicon, which this
repository does not have, or a prefix list of temporal adverbs — and `koreanCopularMatch`'s own
comment refuses that list by name, because 현재, 최근, 지금, 오늘, 현시점 has no end. Prefix-matching
a stem is also the precise discipline error review exposed in round eleven of this unit: it would
refuse `현재가` ("current price"), an ordinary term.

Fixing it is a bounded unit of its own against `koreanCopularMatch`, not a widening of this one.

ADJUDICATED 2026-09-01, zero-cost read-only architecture pass, VERDICT **NO_CHANGE** with a Human
Gate. Recorded here because the pass closed a question rather than deferring it again.

**FORM ALONE CANNOT DECIDE IT.** The morphology exposes the outer nominative/topic marker and
finality-conditioned particle attachment, and deliberately treats the remaining host as an opaque
open-class stem. `오늘주가`, `현재가` and `종합주가` are externally identical: stem length, syllable
decomposition, final consonant and particle attachment encode nothing about "temporal modifier
versus lexical compound". So the third option — a morphology heuristic — is not merely unavailable,
it would convert spelling convention into authorization policy, which is worse than the defect.

**THE ONLY AVAILABLE REPAIR IS A DELIBERATE RECALL LOSS**, and it is now measured rather than
estimated. Restricting the WHAT branch to DEFINIENDUM analyses would stop recognising every request
whose only licence is nominative-plus-WHAT — `scripts/ir110-recall-cost.ts`, run against the real
corpus and the real parser:

    Korean corpus rows                                          249
    currently AUTHORIZED / DEFINITION                            16
      carrying positive evidence (뜻 / 의미 / 정의 / (이)란)      12
      BARE, licensed only by nominative + WHAT copula             4

    DEV-KO-121  기준금리가 뭐야?
    DEV-KO-129  스태그플레이션이 뭔지 설명해줘
    DEV-KO-139  물가연동국채가 뭔지 궁금해요
    DEV-KO-145  헤지펀드가 무엇인지 알려주십시오

Four legitimate definition requests, in the most natural Korean phrasing, deleted to remove one
misclassification. The architecture pass cited two; measuring it against the corpus gives four, and
the measured number is the one that goes to the gate.

**SEVERITY, and why it is now a gate rather than a P2.** The pass grades it operationally P1: the
parser positively authorizes the WRONG operation for a request whose intended operation is
supported. It does NOT fabricate a price — DEFINITION fails closed at retrieval because no glossary
store exists — so the user sees an unsupported-definition response rather than a wrong number. The
V1 freeze admits reproduced P0/P1 only, so whether this counts is a release-authority call, not an
autonomous one, and it is paired with a second question the same authority must answer: is losing
bare-copular Korean definition recall acceptable. Raised as **HG-010**.

Controls that must not move if it is ever repaired, verified as currently holding:
`현재가가 뭐야?` and `종합주가가 뭐야?` still parse; `오늘 주가가 뭐야?` stays refused by two-eojeol
cardinality; `기준금리는 얼마인가요?` stays CURRENT_OBSERVATION. No temporal-prefix list and no term
inventory may enter the morphology or the grammar.

## IR-028 — Ask Market name matching (raised 2026-08-18, deferred by the freeze)

`Apple revenue`, `Apple net income` and `What did Apple report?` all return `NOT_FOUND` against a
database holding 2240 Apple filings and 1431 Apple facts, while `Apple` and `Apple Inc revenue`
both work. `mentionsEachOther` scores `overlap / smaller.size` at a 0.6 threshold, and `Apple Inc.`
tokenises to `{apple, inc}` — the legal suffix is a full token in the denominator, so one shared
token out of two scores 0.5.

Severity **P2**: the output is honest, just empty. Not fixed, because v1 is frozen except for
reproduced P0/P1 and the minimal fix — a legal-suffix stoplist on the corp-name side — changes
matching for every query and needs its own round with must-match and must-not-match fixtures.

Full reproduction matrix in `docs/INTERIM_REVIEW_FINDINGS.md` IR-028. **Flagged as a
release-critical candidate**: whether the flagship query returning nothing blocks a release is the
release owner's decision, not an autonomous one.

## A11 / IR-032 — `/company/[corpCode]` could not address two providers — **CLOSED 2026-08-18**

Raised and closed the same day. The entry below is kept because the reasoning for deferring it was
wrong in a way worth remembering: "the fix changes a public URL shape and deserves its own round"
described a preference for a tidy boundary, not a blocker. The round was available.

**Fixed.** `computeCompanyXray` takes an optional `sourceCode` and returns null rather than
choosing between providers; `listCompanySources` reports the candidates; `/company` links carry
`?source=`; `/company/[corpCode]` asks when the code is ambiguous. The shadow Verify run carries
`(sourceCode, corpCode)` pairs and its output ids name the provider. Full write-up in
`docs/INTERIM_REVIEW_FINDINGS.md` IR-032.

**Original entry, for the record:**

The company index lists `(sourceCode, corpCode)` rows and links every one to
`/company/${corpCode}`. `computeCompanyXray` then resolves the provider with an `anyFiling` lookup
on `corpCode` alone, so with two providers sharing a corp code the second company is unreachable,
and with equal `receiptDate`s the choice is non-deterministic.

**P1, latent** — only SEC data is ingested today, so nothing is currently wrong on screen. It is
the IR-001/IR-002 precondition rebuilt at the routing layer: a business identifier unique only
within a provider, used as if it were global.

Not fixed under the freeze, and not because of severity. The fix changes a public URL shape, and
the questions that come with it — redirect from the old form, what the index links become, whether
the source belongs in the path or a query parameter — deserve a deliberate round rather than an
edit at the end of a long session. Found by `gpt-5.6-terra`, packet target A11.

The same collapse exists one layer up in the shadow Verify run (`companiesWithFilings()`
deduplicates on `corpCode`; output ids read `filingDiff:<corpCode>:...`). Shadow code is not
frozen, but fixing the copy while the original stands would be the wrong order.

## IR-033 — Two Ask Market orderings that can tie (raised 2026-08-18, deferred by the freeze)

From the ordering enumeration the Evolution scheduler ranked first — twelve `orderBy` sites in
`src/server/domain`, ten of which turned out to be genuinely safe and now carry an
`ORDERING_WAIVER:` saying why. Two are not safe:

**`askMarket.ts` — which company answers.** `filing.findMany({ orderBy: { receiptDate: "desc" } })`
followed by `.find(corpName matches topic)`. With two companies matching one topic, which one
answers depends on an order the database is free to choose. Same class as IR-032, in the query
rather than the route.

**`askMarket.ts` — which figures reach the reader.**
`financialFact.findMany({ orderBy: [{ periodEnd: "desc" }], take: 10 })`. Apple has **nine** facts
sharing the periodEnd `2026-06-27`, among them a nine-month `NetIncomeLoss` of 101.5B and a
quarterly one of 29.8B. Nine is under the limit today, so all of them come back; at ten or more,
which figures reach the reader becomes unspecified. `companyXray` fixed this with
`[periodEnd, filedDate, id]` and `filingDiff` with the shared `compareFactCurrency` — this path was
missed by both.

**P2, and not fixed.** Nothing wrong is displayed: both figures carry their period, so a reader can
tell the nine-month from the quarter. The answer is simply not guaranteed to be the same answer
twice. v1 is frozen except for reproduced P0/P1, and a determinism-only ordering change is still a
change to the path that selects which financial figures a user sees.

The fix is two tiebreaks. `tests/orderingDeterminism.test.ts` holds the pair in a
`DEFERRED_BY_FREEZE` list checked in both directions — a new undecided ordering fails, and so does
an entry here that has been fixed, so the list cannot become a place where defects are parked.

## IR-035 — Ask Market shows ten of 1428 facts and says nothing (raised 2026-08-18, deferred)

From the `SILENT_DEGRADATION` countermeasure — make every path that can return a subset report the
size of the subset AND the size it expected, so "fewer rows" is a value rather than an absence.

`findCompanyFacts` caps at `take: 10` and `findSeriesFactors` at `.slice(0, 5)`. Against the real
database, asking about Apple returns **10 of 1428 held facts**. Nothing in `AskMarketResult`, and
nothing on `/ask`, indicates that 1418 were not mentioned.

A limit is a reasonable product decision. An undisclosed limit is this cluster's definition, and
the same shape as 1000 of 2240 filings reading as a complete history.

**P2 and not fixed in v1.** No figure shown is wrong, and disclosing the shortfall means adding
fields to `AskMarketResult` and rendering them — a change to the answer surface, which the freeze
reserves for P0/P1.

**Closed in shadow instead**, which is where the directive points for exactly this case. The Verify
adapter now carries the shortfall, so the real shadow run reports Ask Market answers as
**TRUNCATED** with `data_completeness` failing. The gap is measured and visible in the verdict
before it is visible on the page; promoting it to the page is a v1 decision.

## IR-036 — A concurrent signup gets a raw P2002 (raised 2026-08-18, deferred by the freeze)

From the `CONCURRENCY` countermeasure — list every place that reads a row, decides something, and
writes based on the decision; each is either transactional, constraint-protected, or an instance
waiting to happen.

`signUp` reads `user.findUnique({ email })`, decides the address is free, and creates.
`User.email` is `@unique`, so the database never produces two accounts — **reproduced with three
concurrent signups: exactly one user created.** The constraint holds.

What does not hold is the error. The two losers receive a raw Prisma `PrismaClientKnownRequestError`
(P2002) rather than the `AuthError` the sequential path produces, so the signup form shows a 500
where it should show "an account with this email already exists". Identical in shape to CC-03
(watchlist) and CC-04 (revision chain), both of which were fixed before the freeze.

**P2, not fixed.** Nothing is corrupted and nothing is exposed; a rare race produces a bad error
message. The fix is a `catch` on P2002 in `signUp` rethrowing the existing `AuthError` — two lines,
making two paths agree rather than changing behaviour — but the freeze reserves v1 for P0/P1 and
consistency about that line matters more than one cheap fix.

`tests/integration/signup-race.test.ts` pins both halves: the constraint invariant asserted as it
should be, and the error shape asserted **as it currently is, deliberately the wrong way round, so
that fixing it breaks the test.** A known gap asserted as correct behaviour is how a defect becomes
a specification.

## IR-037 — A causal claim shown with its limitation and without its basis (raised 2026-08-18, deferred)

From the `PROVENANCE` countermeasure — assert provenance where the reader SEES it. Auditing every
page found each FIGURE properly attributed, including the Macro Regime axes that were this
cluster's last instance. The causal graph is not.

`CausalEdge.evidence` is stored and schema-required, described as "why this is believed —
established literature/precedent, not a citation-shaped guess". `CausalFactor`, the domain type
between the database and the page, has no such field, so `/ask` renders the direction, confidence,
mechanism, lag and counterexamples, and cannot render the basis.

The asymmetry is the tell: both `evidence` and `counterexamples` are schema-required for the same
reason, and the LIMITATION is shown while the BASIS is not. A reader sees "MEDIUM confidence" with
the caveats and no way to ask why anyone believes it.

**P2, not fixed.** Nothing false is displayed; something true is omitted. Only one causal edge is
stored today and it is a test fixture, so the current user-facing impact is nil — the same latency
argument as IR-032. The fix is additive: carry `evidence` through `CausalFactor` and render it
beside the limitations.

`tests/causalProvenance.test.ts` pins the gap the self-correcting way — the absence is asserted as
it currently is, so fixing IR-037 breaks the test.

## FLAKE-01 — `morning-brief` integration, one occurrence, signature lost

Failed once in a full-suite run on 2026-08-20 (`buildMorningBrief (integration) > composes without
throwing and returns well-shaped sections`), passed in isolation immediately afterwards, and did
not reproduce in a subsequent full run with complete output captured (1076/1076).

**No signature was captured**, because the failing run's output was piped through `grep` and the
error text was discarded — the same mistake IR-039 recorded, made again. The response was to
re-run with full capture rather than to re-run and hope, but the first occurrence is gone.

Plausible cause, held as a hypothesis and not a conclusion: PostgreSQL had been restarted minutes
earlier in that session, so a cold connection pool on the first integration file is consistent with
what was seen. There is no evidence for it.

Recorded so a second occurrence is recognisable as a pattern rather than as a first. If it recurs,
capture the full output before doing anything else.

---

## Measured debt — advice-guardrail false-negative rate (IR-085, 2026-08-21)

The first guardrail number in this project that is measured rather than asserted.

|                                                  | measured 2026-08-21                                               |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| False negatives (prohibited request answered)    | 36 / 63 — **57.1%**, and **1 / 63 (1.6%)** after the same-day fix |
| False positives (legitimate question redirected) | 4 / 57 — 7.0%                                                     |

Per prohibition, caught / total: personalised trade 10/18, price prediction 7/9, portfolio
construction 4/10, fund allocation 3/7, guaranteed return 2/8, automated trading 1/6, **loss
protection 0/5**.

Corpus: `tests/fixtures/adviceGuardrailCorpus.ts`, 120 labelled queries built from
`docs/LEGAL_GUARDRAILS.md` rather than from the pattern list; 117 of them appear in no other test.
Measurement and ratchets: `tests/adviceGuardrailEvaluation.test.ts`.

**Fixed the same day**, except for one case. The four unenforced prohibitions were implemented and
re-measured: personalised trade 18/18, portfolio construction 10/10, automated trading 6/6,
guaranteed return 8/8, loss protection 5/5, fund allocation 7/7, price prediction 8/9. The 518-case
pinning suite passes unchanged, and it caught one over-block the new patterns introduced before
anything was committed.

What remains as debt: **the four false positives**, now the larger number, and the single false
negative — "How high can Nvidia go from here?" — which is the GAP-INDEX-LEVEL instrument-versus-
indicator gap and not a missing phrase.

**Status: DEBT, deliberately.** P1, not release-critical for `c03aa73`, because `askMarket` returns
the same sourced factor data whether or not the guardrail fires — a miss costs the redirect status
and the disclaimer, not a recommendation, and M21 has no model that could produce one. It becomes
release-critical when HG-006 is approved; recorded there as a prerequisite rather than a
nice-to-have.

**Not a reason to reopen the gate chain.** The candidate is frozen and this changes nothing about
what it does. Progress against it belongs on the follow-up branch, measured by the two rates above.

---

## Measured debt — the guardrail does not generalise (IR-090, 2026-08-22)

|                 | DEVELOPMENT_CORPUS (120) | FRESH_HOLDOUT (205) |
| --------------- | ------------------------ | ------------------- |
| False negatives | 1 / 63                   | **85 / 105 (81%)**  |
| False positives | 0 / 57                   | **32 / 100 (32%)**  |

The holdout was generated by an independent read-only reviewer from `docs/LEGAL_GUARDRAILS.md`
alone and committed at `1b46760` before the detector ran against a single case in it. Result:
`docs/evaluation/holdout-guardrail-result.json`.

Never quote these two side by side without their labels. The development corpus has been optimised
against and measures regression; the holdout measures generalisation. They do not share a
denominator.

**Status: P1, HG-006 ACTIVATION BLOCKER. Not release-critical for `c03aa73`**, for the reason in
IR-085 and unchanged by this: `askMarket` returns the same sourced data either way and has no model
that could produce advice. The over-blocking half is P2.

**Not a reason to add 85 patterns.** That loop has been run at Gates B–E, at IR-085, and here; the
next holdout would find 85 more. The evidence points at a design question, recorded in IR-090.

---

## Measured debt — three independent measurements later (IR-091, IR-092, 2026-08-22)

| corpus            | when                           | false negatives      | false positives      |
| ----------------- | ------------------------------ | -------------------- | -------------------- |
| Development (120) | fixed against                  | 1 / 63               | 0 / 57               |
| Holdout 1 (205)   | first run                      | 85 / 105 (81.0%)     | 32 / 100             |
| Holdout 1 (205)   | after the bounded repair       | 70 / 105 (66.7%)     | 32 / 100             |
| Holdout 2 (224)   | first run, never fixed against | **82 / 112 (73.2%)** | **33 / 112 (29.5%)** |

One structural family was closed — a `REQUEST_DIRECTIVE` frame could exempt and could not refuse —
and it generalises: 66.7% on the corpus it was fitted to against 73.2% on one it has never seen, a
6.5-point gap that would be far wider for a phrase-level fix.

**Status: P1, HG-006 activation blocker. Not release-critical for `c03aa73`** — unchanged reason,
`askMarket` returns the same sourced data either way and has no model that could produce advice.

Guaranteed return is 0 / 16 on holdout 2 and was 6 / 15 on holdout 1 after the same code. Sample
variance in a badly-covered space; both are reported and neither is "the" number.

**Not a reason to write more patterns.** 69 of 82 misses match nothing at all. The next move here
is a design decision.

## REPAIRED, RE-REVIEW PENDING — Codex review of 76fbaf5 (2026-08-26): REWORK_REQUIRED

Both items are repaired by the commit following 76fbaf5, isolation mutation 11/11. The account
below is kept exactly as it was written while they were open — including the paragraph explaining
why the prescribed repair could not be built as specified — because that reasoning is the evidence
that the fix addresses the class rather than the two examples. Repair is not closure: the
re-review of the repaired tree is PENDING and nothing here is closed by self-assessment.

Recorded here so the finding cannot be dropped by a session boundary. Both items are REPRODUCED
against real PostgreSQL (`scripts/reproduce-redirect-informational.ts`), not merely asserted.

    definition / company   neutral  REQUEST_NOT_SUPPORTED           company 0
                           ADVICE   PERSONALIZED_ADVICE_REDIRECTED  company 1   DIVERGENT
    affirmative relation   neutral  FACTORS_FOUND                   causal  1
                           ADVICE   PERSONALIZED_ADVICE_REDIRECTED  causal  0   DIVERGENT
    topical (control)      neutral  FACTORS_FOUND                   company 1
                           ADVICE   PERSONALIZED_ADVICE_REDIRECTED  company 1   same

**P1 — the redirect publishes company facts its neutral form refuses.** `Should I buy X? Define X`
redirects AND publishes X's figures, while `Define X` returns REQUEST_NOT_SUPPORTED and publishes
nothing, because this repository holds no glossary. Same class as the causal defect fixed in
76fbaf5, different record class: 76fbaf5 repaired only what had been reproduced at the time, and
review was asked directly whether the class was open on the other two retrievals. It is.

**CONTRACT_BREACH — the affirmative narrowing in 76fbaf5 was not accepted.** I argued that
publishing strictly less cannot become advice by arrangement and that the enforced invariant covers
only a topical twin. Review's answer: the contract is worded "IDENTICAL" with no topical
qualification, so the narrowing is a breach regardless of its safety direction. Recorded as
rejected, not carried forward as settled.

**Why it is not yet repaired.** Review's prescribed shape — PROHIBITED carries a recognised
informational operation, and the redirect publishes only through that operation's normal selector —
breaks the third row, which is the case the ENFORCED test covers. `Should I buy X?` contains no
informational operation at all, so under that rule it would publish nothing while its neutral twin
publishes facts. Two contracts are in tension: the redirect must inform (the original guardrail,
why `Should I buy Apple?` shows Apple figures) and the redirect must not publish what the
repository would refuse (the P1). An architect round is open on which governs a bare directive.
Implementing before that resolves would trade a reproduced defect for a reproduced regression.

## RESOLVED by 9139152 — d6d09e2's parser repair was incomplete (self-found, 2026-08-26)

d6d09e2 made `resolveRequestAuthority` treat two readings of one operation as AMBIGUOUS, keyed on
`operation:subjectRegion`. It closes the case review found and NOT the case its own title names.

    "What is the current Acme? What about latest Beta?"   -> AMBIGUOUS      (fixed)
    "What is the current Acme? What is the current Beta?" -> AUTHORIZED     (STILL BROKEN)
                                                             subject " acme what is the current beta "

`recogniseAll` locates each construction with `normalized.indexOf(opening)` -- the FIRST occurrence
only. Two DIFFERENT constructions therefore produce two matches and two readings; the SAME
construction twice produces one match, one reading, and a subject region that has swallowed the
second question whole. Same defect, same severity, one line further down.

Found by attempting to construct the overlapping-maximal-run case for M-CON-2 rather than by a test.

**Why the obvious repair is not obviously right.** Finding every occurrence instead of the first
would refuse a legitimate request: the space-delimited token `current` (written `current` in a
normalized region) occurs twice in
`What is the current current account balance?`, where the second is part of the stored name. All-
occurrences turns that into AMBIGUOUS. Distinguishing "a name containing the marker word" from "a
second question" is a grammar question -- the second has a full construction with its own framing --
and picking it by phrase would be the vocabulary-as-grammar substitution this unit exists to remove.
Architecture round required; this is not a repair to improvise.

STATUS: the redirect/constituent authority unit is NOT closed. The chain through d6d09e2 is real
work and its other repairs stand, but this specific claim is overstated in that commit message and
is corrected here rather than by rewriting history.

## OPEN BLOCKER — the same swallowing defect on the mechanism and attribution paths (2026-08-26)

Reproduced while investigating why M-CON-14 stopped being isolated:

    "Explain how Alpha affects Beta. What is the current Gamma?"
      -> AUTHORIZED  STORED_MECHANISM
         subject " explain how alpha   beta what is the current gamma "

    "Should I buy stock? What did Reuters publish about Alpha? What is the current Gamma?"
      -> constituent ATTRIBUTED_REPORTED_OBSERVATION
         subject " alpha what is the current gamma "

The first is a STANDALONE two-question request answered as one mechanism. The second reaches the
redirect and would publish under a subject that has eaten the following question.

ROOT CAUSE, and review predicted it before I found it. `recogniseOperation` is not one grammar:
`mechanismMatch` and `attributionMatch` pre-empt `recogniseAll`, delegating to `relationSyntax` and
the attribution binder. The readings rule added in d6d09e2, and the all-occurrences fix after it,
both live in the `recogniseAll` branch -- so neither runs for a request the delegated parsers claim
first. Codex said exactly this when refusing to certify M-CON-2: "their delegated parsers do not
provide a demonstrated union-closure property."

WHY M-CON-14 NOW SURVIVES. The composite/disjointness guard used to be the only thing rejecting a
run that contains two whole requests. On the `recogniseAll` path the readings rule now rejects those
runs earlier, so the guard is no longer load-bearing THERE. It is still the only guard on the
mechanism and attribution paths -- and the attribution measurement above shows it is not sufficient
there either. So M-CON-14 is neither cleanly redundant nor cleanly untested, and the composite guard
is NOT to be deleted on the strength of the miss.

STATUS: OPEN. The redirect/constituent/parser authority unit does not close. Two reproduced defects
and one uncertifiable mutant (M-CON-2), all three rooted in the same fact: three recognition paths
with three different notions of "nothing left over".

## RESOLVED — M-CON-2 was REPRODUCED, not merely untested (2026-08-26)

Recorded here because the wrong disposition was written down twice before the right one.

The exactly-one-maximal-run guard survived the whole suite. I first read that as redundancy and
nearly deleted the guard; then as "genuinely untested, keep it", which review refused because the
absence of a hand-built counterexample is not evidence. It required a generated property.

`scripts/search-overlapping-runs.ts` enumerates every ordered fragment combination from a pool and
reports the three conditions that must hold together for the count to decide anything:

1. the whole query does NOT authorize — otherwise recognition returns it before runs are reached
2. two maximal runs partially overlap — [0..1] and [1..2], neither containing the other
3. the outside-construction check would not catch the survivor

90,432 combinations examined, 2,464 overlapping pairs, **120 where the guard is load-bearing**.

Both earlier arguments were wrong in their details, and only running the search showed it:

- The first overlap found could not have killed the mutant. Production decides it at the early
  return, because the attribution parser claims the entire string — condition 1, which hand
  analysis kept missing.
- The blindness is not "the marker sits in the overlap". The case that kills the mutant is two
  MECHANISM runs, and relations are recognised by `relationSyntax` rather than by a CONSTRUCTIONS
  marker, so a marker scan finds nothing anywhere.

Pinned: `Should I buy stock? Explain how Alpha affects Beta? Zeta? Explain how Alpha affects Beta?`
verified PROHIBITED / informational=NONE on the production path. Mutation set now 17 of 18.

STILL OPEN: M-CON-14, and the mechanism/attribution swallowing defects above. Review has architected
one repair for all three — union the recognition parsers, structured reading identity, one residue
rule, delete the composite guard as TARGET_REMOVED — and that unit is next.

## OPEN BLOCKER P1 — a non-authorizing tail is still swallowed (2026-08-27, 007e6c8)

Found by a Claude Fable adversarial reviewer standing in for the gated Codex review, and reproduced
independently before anything moved. NOT discharged by that review: Codex debt survives.

    "What did Reuters publish about Alpha? What about the Gamma level?"
      -> AUTHORIZED  subject " alpha what about the gamma level "   source "reuters"
    "What did Reuters publish about Alpha? What did they say about Gamma?"
      -> AUTHORIZED  source "reuters publish about alpha what did they"
    "Explain how Alpha affects Beta. What about the Gamma level?"
      -> AUTHORIZED  effectRegion " beta what about the gamma level "
    "What is the current Gamma? 현재 기준금리는 얼마인가요?"
      -> AUTHORIZED  subject " gamma 현재 기준금리는 얼마인가요 "
    "Should I buy stock? What did Reuters publish about Alpha? What about the Gamma level?"
      -> PROHIBITED, informational source "should i buy stock what did reuters"

The last one puts the DIRECTIVE inside a served source region on the redirect path.

ROOT CAUSE, and it is the unit's central claim being narrower than stated. 007e6c8 says a swallowing
reading "loses by not being unique". That holds ONLY when the swallowed material authorizes ALONE --
then a second cover exists and neither is unique. When the tail does not authorize alone, no
competing cover exists, the swallowing reading is unique, and unique authorizes.

WHY THE SUITE MISSED IT, which is the part worth keeping. Every swallowing regression test in the
tree picks a tail that authorizes alone (`What is the current Gamma?`, a 2-eojeol Korean question).
That is precisely the precondition for the defense to work. The tests exercise the half of the space
where the mechanism cannot fail. `"What is the current CPI? 기준금리는 얼마인가요?"` passes only
because its Korean tail is 2-eojeol; the 3-eojeol variant above is the counterexample the suite
never poses.

REPAIR IS NOT OBVIOUS AND IS NOT BEING IMPROVISED. The reviewer's proposal -- an open-class region
crossing a candidate boundary is admissible only if the material after the boundary carries no
FRAMING_TOKENS -- kills all five reproductions and preserves `Yahoo! Finance` / `Acme Inc. revenue`.
But FRAMING_TOKENS contains `level`, `rate`, `figure`, which are legitimate TAIL tokens of stored
names, so the rule as stated may refuse real subjects. That edge needs an architecture decision, and
the architect (Codex TERRA) is gated.

ALSO FOUND, P2, PRE-EXISTING at bc9c6b5: `SOURCE_DISQUALIFIERS` omits first and second person, so
`"What did I publish about Alpha?"` authorizes with source `"i"` (likewise `we`, `you`). Fails safe
downstream -- source `"i"` resolves to nothing -- but it contradicts the module's own pronoun
principle. Reproduced. Should ride along with the rework rather than being fixed separately.

STATUS 2026-08-28, CORRECTED the same day after a P1 closure review: **the five original
reproductions are repaired and pinned, and the first version of this line said "the P1 is REPAIRED"
full stop, which was contradicted within hours.** `Who published Gamma?` and `Why the Gamma
decline?` were still being swallowed, and reproducing those found four more. They are repaired and
pinned too -- but the line is corrected rather than re-asserted, because what was actually
established is that the reproductions are closed, not that the token set is complete. See "P1
closure review of 009341d (Sol)" below: `CLAUSE_OPENING_TOKENS_COMPLETENESS = UNESTABLISHED`.

The
confirmed-clause-boundary rule closes it; see "Architect review of the P1 repair (Terra)" below for
the design, the two rules that were tried and refuted by measurement first, and the two
over-refusals the repair itself introduced and then had to close.

The reviewer's FRAMING_TOKENS proposal was NOT adopted, and the concern recorded above about
`level`/`rate`/`figure` was right: running it refused `the U.S. Bureau of Labor Statistics` (`of` is
framing) and missed the Korean case entirely, since a Hangul tail carries no English token. What
shipped instead is narrower and two-sided -- only tokens that can stand CLAUSE-INITIALLY confirm a
boundary, plus a boundary-adjacent determiner, plus a Korean CLAUSE (not merely Hangul), and the
run's HEAD must itself be a complete request.

Thirteen mutants, one per separable clause of the rule. "One per separable clause" was itself an
overstatement when it said nine: the same review pointed out that `readings.length > 0` had no
mutant of its own, and B-M10 now covers it. The `Should I buy stock?` reproduction is pinned at both
levels: on the authority object, and on the publication path where a redirect could actually show
it.

The P2 pronoun finding below is NOT closed by this and does not ride along after all -- it is
`SOURCE_DISQUALIFIERS`, a different mechanism in a different function, and bundling it would have
put an unreviewed change into a P1 commit.

## Dispositions recorded 2026-08-27 (007e6c8 review round)

CHATGPT_EXACT_TREE_REVIEW = APPROVE for 007e6c8.
FABLE_EXACT_TREE_REVIEW = REWORK_REQUIRED for 007e6c8, one reproduced P1 (see the OPEN BLOCKER
above). The two independent reviews DISAGREE, and the disagreement is
settled by reproduction rather than by seniority: the five inputs were
re-run here and they authorize with an unread second question inside a
served region. An APPROVE does not survive a counterexample.
CODEX_DEFERRED_REVIEW_DEBT = YES. Neither of the above is a Codex verdict. Historical anchor for
recovery: 007e6c827064dab6b1b5e05041852d5cb7503f74.

**ASSURANCE_WORDING_P2, non-blocking, and it corrects a claim I made.** The span-evaluation commit
says "every interval evaluated exactly once, none twice, none skipped". Too strong. The cache keys
on exact span TEXT, so two intervals carrying identical text share one entry -- measured, `A? A? A?`
costs 3 evaluations, not 6. The honest statement is:

    each DISTINCT span text is evaluated at most once per top-level request
    evaluations <= n(n+1)/2
    equality holds only when all interval texts are distinct

Safe, because recognition is a pure function of span text. Production behaviour is NOT changed to
rescue the old wording; the wording is changed to match the production behaviour.

**KOREAN_CONSTITUENT_CAPABILITY = ACCEPTED_SAFE_CAPABILITY** for this bounded unit. Outer PROHIBITED
authority stays absolute, no morphology or vocabulary was widened, and the behaviour comes only from
the existing complete Korean grammar becoming visible to the generic constituent engine. No further
Korean expansion in this unit.

**COORDINATOR_GUARDS = KEEP.** Generated evidence shows the multiplicity rule and the
unread/coordinator rules produce DIFFERENT refusal classifications on the same inputs, so they are
not duplicates. No cleanup here.

**REPEATED_IDENTICAL_RULE_OWNER = SPAN_AMBIGUITY, accepted.** The outcome is pinned and correct; the
owning layer is not refactored for tidiness.

**M-CON-14 = TARGET_REMOVED, replacement DISTRIBUTED_CURRENTLY_OVERLAPPING.** Historical killer kept
as regression evidence. No synthetic single replacement mutant manufactured. Revisit only if a later
change removes one of the rejecting authorities.

**COVER_ENUMERATION_COST = OPTIONAL_FUTURE_DEBT, not a blocker.** Bounded by
MAX_CANDIDATE_FRAGMENTS = 12. Possible later optimisation: stop enumerating after the second
distinct complete interpretation, since the authority only needs 0 / 1 / >1. This unit is not
reopened for it.

## Assurance-harness review round (Luna, 2026-08-27/28) — three defects, one vacuous control

Reviewer: `gpt-5.6-luna`, READ-ONLY, exact tree at commit `5818ee2`. Verdict **REWORK_REQUIRED**.
Every finding was REPRODUCED before being touched; repair is commit `71511a1`.

| #   | Finding                                                                                                                                                                                                                                                                          | Reproduction                                                                                                                                                                                      | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `startup_recovery()` ran BEFORE the lock. A second harness could read a live run's incomplete manifest, restore its active mutant, delete the manifest, and only then fail to acquire the lock — leaving the first harness measuring a tree that had been put back underneath it | instrumented call order: recovery at offset 215, lock at 1510                                                                                                                                     | **REPAIRED.** `acquire_lock(token)` is now the first statement of `harness()`; the body moved into `_run_locked()` so recovery, snapshot and the mutation transaction are all inside the lock. Re-measured: lock precedes recovery                                                                                                                                                                                                                                           |
| 6   | Dead-owner reclaim was TOCTOU-racy: two processes could each read the same dead pid and each conclude the lock was theirs, after which either `release_lock()` would delete the other's                                                                                          | read of the pid-only lock format, no atomic claim step                                                                                                                                            | **REPAIRED.** Locks carry a unique token (`pid-time_ns`); reclaim writes a staging file and `os.replace()`s it, then reads the lock back and proceeds only if it still holds our own token; `release_lock(token)` removes the file only while it contains that token                                                                                                                                                                                                         |
| —   | Control G was weakly discriminating: its holder took the lock and nothing else, so a second harness had no manifest to wrongly recover — G could not have caught finding 1                                                                                                       | inspection, confirmed by construction                                                                                                                                                             | **STRENGTHENED.** The holder now writes an incomplete manifest AND an active mutant. G0 asserts the holder is genuinely mid-mutation; G2/G3 assert the live run's bytes and manifest survive untouched                                                                                                                                                                                                                                                                       |
| —   | Control D was weakly discriminating: it never fed a stale verdict into any aggregation path                                                                                                                                                                                      | the filter it nominally covered (`foreign = [v for v in verdicts if v["run_id"] != run_id]`) reads a local list appended to in exactly one place with a literal `run_id` — no value could fail it | **CHECK DELETED, CONTROL REBUILT.** The vacuous filter was removed rather than tested. Aggregation does not happen in-process; it happens when a log is read afterwards, which is how the 59-minute stall nearly passed for a measurement. Verdict lines now carry their run id; `verify_report()` admits a verdict only when its run also emitted `RUN_COMPLETED`; D drives two REAL harness logs through it — one complete, one killed after a verdict had already printed |

D's own non-vacuity is now asserted in both directions, because a control that cannot fail is the
thing this round was about. **D3** proves the interrupted log actually contains a verdict line to be
tempted by (without it every later assertion would pass for the wrong reason), and **D8** proves the
exclusion is CAUSED by the missing `RUN_COMPLETED` — append that one line and the same verdict is
admitted — rather than by the parser failing to see the line at all.

Self-test: **40/40 controls pass** (A 4, B 5, C 6, D 10, E 3, F 7, G 5). Status **VERIFIED** for the
modelled failures only. Explicitly NOT claimed: `POWER_LOSS_SAFE`, `FILESYSTEM_CRASH_SAFE`,
`ARBITRARY_CONCURRENT_WRITER_SAFE`. What was tested is a hung child, a parent killed via `os._exit`
between mutant write and restore, a third-party edit during recovery, and a second harness started
against a live one in the same worktree.

Luna re-review of `71511a1` is **PENDING** (prompt staged; the review must read a stable tree, so it
runs between mutation runs, never during one).

### Boundary mutants (2026-08-28, run `ea637b364ad1`, harness self-certified first)

Baseline green: binding 106 tests / 2 files, unrelated 49 / 2. Denominators pinned. **5 of 6
ISOLATED.**

| Mutant                                                                      | Verdict            |
| --------------------------------------------------------------------------- | ------------------ |
| B-M1 Hangul no longer confirms a boundary                                   | ISOLATED           |
| B-M2 clause-opening tokens no longer confirm                                | ISOLATED (5 tests) |
| B-M3 only the FIRST token is scanned, not the whole fragment                | **MISSED**         |
| B-M4 a boundary-adjacent determiner no longer confirms                      | ISOLATED           |
| B-M5 confirmation stops accumulating, so a clean later fragment launders it | ISOLATED           |
| B-M6 blocked runs skipped rather than withheld (cost invariant only)        | ISOLATED (3 tests) |

B-M6 mattered: it is behaviourally identical to the original, so only the span-evaluation COUNT test
could see it, and that test did.

B-M3's disposition is decided by measurement, not by argument — `scripts/mutation/differential.py`
runs a generated corpus through both rules under the same write/restore transaction and reports
every discriminating request. See the entry below.

### B-M3 — RESOLVED as REPRODUCED, by a generated differential (2026-08-28)

B-M3 replaces `tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token))` with a scan of the FIRST
token only. It survived all 106 binding tests, and the reason is visible once the existing cases are
read as a set: every swallowed tail they carry either opens with a determiner (caught by the
determiner rule) or already has its clause-opening word in first position (caught by the mutant
too). No test carried a tail whose clause opener sits behind a **preposition**.

A survivor means the tests do not separate two rules. It does not mean the rules agree, and hand
analysis of exactly this question has been wrong in both directions in this unit, so it was measured
rather than argued. `scripts/mutation/differential.py` (case `bm3`) applies the mutant under the same
lock/before-image/verified-restore transaction as the harness and runs
`scripts/diff-clause-token-scan.ts` — 42,840 generated requests — against both versions:

|                                     |                 |
| ----------------------------------- | --------------- |
| corpus                              | 42,840 requests |
| differing                           | 2,532           |
| current REFUSES / mutant AUTHORIZES | **1,204**       |
| current AUTHORIZES / mutant refuses | **0**           |
| PROHIBITED payloads differing       | 0               |

The 1,204 are the P1 itself. `What did Reuters publish about Alpha. In 2024 what was the CPI?`
authorizes under the mutant with subject region `alpha in 2024 what was the cpi` -- carrying its
delimiting spaces, as every normalized region does -- and source
`reuters` — the second question buried in an open-class region, which is the exact defect the repair
exists to close. Scanning all tokens is load-bearing.

Three discriminators were added to `tests/requestAuthority.test.ts` (preposition, prepositional
phrase, fronted adjunct) plus one that asserts the swallowed text does not reach a served region.
Re-measured: **B-M3 ISOLATED**, 4 tests fail under it, baseline 110 binding / 49 unrelated.

**Superseded by the re-run below.** The set grew to eight when the head condition was added, and
the measured result is 8 of 8 ISOLATED (run `a0a9195efcd2`, baseline 112 binding / 49 unrelated).
The 5/6 figure above is the state before the B-M3 discriminators existed.

### A regression that was not one — recorded because it was nearly written down as one

The corpus contained no NAME whose tail carries a clause-opening verb, so its "0 over-refusals" was
a statement about the corpus. A direct probe (`scripts/probe-name-tail-openers.ts`) found three
ordinary questions being refused:

    UNSUPPORTED  What did Bloomberg L.P. show about Alpha?
    UNSUPPORTED  What did Acme Inc. tell investors about revenue?
    UNSUPPORTED  What did Alpha Corp. give as guidance?
    AUTHORIZED   What did Bloomberg L.P. publish about Alpha?
    AUTHORIZED   What did Acme Inc. report about revenue?

`show`/`tell`/`give` are in `CLAUSE_OPENING_TOKENS`; `publish`/`report` are not. The obvious reading
is that the repair splits the name at its internal period, and this was one edit away from being
filed as a regression the repair introduced.

It measures false. Two further differential cases — `nametail` (the clause-opening rule disabled
outright) and `prerepair` (the repair disabled at its single point of effect, blocked runs admitted
to the tiling again) — leave all three **still UNSUPPORTED**. The refusal is upstream of the boundary
rule and predates the repair: `show`, `tell` and `give` are not read as attribution verbs at all.

Over that probe the repair changes exactly three outputs. One is the P1 fix. The other two are
strings invented to force a clause-opening auxiliary into a name tail (`Acme Inc. will-they-report
status`, `Acme Inc. has-reported figure`) and are not English anyone would type — which is not the
same as proof that no natural instance exists, and is why the question was put to the architect
rather than closed here.

Open, as its own finding and NOT part of this repair: whether the attribution verb set being closed
to `publish`/`report` while refusing `show`/`tell`/`give` is a defect. Not fixed here; recorded so it
is not rediscovered as a boundary bug.

### Architect review of the P1 repair (Terra, 2026-08-28) — APPROVE, then REFINE_IN_THIS_UNIT

Reviewer: `gpt-5.6-terra`, READ-ONLY, exact worktree including the uncommitted P1 diff.

**Round 1 — VERDICT: APPROVE.** No P1 architectural defect. Findings worth keeping:

- **Q1** `CLAUSE_OPENING_TOKENS` is a lexical heuristic but not the prohibited kind of word list: it
  classifies text after already-detected punctuation, and neither authorizes an operation nor
  detects prohibited intent. A structural replacement needs POS analysis plus a name/abbreviation
  model, which shifts the failure modes rather than removing them. **CONCERN, no P1 follows.**
- **Q4** Monotone accumulation of `crossesConfirmed` is correct: a longer run contains every
  boundary the shorter one did.
- **Q5** The `n(n+1)/2` invariant should be **restated** as a diagnostic/completeness invariant
  rather than a cost one. A future optimisation that skips blocked non-whole subspans is
  behaviourally safe and currently fails only by instrumentation. **P2 design debt.**
- **Q6** The predicate is a **tiling admissibility** rule, not a recognizer property. Its placement
  inside `recogniseOperation` is acceptable while fragments and tiling are both local there; a
  separate segmentation layer is warranted only once another consumer needs confirmed boundaries.
- **Q8** `CLAUSE_OPENING_TOKENS` overlaps `FRAMING_TOKENS` without being derived from it, so future
  edits can drift. **P2 debt**, mitigated by comments and discriminators, not enforced.
- **Q10** `show`/`tell`/`give` being refused as attribution verbs while `publish`/`report` are
  accepted is `REPORTING_ACTS` being a deliberately closed record-capability lexicon — a **product
  capability question**, not a parser inconsistency and not caused by this repair.

**Q7 and Q9 were returned UNDETERMINED with a named measurement.** Both were run, and both came
back against the repair:

| request                                                           | repaired    | pre-repair                                           |
| ----------------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| `What is the definition of Mr. Show?`                             | UNSUPPORTED | AUTHORIZED, DEFINITION `mr show`                     |
| `What did Mr. Show report about Alpha?`                           | UNSUPPORTED | AUTHORIZED, source `mr show`                         |
| `What is the definition of Samsung Electronics Co. 삼성전자?`     | UNSUPPORTED | AUTHORIZED, DEFINITION                               |
| `What did Samsung Electronics Co. 삼성전자 report about revenue?` | UNSUPPORTED | AUTHORIZED, source `samsung electronics co 삼성전자` |

"pre-repair" is `scripts/mutation/differential.py` case `prerepair`: the repair disabled at its one
point of effect, under the same lock / before-image / verified-restore transaction. So these are
regressions the repair introduced, measured rather than reasoned.

**Round 2 — DECISION: REFINE_IN_THIS_UNIT.** Terra withdrew the unqualified APPROVE: `Mr. Show` is
P2, but the mixed-script issuer form is **P1**, because `<English legal name> Co. <Hangul name>` is
an ordinary way to write a Korean issuer and this is a product with Korean coverage. Fail-closed,
but a core-query regression rather than acceptable release debt.

### The bilateral rule

A candidate boundary is confirmed only when the text AFTER it shows clause-opening evidence **and**
the run's HEAD is itself a complete request. A period ends a sentence only if a sentence preceded
it: `What is the definition of Samsung Electronics Co` is not a request, `What is the current
Gamma` is.

Placed in the run loop rather than in `confirmedBoundary`, as Terra directed: completeness depends
on where the run STARTS, while `confirmedBoundary` is deliberately boundary-local. The head's
readings are the previous iteration's, and `recogniseSpan` is cached on span text, so the rule adds
no span evaluation and leaves the `n(n+1)/2` contract intact.

"Complete" **includes a standalone prohibited request**, which Terra flagged before it could become
a defect: `Should I buy stock` is refused by the outer screen and is not an informational reading of
any span, so a readings-only test would have unblocked the P1 case itself. Mutant B-M8 exists for
exactly that half.

**Measured after the refinement.** Two of the four regressions are repaired, two are not:

    What did Samsung Electronics Co. 삼성전자 report about revenue?   AUTHORIZED   (was refused)
    What did Mr. Show report about Alpha?                            AUTHORIZED   (was refused)
    What is the definition of Samsung Electronics Co. 삼성전자?       UNSUPPORTED  (unchanged)
    What is the definition of Mr. Show?                              UNSUPPORTED  (unchanged)

The two that remain share a shape the bilateral rule cannot separate: the head reads alone
(`What is the definition of Samsung Electronics Co` is a valid DEFINITION request for the subject
`samsung electronics co`) AND the tail confirms, yet the two halves are one name. The attribution
form — the one Terra called P1 — is fixed; the DEFINITION form is not. Referred back rather than
patched on my own judgement.

All 112 binding tests pass, including the seven pinned refusals and the redirect P1 control. Two
discriminators were added for the newly authorized forms, and two mutants (B-M7, B-M8) for the two
halves of the head condition.

### Round 3 — DECISION: REFINE_FURTHER, and the residual is closed by the grammar already present

Terra graded the residual DEFINITION-form refusal **P1**, not P2: the subject-versus-source role of
the name does not make refusing a valid issuer-name request acceptable, and DEFINITION is a
supported deterministic operation. It also rejected both separators I had offered, with reasons
worth keeping because each would have re-opened the P1:

- **(i) prefer the longer reading when no complete tiling exists** — the swallowed-tail cases
  deliberately have no alternate tiling, because the tail does not authorize alone. Preferring the
  joined reading on tiling failure re-admits the buried question exactly.
- **(ii) require the tail to read alone too** — the pinned swallowed tails were _chosen_ because
  they do not read alone (`What about the Gamma level?`, `현재 기준금리는 얼마인가요?`, `What did
they say about Gamma?`). Making the rule symmetric would unblock every one of them. Terra
  confirmed the reading I had asked it to refute rather than letting a measurement be spent on it.

Terra prescribed no third rule and said so — "no third discriminator has been evidenced, so I will
not prescribe one" — and asked that any proposal be measured against both the residual names and
the pinned unreadable-tail controls, with isolated mutants per conjunct.

**The signal was already in the codebase.** `containsHangul` confirming a boundary unconditionally
was the defect: script change is not clause evidence, and a Korean CLAUSE is. `analyseCopularInterrogative`
— the same predicate analyser the Korean recognizer uses, from `koreanMorphology.ts` — separates
them with no new vocabulary:

    현재 기준금리는 얼마인가요?     carries a predicate   -> a clause, confirms the boundary
    삼성전자?                        bare nominal          -> continues the name it follows

Measured after the change:

    What is the definition of Samsung Electronics Co. 삼성전자?   AUTHORIZED, DEFINITION,
                                                                 subject " samsung electronics co 삼성전자 "
    What did Samsung Electronics Co. 삼성전자 report about revenue?  AUTHORIZED
    What is the current Gamma? 현재 기준금리는 얼마인가요?           still refused (the pinned swallow)

`What is the definition of Mr. Show?` remains UNSUPPORTED. That is the English DEFINITION form,
graded **P2** by the same review, and it is recorded here rather than repaired: the head reads, the
tail confirms, and no evidenced signal separates a one-token name from a one-token clause. The
attribution form (`What did Mr. Show report about Alpha?`) authorizes.

**Nine boundary mutants, 9 of 9 ISOLATED** (run `155cb1fdc2a8`, baseline 113 binding / 49
unrelated), including one per conjunct of the Hangul rule as Terra required: B-M1 removes the
Korean confirmation entirely, B-M9 restores the unconditional version.

### Assurance-harness lock, second review round (Luna, 2026-08-28) — VERDICT: APPROVE

Luna's remaining Q2 defect from the first round is closed. Its accepted coverage concerns, and what
was done with each:

| Concern                                                                                                                                    | Response                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H4's twelve rounds detect ~93% of a 6/30 mode and ~72% of a 3/30 mode, but only **~18%** of the 1/60 stranding mode; ~137 rounds gives 90% | The arithmetic is now written into the control's own comment instead of being implied, and `--soak` runs 150 rounds. **Recorded evidence: 54/54 controls pass at 150 rounds**, plus 180 rounds from the standalone race harness |
| H4 could not distinguish two winners (broken exclusion) from zero winners (stranding)                                                      | Split into **H4a** (no round produced TWO) and **H4b** (no round produced ZERO); the two failures mean opposite things                                                                                                          |
| H6 checks non-owner release sequentially, not against a concurrent release/replacement schedule                                            | **NOT CLOSED.** Recorded as coverage debt. Luna classed it a concern, not a demonstrated wrong result                                                                                                                           |
| A reclaimer that dies holding the claim leaves a permanent fail-closed lock                                                                | Intended and documented, with a diagnostic naming the directory. Luna confirmed the scoping is correct                                                                                                                          |

Luna verified explicitly that nothing in the reviewed files claims `POWER_LOSS_SAFE`,
`FILESYSTEM_CRASH_SAFE`, or `ARBITRARY_CONCURRENT_WRITER_SAFE`. What is established is: a hung
child, a parent killed between mutant write and restore, a third-party edit during recovery, a
second harness against a live one, the lock startup window, four-way dead-owner reclaim, and
non-owner release.

### P1 closure review of `009341d` (Sol, 2026-08-28) — VERDICT: REWORK_REQUIRED, and it was right

Reviewer: `gpt-5.6-sol`, READ-ONLY, exact tree at `009341d`.

**The finding: `who` and `why` were missing from `CLAUSE_OPENING_TOKENS`.**

    What did Reuters publish about Alpha? Why the Gamma decline?
      -> AUTHORIZED, subject " alpha why the gamma decline "
    Should I buy stock? What did Reuters publish about Alpha? Who published Gamma?
      -> PROHIBITED, informational subject " alpha who published gamma ", source "reuters"

Reproduced before anything was touched (`scripts/reproduce-wh-tokens.ts`), and the reproduction
found **four more** the review had not named:

    Who said that?            Compare it to Gamma.
    Any Gamma figures?        Same for Gamma?          List the Gamma figures.

Seven swallows, each one absent word. `whose`, `whom`, `when` and `where` were already refused —
but each only through some OTHER token in the same clause (`is`, `did`, `was`), which is coverage
by luck, so they are now named explicitly rather than left to it.

**Measured after the addition**, over a corpus extended with both the new tail forms and the
name-tail forms that the additions put at risk (`list`, `any Gamma`, `same period revenue`,
`Compare Inc`, `List Ltd revenue`):

| group added                                    | swallows closed | requests wrongly refused |
| ---------------------------------------------- | --------------- | ------------------------ |
| interrogatives `who whom whose why when where` | 456             | **0**                    |
| imperatives `compare list`                     | 1,380           | **0**                    |
| determiners `any same`                         | 1,040           | **0**                    |

99,072 generated requests, one direction only. Three new mutants (B-M11 to B-M13) pin the groups.

**The method question this leaves open, which is the more important half.** Every mutant asks
whether an implemented clause is LOAD-BEARING. None can ask whether the set is COMPLETE, and a
mutation score cannot tell "nothing is missing" from "nothing missing has been thought of". Six
absent tokens sat behind a 9-of-9 score. Adding these seven does not make the eighth findable.

Deriving the set from `FRAMING_TOKENS` by subtraction was considered and does not help: `who`,
`why`, `compare`, `list`, `any` and `same` are not in `FRAMING_TOKENS` at all. They reach an
OPEN-CLASS region, where unread content is not checked — which is the defect's real shape, not a
gap in the allowlist. **OPEN: `CLAUSE_OPENING_TOKENS_COMPLETENESS = UNESTABLISHED`.** The `?`
candidate named here has since been measured, reviewed and implemented — see "The completeness
question" below — and it closes a defect class without closing this one.

**Sol's other findings, and what was done with each.**

- **S5, and it was right**: "one per separable clause" was overstated. B-M7 removed the whole head
  condition and B-M8 only its advice clause, so `readings.length > 0` had no mutant of its own and
  its isolation was being claimed rather than measured. **B-M10 added.**
- **S6, overstatement**: "the P1 is REPAIRED" was contradicted by the reproductions above. The
  status line is corrected rather than edited away.
- **S2**: excluding `query` from the publication assertion is correct for derived-content checking,
  but the comment must not imply `query` is never displayed — `/ask` renders `result.query` on the
  `NOT_FOUND` branch, and it is status exclusivity, not non-display, that keeps it off the redirect
  surface. Comment corrected.
- **S2, noted not closed**: the same parser feeds `inferenceAuthorization`, so a malformed
  authorized form reaches the planner authority path too. The demonstrated reading is
  planner-permitted by its operation contract. No wrong output was demonstrated there; recorded.
- **S3**: no additional over-refusal found beyond the recorded `Mr. Show` P2.
- **S4**: the reproduced mixed request stays PROHIBITED. No path reclassifies a directive as
  informational and none produces or implies buy/sell/allocation content. The failure was narrower
  and is still real: polluted informational authority retrieving records for a composite subject.
- **S7**: no P0. No secrets, destructive behaviour, security or data-integrity defect.

### The completeness question, put to the architect and answered NO (Terra, 2026-08-28)

`CLAUSE_OPENING_TOKENS_COMPLETENESS = UNESTABLISHED`, **DECISION: RECORD_AS_DEBT.**

The question was not whether the rule is right — three earlier rounds settled that — but whether
its method can ever be finished. Six absent tokens sat behind a 9-of-9 mutation score, and they
were found by a reviewer reading, not by anything this repository runs.

Terra's answer, and it is the one worth keeping:

> No measurement at this design level can prove `CLAUSE_OPENING_TOKENS` complete. The current
> mutants correctly prove implemented members are load-bearing, but cannot discover omitted
> members. **A generated "complete opener" corpus merely relocates the unproved completeness claim
> into its generator.** Completeness would require a formally specified, sound-and-complete grammar
> plus a complete name/abbreviation model; this design intentionally accepts open-class names by
> position. That model does not exist here.

Graded **recorded debt, not an active P1**: the seven reproduced instances are pinned and measured
closed; what is open is that the eighth is not findable. Standing instruction attached to it: **do
not claim completeness after any later change**, punctuation-class ones included.

### The one bounded strengthening it named, measured before being implemented

`?` was believed never to occur name-internally in this domain, while `.`, `!` and `;`
demonstrably do — `Inc.`, `U.S.`, `Mr.`, `No.`, `Yahoo!` — which is the entire reason candidate
boundaries are provisional at all. Terra could not name a `?`-bearing product, ticker, index or
issuer either, and was careful that this is **evidence for a measurement, not a universal
invariant**, and asked for the two directions to be reported separately before implementation.

**That belief was FALSE and is corrected below**: a later review found Companies House company
09804638, `CAN I USE A QUESTION MARK IN A COMPANY NAME? LTD`. Terra's caution was the right call
and the sentence written after it was not.

    99,072 generated requests
      swallows closed          258
      wrongly admitted           0

Those 258 are all generator strings, so a separate probe asked whether the shape occurs in requests
a person would actually write (`scripts/probe-question-mark-tails.ts`). It does:

    What is the current US headline CPI? Korea?   ->  subject " us headline cpi korea "
    What did Reuters publish about Alpha? Gamma?  ->  subject " alpha gamma "
    What is the current Acme Inc. revenue? Gamma? ->  subject " acme inc revenue gamma "

Two questions answered as one composite subject — the same defect class as the P1, in an ordinary
terse follow-up. Implemented on that basis, with two mutants: **B-M14** removes the rule, **B-M15**
extends it to every terminator, which is precisely the failure it exists to prevent and must break
`Yahoo! Finance` and every other name carrying internal punctuation.

This closes a defect class. It does **not** close the completeness question, and Terra was explicit
that it cannot: `Compare it to Gamma.` and `List the Gamma figures.` end in `.`, so the lexical set
is still load-bearing and still unproved complete.

### The terminator rule turned five mutants from ISOLATED to MISSED, and the tests were the reason

Adding `?`-confirms dropped the boundary score from 13/13 to **10 of 15** in one step. The five
that died were the Korean clause rule, the determiner rule, and all three groups of clause-opening
tokens the P1 review's finding had just added — every lexical rule in the predicate, and none of
the structural ones.

One cause for all five. **Every discriminator in the suite used `?` as its internal boundary**, and
`?` now confirms on its own, so not one of them reached the lexical rules any more. Nothing about
the product was wrong; the tests had stopped being able to see it.

This is the third time this exact shape has appeared in this unit, which is why it is written down
rather than just fixed:

| when       | the half the tests could not fail on                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| pre-repair | every swallowing test picked a tail that authorizes ALONE — the precondition for cover competition to work |
| B-M3       | every swallowed tail either opened with a determiner or had its clause-opening word first                  |
| here       | every internal boundary was `?`, which the terminator rule now catches without consulting anything lexical |

The repair is the same each time: pose the case on the other side. Nine discriminators added with
the boundary changed from `?` to `.` — `What did Reuters publish about Alpha. Who published Gamma?`
and its siblings — measured to refuse (`scripts/probe-period-boundary.ts`) BEFORE being asserted,
because a discriminator written from expectation rather than measurement is how a suite acquires a
test that passes for a reason nobody checked.

The five name controls were re-measured on the same probe and still authorize, so the lexical rules
are being tested where they still do work rather than widened until something breaks.

**Do not read the recovered score as the rules being redundant.** B-M1 and B-M4 were MISSED because
no test reached them, not because the Korean and determiner rules do nothing — `What is the current
Gamma. 현재 기준금리는 얼마인가요?` needs the Korean rule and always did. Nothing here is deleted on
the strength of a surviving mutant; that requires a disable-and-measure proof, and
`scripts/mutation/differential.py` case `korean-branch` exists to produce one if the question is
ever reopened.

### P1 closure review, round 2 (Sol, 2026-08-28) — REWORK_REQUIRED, and both findings are worse than reported

**Finding 1 — the lexical set is not incomplete, it is UNBOUNDED.**

Review named one more absent token:

    Should I buy stock? What did Reuters publish about Alpha. Summarize Gamma.
      -> PROHIBITED, informational subject " alpha summarize gamma ", source "reuters"

Reproducing it (`scripts/reproduce-sol-round2.ts`) found six more in a single probe, without
searching:

    summarise   break down   outline   chart   plot   find

Every one authorizes with the second clause absorbed into the subject region. `explain` and
`describe` refuse only because they happen to be in the set. This is not a gap to be filled. It is
every ordinary way to ask for something, and the previous round already added seven words believing
they were the tail of the distribution.

This changes the grading. `CLAUSE_OPENING_TOKENS_COMPLETENESS = UNESTABLISHED` was recorded as debt
on the architect's ruling that completeness cannot be measured at this design's level. That ruling
stands, but the debt is no longer abstract: it has a reproducible publication-authority defect class
with an unbounded instance set, and the module's own stated principle says why —

> An allowlist, for the reason IR-106 settled: a denylist of ways to ask for something improper
> cannot be finished, and an allowlist of function words can.

`FRAMING_TOKENS` obeys that. `CLAUSE_OPENING_TOKENS` does not: it enumerates ways a clause may
OPEN, which is the unfinishable direction. The swallowing happens inside an OPEN-CLASS region, where
unread content is not checked at all, so the allowlist discipline never reaches it.

**Finding 2 — `?` DOES occur inside a registered issuer name, and the claim was false.**

Companies House company 09804638: `CAN I USE A QUESTION MARK IN A COMPANY NAME? LTD`. Reproduced:

    What is the definition of Can I Use A Question Mark In A Company Name? Ltd?
      -> UNSUPPORTED   (should authorize the whole name)

The architect had written, before the rule was implemented, that "no counterexample currently known"
is evidence for a measurement and not a universal invariant. The code comment and two documents then
asserted it as fact anyway. Two reviewers failing to think of an example is not evidence that none
exists, and the reviewer who found it went and looked rather than reasoning. All three statements
are corrected in place.

What survives is a **trade-off**, stated as one: 258 swallows closed and 0 wrongly admitted over
99,072 requests, against one known false refusal of a novelty registration. That weighing is a
judgement, not a measurement, and it belongs to the architect.

Also observed while reproducing, and NOT caused by either finding — pre-existing, recorded so it is
not rediscovered as part of this unit:

    What did Can I Use A Question Mark In A Company Name? Ltd report about revenue?
      -> AUTHORIZED, source "i use a question mark in a company name ltd"

The leading `Can` is dropped because `can` is a framing token, so the served source is a TRUNCATED
version of a real name. Same class as the `Bloomberg L.P. show` finding: a framing-token
interaction, not a boundary one.

**Confirmed by the same review, and worth keeping:** the five mutants that went MISSED and were
revived by the nine `.`-boundary discriminators are genuinely load-bearing — none is equivalent
under the `?` rule — and the nine discriminators are honest, each avoiding the `?` shortcut with no
alternative trigger substituting for the rule it names. No P0.

### OPEN BLOCKER P1 — the clause-opening set is unbounded, and 28 of 38 unknown tails are swallowed

**STATUS: `P1_UNBOUNDED_CLAUSE_OPENING_CLASS` — OPEN. This unit does NOT close.**

Architect ruling (Terra, 2026-08-28, round 5): **P1, blocks closure.** Not recorded debt any more:

> "Known instances closed" is not enough after the very next ordinary probe produced six further
> instances. Record it only if the product explicitly accepts the remaining class as a known
> release risk; it is not a clean P1 closure.

The measurement it asked for (`scripts/probe-unknown-tail.ts`): one head that reads
(`What did Reuters publish about Alpha.`), thirty-eight tails of every shape the lexical set does
not enumerate, `.` boundary throughout.

| tail shape                                                                                                                         | swallowed    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| imperative not in the set (`Summarize`, `Break down`, `Chart`, `Plot`, `Find`, `Check`, `Look up`, `Graph`, `Pull the ... series`) | 11 of 12     |
| imperative IN the set (control)                                                                                                    | 0 of 5       |
| interrogative fragment (control)                                                                                                   | 0 of 4       |
| bare noun (`Gamma.`, `Revenue.`, `Inflation.`)                                                                                     | 4 of 4       |
| proper-name-shaped (`Gamma Corp.`, `Alpha Holdings.`)                                                                              | 4 of 4       |
| coined token (`Zorbulate Gamma.`)                                                                                                  | 4 of 4       |
| Hangul after a period                                                                                                              | 2 of 2       |
| digits (`2024.`, `Q3 Gamma.`)                                                                                                      | 3 of 3       |
|                                                                                                                                    | **28 of 38** |

Every swallow serves a composite subject — `alpha summarize gamma`, `alpha 2024`,
`alpha zorbulate gamma` — with source `reuters`. Factual records represented as answering a
question nobody asked. Not advice, and no LEGAL_GUARDRAILS breach, but a publication-authority
breach.

**Why it cannot be closed by adding words.** The module's own principle, at `FRAMING_TOKENS`:

> a denylist of ways to ask for something improper cannot be finished, and an allowlist of function
> words can.

`CLAUSE_OPENING_TOKENS` enumerates ways a clause may OPEN — the unfinishable direction — and the
swallowing happens inside an open-class region where unread content is never checked, so the
allowlist discipline never reaches the tail. Seven tokens were added in one round believing they
were the tail of the distribution; six more fell out of the next probe; twenty-eight out of this one.

**Why the obvious inversion is not implementable here.** "Confirm the boundary unless the tail is a
name continuation" is right as a fail-closed policy — the architect agreed — but the continuation
class is not closed:

> bare nominals are an open lexical class ... "first token is unread open-class" is a useful risk
> predicate, not a closed discriminator without a POS/name lexicon. It cannot distinguish
> `Chart Gamma` as an imperative from `Chart Gamma` as a name.

That lexicon does not exist in this repository and building one is not a bounded change.

**Where the review was WRONG, checked rather than accepted.** The same ruling claimed `headReads`
is computed but not used, so "the executed condition is tail-only". That is false, and three
independent things say so: the executed line is
`if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;`; mutant B-M7
removes `&& headReads` and is ISOLATED; and a disable-and-measure run
(`differential.py` case `head-condition`) flips `What did Mr. Show report about Alpha?` from
AUTHORIZED to UNSUPPORTED when it is removed. The bilateral rule runs as documented.

That same run corrected a belief of MINE, in the other direction: of the seven name controls, the
head condition protects only `Mr. Show`. `What did the U.S. Bureau of Labor Statistics publish
about nonfarm payrolls?` is carried by its tail containing no clause-opening token, not by the
head — so a continuation class would have to admit a tail containing `publish` and `about`, which
is a much stronger constraint than I had assumed when I put the question.

**What is decided and what is not.**

- `?` rule: **KEEP**, architect ruling, with the registered-issuer exception pinned as an
  `it.fails` test so it cannot quietly outlive its justification.
- The seven, then six, then twenty-eight known instances: the first thirteen are closed and pinned.
- The CLASS: open. Closing it needs either a POS/name lexicon this design does not have, or an
  explicit product decision to accept it as a known release risk. **That decision is not mine and
  is not an engineering question**, so it is escalated rather than assumed either way.

Two further measurements the architect named are NOT yet run, and are named here rather than
quietly skipped: a continuation false-refusal corpus of real issuer names stratified by tail shape,
and the head-alone matrix extended to every candidate boundary within each query rather than the
first.

### ESC-015 applied — Option B, narrowed by terminator shape (2026-08-28)

Decision `[CHATGPT_DECISION][ESC-015]`, issue #2 comment 5448101400: **OPTION B, measure before
implementing.** A rejected (do not ship the class as known risk), C deferred (no POS/name lexicon),
and adding more clause-opening words explicitly forbidden as a closure strategy.

#### Plain Option B was measured and NOT implemented

Block a run whose head reads at ANY candidate boundary, dropping the tail-evidence conjunct:

    SWALLOWS_CLOSED             28 of 28
    FALSE_REFUSALS_INTRODUCED    6 of 14 controls

The six were `Yahoo! Finance`, `Acme Inc. revenue`, `Samsung Electronics Co. 삼성전자` (definition
form), `U.S. rate of inflation`, `Acme Inc. rate` and `No. 10 index level` — three of them named in
the decision itself. Step 5 says do not implement, do not patch entity names, do not extend opener
vocabulary. None of those was done.

#### What shipped instead: the terminator's SHAPE

FIVE of the six share one property: the period follows an ABBREVIATION — `Inc.`, `U.S.`, `No.`,
`Co.` — while all 28 swallows follow an ordinary word (`Alpha.`, `Gamma.`). **CORRECTED: this said
all six.** `Yahoo! Finance` is the sixth and its terminator is `!`, not an abbreviation period; it
is handled by `!` never confirming, which is a different rule. Review caught the overreach. An abbreviation
is either short or already carries internal periods, and that is a test on token SHAPE, not
membership of any list. It does not grow a word at a time and cannot be defeated by a verb nobody
thought of, which is the whole objection to the previous approach.

    `?`  a sentence end. The registered-issuer exception is the known cost, pinned as it.fails.
    `!`  NEVER -- `Yahoo!` is a brand.
    `;`  NEVER -- `Smith; Jones` is a partnership.
    `.`  a sentence end UNLESS the preceding token is abbreviation-shaped.

Tail evidence is still consulted; the two rules are a UNION.

    pinned corpus (80 cases)    65 of 65 refusals closed, 0 false refusals, 14 of 14 controls green
    wide corpus (99,072)        174 swallows closed, 0 newly authorized

The implemented tree reproduces the measured mutant byte for byte — the same probe output, diffed.

**CORRECTED once, because the first version of this claim was stale.** The diff was run BEFORE `;`
was moved to provisional, and the differential case still sent `;` through the abbreviation test
afterwards, so the measured mutant and the shipped tree disagreed on `Smith; Jones` while the claim
stood. Structural review caught it. The differential case is fixed and the diff re-run against the
shipped tree; it now holds.

#### Two errors the measurements caught, and neither was caught by reading

**The first narrowing REPLACED the tail evidence instead of joining it.** With `!` never a sentence
end and nothing else consulted, 1,032 NEW swallows opened at `!` boundaries. The 80-case denominator
showed a clean zero; only the 99,072-request corpus saw it. There is now a regression test for
exactly that shape.

**`Smith; Jones` — a semicolon inside a partnership name.** My corpus had no semicolon-in-a-name
case at all; the suite already held one, and it failed, serving the subject `smith` instead of
`smith jones revenue`. A shorter subject that authorizes is the dangerous failure, not one a reader
would notice. `;` moved to provisional alongside `!`.

#### The residual, quantified rather than described

Sweeping the 38-tail matrix across all three terminators:

| boundary | swallowed   | refused |
| -------- | ----------- | ------- |
| `.`      | **0 of 38** | 38      |
| `!`      | 28 of 38    | 10      |
| `;`      | 28 of 38    | 10      |

**The class is closed at `.` and `?` and remains OPEN at `!` and `;`**, precisely because those two
must stay provisional for the names above. This is pre-existing rather than a regression — before
Option B those boundaries had lexical evidence only, and they still do — but it was not quantified
before and it is now.

So the ESC-015 acceptance criterion "no known or generated swallowing counterexample can publish"
is **NOT met**, and this unit does not close. Terminator shape cannot resolve `!` and `;`: nothing
distinguishes `Yahoo! Finance` from `Alpha! What is the CPI?` except the tail, which is the lexical
problem the decision rejected. That is the sharpened question for the follow-up.

#### The mutation score fell again, and again the tests were why

Adding the terminator rule dropped the boundary score from 15/15 to **12 of 20**. Eight mutants went
ISOLATED to MISSED: the Korean rule, both determiner mutants, all three token groups, accumulation,
and the internal-period test. One cause — every discriminator sat at a `.` boundary, and `.` is now
decided by shape before any lexical rule is consulted.

**Fifth occurrence of this shape in this unit.** The rules were not dead; they are load-bearing
exactly where the terminator stays provisional. Eleven discriminators were added at `!` and `;`
boundaries, each measured to refuse before being asserted
(`scripts/probe-provisional-boundary.ts`), plus an accumulation case pairing a confirmed `?` with a
provisional `!`, plus `N.Y.S.E.` — four letters and internal periods, a name from this product's own
domain, and the only control that separates the two halves of the abbreviation test.

#### Recorded, not fixed, and not caused by this repair

`What did S.E.C. publish about Alpha?` serves source `e c`: the leading `S` is dropped. Same class
as the `Can I Use A Question Mark...` truncation — a framing-token interaction, not a boundary one.

### ESC-015 whole-request exact-cover redesign (2026-08-28), continuing from `cfcacad`

Consumed: `[CHATGPT_DECISION][ESC-015]` comment 5448672325, and
`[CHATGPT_DECISION][MARKET-ESC015-AUTHORITY-REANCHOR-20260828]` comment 5451226106. The
`[CHATGPT_ARCHITECT_GUIDANCE]` at comment 5450568344 is anchored to `8baf368`, 45 commits behind,
and was read ONLY as a subsumed acceptance-case source. Local == remote == `cfcacad` verified
before any write.

#### The reproduction matrix

`scripts/reproduce-exact-cover-matrix.ts`, 34 cases, one per load-bearing item the contract names,
each carrying its expectation. **14 failed at `cfcacad`; 6 fail now.**

One of the original 14 was my error rather than a defect: I expected `현재 기준금리는 얼마인가요?`
to publish, and the 3-eojeol form is a documented capability limit of the Korean copular matcher.
Corrected in the matrix; the 2-eojeol control is used instead.

#### Item 2 — delimiter-local classification removed

`terminatorEndsASentence` is deleted. It refused 10 of 31 ordinary entity and title abbreviations
and no threshold could fix that: `Inc` must join at three letters while `CPI` must split at three.
Removing it restored `Corp.`, `GmbH.`, `Dept.`, `Prof.`, `Assn.`, `Bros.`, `Univ.`, `Corpn.`,
`Assoc.` and `Sched.`, and the `it.fails` pinning `Corp.` became an ordinary passing control.

No threshold, no suffix registry, no opener vocabulary was added. Seven mutants (B-M14..B-M20) were
deleted with the rule, because a mutant whose target does not exist is not evidence.

#### Item 4 — prohibited dominance, and the capability it costs

A prohibited constituent now dominates the whole request. The `informational` payload, its producer
`recogniseInformationalConstituent`, the retrieval behind it in `askMarket`, and the redirect
message that promised "a factor analysis instead" are all removed.

This closes the directive-in-source class **at every boundary at once** -- not by bounding the
payload better, which failed three times, but by there being no payload. The `!` and `;` cases that
blocked the previous round are closed as a consequence.

**The cost is a designed capability, and it is gone by decision rather than by accident.**
`Should I buy X? What is the current X revenue?` returns no figures. Eight integration tests
encoded the old contract and were rewritten; every one keeps its NEUTRAL control non-empty, so the
new emptiness is provably the rule and not an empty fixture -- a trap that file has fallen into
before. The anti-flattery property those tests protected is not lost but made trivial: a refusal
serving nothing cannot re-rank anything.

Also reduced, and recorded rather than hidden: `adversarial_resilience` no longer has a populated
refusal to examine anywhere in the suite. Its control now asserts `figureCount === 0`, which is a
weaker thing to check than what it replaced.

#### Items 3, 6, 7 — second-object residue, decided without inventory

A relation role that names more than one thing refuses. `and` and `or` were already refused by the
existing `CLAUSE_CONNECTIVES`; the comma, `versus` and `compared with` were not, and authorized a
stored mechanism with effect `beta versus gamma`.

`OBJECT_COORDINATORS` is a sibling closed function-word class, justified the same way
`CLAUSE_CONNECTIVES` already is in this module. The comma is checked on the RAW query because
`normalize` deletes punctuation before any region exists.

Keyed to relation roles only. CORRECTED: this said "principled rather than fitted"; the helper
reads no contract and is invoked only from `mechanismMatch`, so a future cardinality-2 operation is
not protected by it. STORED_MECHANISM being the only `subjectCardinality: 2` contract, so a coordinator inside an endpoint
contradicts a claim the contract makes. Cardinality-1 subjects keep their commas --
`What is the current Smith, Jones revenue?` is one issuer and is pinned.

The acceptance case is asserted at the PARSER, which consults no repository, so a refusal there
cannot be confused with a lookup that found nothing. A coined second object refuses identically to
a known one; both are pinned.

#### Mutation evidence

    exact-cover set   6 of 7 ISOLATED     baseline 158 binding / 49 unrelated
    boundary set      13 mutants, re-run on the moved tree

M-DOMINANCE, M-RESIDUE (three variants), M-EXACT-COVER-MULTI and M-ROLE-SPAN all turn their
intended controls red.

**M-RESIDUE first survived, and the reason is worth keeping**: I had verified the residue guard with
a SCRIPT and never added tests. The matrix is not the suite. Three acceptance tests were added and
the mutants then died -- the mutation run found a missing test, which is what it is for.

**M-EXACT-COVER survives and is NOT being explained away.** `interpretations.length > 1` needs the
joined run admitted while a split cover also exists, and the tail evidence that blocks a joined run
is the same evidence that makes a tail read alone, so the conditions appear anti-correlated by
construction. Disable-and-measure over 99,072 generated requests found **zero** differing outputs.
That is `EQUIVALENT_OVER_CORPUS`, not proof of unreachability, and no test was manufactured to
force it red.

#### What is NOT closed — six cases, one class

Informational-only multi-intent joined by a bare sentence boundary, with no coordinator, no
clause-opening token, no Hangul predicate and no directive:

    What did Reuters publish about Alpha. Summarize Gamma.   -> subject ` alpha summarize gamma `
    ... the same at `!` and at `;`, plus `Oil.` and `CPI.` heads, plus the mechanism-tail form

Every closed grammar available here is blind to them. Separating a name continuation from a new
clause needs the POS/name model ESC-015 defers, and the delimiter rule that had been masking them
is exactly what item 2 removed. They are pinned as `it.fails` so the class is visible rather than
absent.

What has changed for this class: none of it can reach a served field when a directive is present,
because a prohibited request now publishes nothing at all. What remains is a composite SUBJECT on a
purely informational request.

### Fresh exact-tree review of `efd18e2` — both REWORK_REQUIRED, and both were right

Reviewers: `gpt-5.6-terra` (structural) and `gpt-5.6-sol` (publication authority), READ-ONLY, on the
exact pushed tree. No evidence inherited from `cfcacad`, `05b94ba` or `8baf368`. GitHub reports zero
statuses and zero check-runs for `efd18e2`: **REMOTE_CI = NONE.**

#### A claim of mine that was simply false

I wrote, in the commit message and in a new test's docblock, that **NOTHING** called
`deriveCanonicalCandidateEnvelope`. `tests/integration/canonical-candidate.test.ts` has called it
directly, ten times, since long before this unit existed. Review found it in the repository I had
just searched.

What was true is much narrower and is all that should have been said: the resolver was not in the
MUTATION RUNNER's binding set, so the candidate mutants had no discriminator. "No test calls this"
and "this run could not see it" are different statements and I made the wrong one. Corrected in
place; `canonical-candidate.test.ts` is now in the binding set.

#### P1 — the residual class is worse than I characterised it

I wrote that the residual multi-intent class "publishes a composite SUBJECT on an informational
request" and could not carry a directive. Refuted by construction, reproduced:

    What is the current Alpha. Purchase Gamma shares.
      -> AUTHORIZED, subject " alpha purchase gamma shares ", and Alpha's figures are served

Two independent gaps compose. `purchase` is in no clause-opening set, so the boundary stays
provisional; and bare `Purchase <security>` is missed by the advice screen entirely, so the request
is never classified as prohibited. `Sell Gamma now` IS caught; `Buy Gamma shares` is not.

Neither is patched. Adding trading verbs to the advice screen is the unfinishable denylist this
whole unit exists to stop building, and ESC-015 forbids closing by vocabulary. Standalone
`Purchase Gamma shares.` is UNSUPPORTED and publishes nothing, so the harm needs the swallow --
a mitigation, not a defence. Pinned as `it.fails`.

**This is the third time I have described a residual too narrowly and been refuted by
construction.** The pattern is worth more than the instance: each time I characterised the harm
from the examples I had rather than from the mechanism, and each time the mechanism reached further.

#### REAL_DEFECT — the raw comma refuses an ordinary issuer name

    Explain how Alpha, Inc. affects Beta.   -> UNSUPPORTED

The comma is read from the RAW query because normalization deletes punctuation before any region
exists, so a comma anywhere refuses the relation. `Alpha, Inc.` is ordinary US style.

Kept rather than reverted, and the trade is stated instead of buried: dropping the comma test
restores this name and re-opens `Explain how Alpha affects Beta, Gamma.` publishing `A -> B` while
discarding `C`. ESC-015 refuses to accept a publication-authority defect as V1 debt and prefers
fail-closed refusal, so the availability defect is the one left standing. Pinned as `it.fails` and
returned to ESC-015 rather than decided here.

#### My subsumption argument was unsound, and the measurement settled it

I argued M-CANDIDATE-CARDINALITY was unreachable because a region that is "exactly framing plus one
identity" cannot also name two identities. Review refuted it: `variablesNamedIn` admits separately
occurring identities, and with the cardinality guard removed the exactness check inspects only
`causes[0]`. It named the construction -- a stored identity that is ALSO accepted framing.

Implemented as a test with `the` seeded as a stored cause. Grotesque, and that is the point: it
isolates a guard nothing else could reach. **M-CANDIDATE is now 3 of 3 ISOLATED**, up from 0 of 3
before the layer had any production-path coverage at all.

#### Two more overstatements, corrected in place

`OBJECT_COORDINATORS` was called "the same closed grammatical class as `CLAUSE_CONNECTIVES`". True
of `and`/`or`; false of the comparison forms -- `relative to`, `as opposed to`, `rather than` and
`in comparison with` are productive multiword constructions the list cannot enumerate. The honest
statement is that the coordination half is closed and the comparison half is a partial list.

The residue guard's placement was called "principled rather than fitted" because STORED_MECHANISM
is the only `subjectCardinality: 2` contract. The helper reads no contract at all -- it is invoked
only from `mechanismMatch`. Currently correct, not contract-driven.

`docs/PROJECT_STATE.md` claimed "2297 / 2297" and, two clauses later, "2285 passing plus 12". Both
reviews caught it. One fresh run on the exact tree settles it: **2301 total, 2287 passing, 14 pinned
`it.fails`, 128 files.**

#### Accepted as accurate by review

Prohibited dominance has no bypass: `askMarket` returns three empty collections, `/ask` renders only
those, and the inference path stops before candidate derivation. The P1 above is a directive
MISCLASSIFIED as informational, not a prohibited request that published.

The five envelope tests do reach the canonical resolver, and they now ASSERT reachability rather
than accepting an upstream refusal -- review was right that accepting one proves nothing.

`adversarial_resilience` losing its populated refusal is disclosed accurately and is a coverage
reduction rather than a wrong output.

## IR-114 — the completion sentinel had never been asked a real question

Status: `VERIFIED_WITH_LIMITATION` (2026-09-01). Discovered by wiring, not by review.

`CLAUDE.md` names `evaluateStopSentinel()` in `src/server/evolution/scheduler.ts` as **the only
normal completion sentinel**. It is carefully written and thoroughly tested, and until this entry
nothing in the repository could answer it: its only non-test caller, `scripts/next-work.ts`,
supplied exactly one of its nine inputs and documented that as deliberate.

It was half right. Asserting a zero would indeed be the failure the sentinel exists to refuse — but
never GATHERING one meant eight conditions had never been evaluated against reality, and `MAY STOP`
was false by construction rather than by finding. A predicate that cannot vary is not a sentinel.

`scripts/stop-evidence.ts` establishes what the machine can prove and reports the rest with the
reason. Supplying a subset is safe by construction: `mayStop` needs every condition satisfied, so an
absent field can only hold the answer at `false`.

### What it found on the first real run

Against the live runtime root (`C:/AI-Projects/market-os/.local/control-bus`):

    no received decision waiting to be consumed -- 11 received decisions.
    the control-bus watcher is alive to receive one -- Control-bus watcher: STOPPED.

Both were previously "never established". The 11 are `RECEIVED_UNVALIDATED` entries the consumer
never judged — `RC-GATES-001`, `MARKET-RESUME-002/003`, `MARKET-RC-CONVERGENCE-RESUME-008`,
`MARKET-GATE-N-REWORK-009`, `MARKET-GATE-O-REWORK-010` and others. They are **not applied on
sight**: every one predates the current HEAD by a long way and would have to clear the staleness
check in `CLAUDE.md` first. Recorded as a backlog to judge, not as work to do.

`TRUE_IDLE => WATCHER_REMAINS_ALIVE` says a stopped watcher is a task rather than rest. It has not
been started here: the watcher is a long-lived local poller with its own lifetime, and this session
already polls the channel on the operator's own schedule. Starting a second poller is the operator's
call.

### Limitation

Six of the eight inputs are still not gathered, each listed in `NOT_ATTEMPTED` with its reason.
`unresolvedFailures` in particular would require running the suite, build and typecheck — a cached
result is a claim about a past tree, and this module must not turn one into a fact about this one.
So the sentinel still cannot reach `mayStop: true`; it can now say which of its refusals are
findings and which are absences, which it could not before.

### IR-114 addendum — the 11 are all stale, mechanically

`scripts/inbox-triage.ts` (read-only) mechanises the check `CLAUDE.md` states in prose: does the
decision target this repository, and has it gone stale against HEAD. Run against the live runtime
root, every one of the 11 unjudged entries comes back the same way:

    11  STALE_REFRESH_REQUIRED   nearest anchor 162-211 commits behind HEAD

The uniformity was checked rather than trusted, because a uniform answer is this project's usual
signature of a broken tool. The DISTANCES vary — 211, 210, 186, 184, 182, 173, 162 — which is the
non-uniformity that argues the analysis is reading the bodies rather than defaulting.

None names a foreign repository. Nothing was applied, resolved or refreshed: the module produces a
decision-ready list and deliberately does not decide. Whether these are answered with
`[ESCALATION_REFRESH_REQUIRED]`, resolved as superseded, or left, is a judgement about a shared
transport and stays with the operator.

The governing rule is that `ANCHOR_UNVERIFIABLE` never collapses into `CURRENT`. A commit missing
from the local object store may be a branch nobody fetched here, and "I cannot check" reading as
"it checks out" is exactly how a stale decision gets applied. Five mutations, 5/5 ISOLATED.

### IR-114 second addendum — the triage mechanised two of the three facts

`[CHATGPT_ARCHITECT_GUIDANCE][MARKET-INBOX-TRIAGE-OPEN-ID-20260901]` reproduced a structural gap in
the commit above, and it is this branch's signature mistake once more. The rule the module quotes
names THREE independent facts — targets this repository, matches an OPEN id, is not stale — and the
implementation checked the first and the third. `protocolId` went from input to output untouched.

Reproduced against the committed implementation before repairing, with a state recording the id as
`APPLIED`:

    before   STALE_REFRESH_REQUIRED   nearest anchor is 3 commit(s) behind HEAD
    after    NOT_ACTIONABLE           ALREADY_JUDGED / STALE_REFRESH_REQUIRED

The two answers are now produced separately and combined once, because they are independent. Only
an `OPEN` id can be actionable; staleness never promotes an id that had no standing.

Openness comes from the canonical control-bus state — terminal inbox statuses and outbox postings —
never from body prose, recency, or the fact that a row is sitting in the inbox. A
`RECEIVED_UNVALIDATED` row means the watcher wrote something down and nobody judged it, which is a
statement about this machine rather than about an outstanding question. Judged BEATS open, so a
historical id cannot re-enter through a stale row.

**The live answer changed, and the previous entry in this file was over-claiming.** The outbox
records `0 escalations posted from here`, so no id's standing can be established:

    11  NOT_ACTIONABLE  (STANDING_UNVERIFIABLE / STALE_REFRESH_REQUIRED)

Still read-only. Nothing applied, resolved, refreshed or posted. Nine mutations, 9/9 ISOLATED.

The guidance was treated as a review finding independently reproduced, NOT as an authorisation:
whether a `CHATGPT_ARCHITECT_GUIDANCE` may authorise anything is the open ESC-014 question, and
correcting one's own read-only script needs no authority beyond the finding being true.

### IR-114 third addendum — my own two modules disagreed, and I found this one

Not a review finding. `scripts/stop-evidence.ts` and `scripts/inbox-triage.ts` read the same state
file and printed numbers any reader would take as contradictory:

    stop-evidence   no received decision waiting to be consumed -- 11 received decisions.
    inbox-triage    11  NOT_ACTIONABLE  (STANDING_UNVERIFIABLE / STALE_REFRESH_REQUIRED)

Neither was wrong. They answered different questions — "how many rows has nobody judged" and "how
many of those can be acted on" — and nothing said so. That is the same two-halves-with-no-joining-
rule shape review has caught on this branch five times, found this time by joining two things
already built.

The repair is the one that has worked every time: ONE rule shared by both sides, not a second check
bolted onto the side that lacked it. `gatherStopEvidence` now counts through `triageInbox` rather
than by counting `RECEIVED_UNVALIDATED` statuses, so a row that has been triaged and come back
`NOT_ACTIONABLE` is not reported as a decision waiting — it has been looked at and cannot be
consumed; leaving it unfiled is transport hygiene. Both numbers are reported, in a new `notes`
channel, because supplying one and staying silent about the other is how the contradiction arose.

    0 received decisions
    11 unjudged inbox row(s), of which 0 are actionable (11 NOT_ACTIONABLE)

That condition now reads `yes` for the first time. `MAY STOP` stays `false`: the watcher is STOPPED,
five queue items are startable, and six inputs remain deliberately ungathered. A control asserts
that the two gathered fields at their most permissive still cannot produce a stop, so the change
cannot cause a premature one.

The cross-module assertion is a test, not a comment — the two counts must be equal on a fixture
that deliberately produces both kinds. Six mutations, 6/6 ISOLATED.

### IR-114 fourth addendum — a composed escalation is not a sent one

`[CHATGPT_VERIFIED][MARKET-INBOX-TRIAGE-OPEN-ID-20260901]` `REWORK_REQUIRED`, and the finding is
sharp: the positive OPEN proof was still too weak. An outbox row is written locally.
`OutboxEntry.transmittedCommentId` is the canonical marker that the comment exists remotely, and its
own doc comment says it is "set once a read-back proves the comment exists remotely. Never set on a
successful POST." The authority accepted any `ESCALATION` row regardless.

Reproduced against the committed implementation at `fee0ad1` before repairing, with an escalation
that was composed and never read back:

    standing    OPEN
    disposition RUNNABLE

`CLAUDE.md` states this invariant in as many words — `REMOTE_POST_NOT_CONFIRMED =>
CHATGPT_NOT_YET_NOTIFIED`, only read-back proves transmission — and the authority built to enforce
openness ignored it. Three of my own tests had codified the unsound rule, exactly as the review
said; they were fixtures asserting that an untransmitted escalation opens an id.

`OPEN` now requires a `transmittedCommentId` that is a positive integer. `state.ts`'s `health()`
tests only `=== undefined`; this is the same rule and stronger, because a malformed id is not
read-back evidence either — `0`, `-1`, `1.5`, `"5495740285"`, `null`, `true`, `{}` and `NaN` are all
enumerated in a control.

**Closure stays asymmetric, deliberately.** A `CLAUDE_APPLIED` closes an id whether or not it was
read back, because closing fails CLOSED — the consequence is `NOT_ACTIONABLE`. Requiring read-back
to OPEN and not to CLOSE is the same rule applied to both: never let unproven evidence make
something actionable.

`gatherStopEvidence` consumes the corrected standing for free, since it already counts through the
triage; a control asserts a queued-only row is not counted, and that adding the read-back id alone
moves the count from 0 to 1.

Eleven mutations, 11/11 ISOLATED. `tests/stopEvidence.test.ts` is no longer this suite's
"unrelated" comparison suite — four mutants downgraded to CAUGHT-BUT-BROAD because it now genuinely
depends on the mutated module, which is the coupling the third addendum introduced on purpose. A
suite that depends on the mutated module cannot answer whether the mutation broke something it
should not have.

## IR-115 — the open-id authority asks for evidence nothing in this repository produces

Status: `VERIFIED_WITH_LIMITATION` (2026-09-02). Found by reading my own repair, not by review.

The read-back correction (IR-114, fourth addendum) is right: `OPEN` requires
`OutboxEntry.transmittedCommentId`, which is set only after a read-back proves the comment exists
remotely. Then the obvious next question, which I only asked afterwards — **who writes it?**

    appendOutbox            defined in store.ts, called by NOTHING in src, scripts or tests
    transmittedCommentId    written by NOTHING outside test fixtures

So `controlBusStanding` cannot return `OPEN` in production, however issue #2 actually behaves. The
branch is unreachable, the suite over it is green, and I introduced it while fixing a review
finding. That is the `servesLocalBuild` shape a third time on this branch, and the second time this
session that a predicate was structurally unable to vary — the first being `evaluateStopSentinel`,
which is what IR-114 exists to fix.

There is a second, related split. `ControlBusState.outbox` is an ARRAY inside `state.json`, which is
what `health()` and this authority read; `appendOutbox` appends to a separate `outbox.jsonl` FILE.
The only writer function writes a record neither reader consults.

### What was done, and what deliberately was not

The disclosure is now in the output rather than in a comment. An empty outbox is ambiguous — either
nothing was ever posted, or nothing records what is posted — and on this repository it is the
second, so `source()` says:

    control-bus state: 8 judged id(s), 0 escalation(s) read back from the remote issue,
    0 composed but never confirmed — and no production code writes that record (IR-115), so an
    empty outbox is silence rather than evidence

Two controls pin that this stays true and, more importantly, **fail the day it stops being true**:
one asserts no production caller of `appendOutbox`, one asserts no production writer of
`transmittedCommentId`, and both name IR-115 in their failure message. They do not lock the gap in
place; they make closing it impossible to do silently. Both refuse to pass on an empty file scan.

The repair itself — recording each outbound post, with read-back, into the durable outbox — is NOT
done here. It writes `state.json`, which is the crash-safety-critical path `commitCycle` owns and
orders deliberately, and doing that outside the watcher's cycle would race a running watcher. It is
a transport change and deserves its own unit; this session posts through `gh` by hand and reads back
by hand, which satisfies the invariant without satisfying the record.

Twelve mutations, 12/12 ISOLATED.

### IR-115 closed — the producer now exists, and it is the only one

`[CHATGPT_VERIFIED][MARKET-INBOX-TRIAGE-OPEN-ID-20260901]` `REWORK_REQUIRED` asked for the repair
rather than the disclosure. Done in `src/server/controlbus/outbound.ts`, plus the schema and the
shared predicate in `state.ts`.

**One canonical record.** `state.outbox` is the authority — it is what `health()` and the triage
read. `outbox.jsonl` is an append-only advisory log, renamed `appendOutboxLog` so the role cannot be
misread, and it has exactly one caller. Both are written by one function, log first and state
second, mirroring `commitCycle`: never let the authority get ahead of the record.

**One predicate.** `isTransmitted(entry, {repository, issueNumber})` binds repository, issue, a
positive-integer comment id, and a body digest recomputed from the entry's own body on every read.
A proof cannot be carried to different content, a different issue, or another repository. `health()`
and `controlBusStanding` both call it; there is no second copy to be the weaker one.

**The order is the argument.**

    compose -> (adopt | post) -> read back -> verify -> commit log -> commit state

Crash windows, each answered rather than hoped about: after compose, nothing durable; after POST,
nothing durable and a comment now exists remotely, so replay calls `find` FIRST and ADOPTS it rather
than posting twice; after read-back before commit, the same; after log before state, the authority
reads as not-yet-open; after commit, a repeat short-circuits on `ALREADY_PROVEN`. Without adoption
the only crash-safe choices are a duplicate comment or a lost proof.

**Serialisation.** The watcher owns `state.json`. Rather than invent a second lock protocol this
REFUSES while a live watcher holds the existing lock, and writes nothing at all when it does.

The three tests that had codified the weaker rule went red first, as they were built to. So did the
IR-115 disclosure controls — they were written to fail the day a producer appeared, and that is
exactly when they failed. They now pin the other side: exactly ONE caller of the log, exactly ONE
writer of a proof, and no trace of the bare-comment-id marker they replaced.

Three mutation suites, all ISOLATED: outbound 7/7, inbox-triage 14/14, stop-evidence 6/6. Two
outbound cardinalities were higher than predicted (3 not 2, 2 not 1) because the happy path asserts
EXACT transport call counts — counting the calls caught more than checking the outcome.

The harness REFUSED to run three triage mutants whose anchors had drifted, which is the harness
working. They were realigned, not loosened; two were retired with reasons — the helper one mutated
no longer exists, and the disclosure one protected a sentence that had become false.

Not done: nothing was posted through this path yet. The live outbox is still empty, so the eleven
backlog entries remain `NOT_ACTIONABLE (STANDING_UNVERIFIABLE / STALE_REFRESH_REQUIRED)`. The
difference is that an empty outbox now means nothing has been transmitted, rather than that nothing
could be.

### IR-115 reached, not merely reachable — the lifecycle has now run

The producer landed with test callers only, which is the same shape one level out: a producer
nothing invokes leaves `OPEN` exactly as unreachable as no producer at all. `scripts/gh-transport.ts`
and `scripts/post-outbound.ts` close it, and a control asserts the lifecycle has a production caller
so the gap cannot silently reopen.

**The one design decision.** `readBack` derives the repository and issue number FROM THE API
RESPONSE, never from the arguments the transport was constructed with. Echoing them would make every
binding clause in `isTransmitted` vacuous — the proof would say "this came from the repository we
asked about" because we told it so. `M-GH-ECHO-COORDINATES` exists for exactly that.

`find` matches by DIGEST, not by protocol tag: this channel carries many comments per id, one per
rework round, so tag matching would adopt the wrong comment and record a proof describing a body
that was never sent. It paginates, and it throws rather than answering `null` when it cannot tell —
a false negative there posts a duplicate.

**Measured, not assumed: GitHub round-trips a comment body byte for byte.** 8135 bytes in, 8135
out, identical digests, no CRLF translation, no trimmed tail. The whole binding rests on it, and the
unit tests could not have caught it being false because their transport echoes what it was given.

**It ran.** Against the live issue, `post-outbound.ts` found comment `5497449824` — the report
posted by hand earlier this session — matched it by digest, and ADOPTED it rather than posting
again. The durable outbox has its first real entry, `isTransmitted` accepts it, and the judged count
in the triage's authority moved 8 to 9. That is the difference between reachable and reached.

Nothing was posted: adoption sends nothing. Five mutations, 5/5 ISOLATED, every cardinality as
predicted (2, 1, 3, 2, 1).

One control caught a bug in its own scan: `endsWith("outbound.ts")` excluded `post-outbound.ts`, the
very caller it was looking for, so it reported the gap still open. The suffix now names the whole
path.

## IR-116 — a snapshot is not a serialisation primitive

Status: `VERIFIED` (2026-09-02). Found by review
(`MARKET-IR115-OUTBOUND-SERIALIZATION-TOCTOU-20260902`), reproduced by reading the code.

`outbound.ts` checked the watcher lock ONCE, went away for `find`/`post`/`readBack`, and then wrote
the state object captured before it left. Two defects in one gap, and `store.ts` says so in its own
header: atomic rename gives content atomicity, never writer exclusion.

    TOCTOU           a watcher can acquire ownership after the check and before the commit
    stale overwrite  whatever that watcher advanced meanwhile is silently regressed

Ownership was also `pid`-only. The store already treats the NONCE as the sufficient identity — a
same-pid different-nonce record is a different lease — so pid equality was a shortcut past the
contract the lock rewrite exists to enforce.

### The repair

`withCanonicalWriteAuthority` in `store.ts`, exposing the existing `withMutation` right rather than
inventing a second lock. Three checks: refuse a live foreign lease before taking the right; win the
`wx` mutation token; re-read ownership inside it. `body` runs only when all three pass, and outbound
RELOADS `state.json` inside `body` and appends to THAT, never to the captured object.

A stale foreign lock does not block — refusing on one would let a leftover file deadlock every
future write, which is caution that costs more than the race.

### Two defects the new controls found in the repair itself

Idempotency read the captured state, which after the reload change is a photograph that never
receives the entry, so a second call re-posted. It now reads disk, and the commit-time reconcile
reports when it found an existing proof. And the ownership re-check refused on ANY foreign lock
including a stale one — the deadlock above, introduced and removed in the same unit.

### The mutant that came back MISSED

`M-AUTH-NO-RECHECK` predicted 2 red and measured 0. The prediction was wrong about which check did
the work: the pre-flight inside the authority runs AFTER the caller's round trip, so it already
refuses everything the interleaving fixtures can arrange. The window the re-check guards is between
that read and winning the token — microseconds, no await, unopenable from outside.

An unreachable safety branch with a green suite over it is this project's recurring shape, so the
store grew a seam that fires exactly there. The branch is now exercised for the reason it exists,
and the mutant is ISOLATED at 1.

Interleaving controls, each mutating the store from inside the fake `readBack` — the moment a real
network call would be outstanding: ownership taken during the await; a different lease with the same
pid; our own lease reappearing (so refusal is not unconditional); state advanced A to B with the
cursor and an inbound decision preserved; and a refused commit followed by a retry that ADOPTS the
existing comment rather than posting a second one. Outbound mutations 10/10 ISOLATED.

## IR-117 — the escalation recorded as "staged, not posted" was never staged

Status: `VERIFIED` (2026-09-02). Found while looking for the packet in order to cite it.

The operating rules then in force said ESC-014 "is staged as `[ESCALATION][ESC-014]` in
`docs/escalation/PENDING_COMMENTS.md` and — as of 2026-08-23 — **not posted**, so it is not merely
unanswered, it has not been asked." The second half was true and the first was not.
`PENDING_COMMENTS.md` holds TEST-001, TEST-002, ESC-009 and ESC-012 and has never held an ESC-014
packet. I cited "the open ESC-014 question" three times this session as the reason not to treat a
`CHATGPT_ARCHITECT_GUIDANCE` comment as authorisation — deferring to a question that did not exist
in any form.

It is now asked. Drafted, screened, posted through `scripts/post-outbound.ts`, read back and
committed: Issue #2 comment `5498131832`, digest `bdc5b87f7598005c`. `controlBusStanding` reports
`ESC-014 standing: OPEN` — the first real `OPEN` this machinery has ever produced, and the last
unexercised branch of the IR-114/115 chain, reached by the production path rather than a fixture.

### The rules' inventory of the channel is also wrong, and now measured

`scripts/channel-kinds.ts` (read-only) tallies leading protocol tags. Against the live issue:

    INBOUND  9 kinds   48 CHATGPT_VERIFIED (dropped), 40 CHATGPT_DECISION (parsed),
                       23 CHATGPT_ARCHITECT_GUIDANCE, 20 CHATGPT_TASK, 9 CHATGPT_GUIDANCE,
                       2 CHATGPT_CORRECTION, 1 each REVIEW_GUIDANCE / REVIEW_POLICY /
                       TRANSPORT_STATUS — all dropped
    OUTBOUND 5 kinds   50 CLAUDE_APPLIED (parsed), 17 CLAUDE_PROGRESS, 10 ESCALATION (parsed),
                       3 CLAUDE_RECEIVED, 3 CLAUDE_STATUS
    ProtocolKind admits 3 of 14.

The rules name FIVE inbound kinds. There are nine. The four omitted include `CHATGPT_TASK` at
twenty comments, larger than two of the kinds that are named, and the single largest inbound kind —
`CHATGPT_VERIFIED`, 48 comments, every review this session — was dropped by the parser at
the time of this measurement. ESC-014 has since widened durable ingestion to all nine; the
counts above are the state that motivated the escalation, not the state after it.

The counts are deliberately not pinned in a test. They are a fact about a live issue and belong in a
run; what the controls bind is the COUNTING RULE, including that a tag must LEAD a body — matching
one anywhere would count every report that quotes a tag in prose, and this session's reports quote
several each.

### A finding about the rules themselves, left for their owner

The `CLAUDE.md` carrying both claims is **an uncommitted edit in the main worktree** (201 lines).
This branch's committed copy is 169 lines and contains none of that text — no ESC-014 paragraph, no
kind inventory, no `ProtocolKind` sentence. So the operating rules this session has followed are a
local edit another checkout has never seen.

Both corrections belong in that file and it was NOT touched: it is a dirty foreign worktree, which
the standing review constraints put out of bounds. Recorded here instead, with the measurement
reproducible by one command.

### IR-117 addendum — the screen belonged to one caller, not to the operation

`CLAUDE.md`: "Everything outbound passes `screenPublicComment` first; issue #2 is publicly
readable." It did — in `scripts/post-outbound.ts`. `transmitAndCommit`, the only path that actually
posts, never screened at all. So the guarantee was a property of the CLI rather than of the
operation, and a second caller, or a refactor of the first, would have published unscreened with
nothing to notice.

Same one-sided invariant this branch keeps finding, this time in a module written two units earlier
and found by asking the question of my own code rather than by review.

The screen now runs inside the lifecycle, BEFORE the transport is touched at all — before `find` as
well as before `post`, because an unscreened body should not reach the network even to be compared
with comments already on the issue. The CLI keeps its check as a fast-fail, with a comment saying
plainly that it is not the guarantee: the same shape the lock pre-flight settled into after IR-116.

Three controls: a rejected body refuses with `{find:0, post:0, readBack:0}` and writes nothing; the
refusal names the category and the line, so the finding is actionable without a search; and a clean
body still commits, so the refusal is not unconditional. `M-OUT-NO-SCREEN` is ISOLATED at 2, as
predicted, with the clean-body control staying green under it. Outbound mutations now 11/11.

The fixture secrets are shaped to match the rules and are not real.

## ESC-014 applied — nine kinds durable, one authoritative

`[CHATGPT_DECISION][ESC-014]` (comment 5498131832 asked; the decision answered it) chose **Option
B**: widen durable ingestion to the nine measured inbound kinds, leave application authority at
`CHATGPT_DECISION` alone. This is the first decision this session that arrived through the one kind
the protocol treats as authoritative, so it is applied as authority rather than on its merits.

### One kind model, one classifier, one discriminator

`transport.ts` now declares `AUTHORITATIVE_KINDS` (one entry), `ADVISORY_INBOUND_KINDS` (eight) and
`OUTBOUND_KINDS` (two). The tag pattern is BUILT from those lists, so a kind cannot be recognised in
one place and unknown in another — the parser regex previously hard-coded three names beside a type
that also listed three, which is two sources for one fact.

`isAuthorityBearing(kind)` is the single classifier every execution-facing caller asks. It takes a
`string` deliberately: a kind arriving from durable state or a future tag must reach a definite
`false` rather than a type error, which is what failing closed means here.

`InboxEntry.kind` records what arrived. Without it, widening ingestion would have made every review
comment on the channel — 48 `CHATGPT_VERIFIED` at the time of the decision — something
`unprocessedDecisions()` could schedule, which is exactly what the decision forbids.

### Two things that are not defaults

`entryKind()` reads an absent `kind` as `CHATGPT_DECISION`. That is recoverable from the code that
wrote those rows rather than chosen for convenience: the previous ingestion admitted nothing else —
every other kind hit an early `continue`. So widening ingestion does not retroactively rewrite what
historical traffic meant.

Advisory kinds are NOT deduplicated by protocol id. One exchange legitimately carries many reviews,
one per rework round, and collapsing them to the first would discard the history this channel is
mostly made of. Only an authority-bearing kind is admitted once per id.

### Unknown kinds fail closed and stay visible

A comment opening with a tag the parser does not know is reported in `skipped` with its kind named.
Failing closed is required; failing closed INVISIBLY is what the decision forbids, because a
protocol that has not caught up should be legible. Ordinary prose still says nothing at all.

### Evidence

Thirteen controls holding body, author, project and id constant and varying ONLY the tag: all nine
parse with exact identity; all nine ingest durably; exactly one is startable; `CHATGPT_VERIFIED`
stays non-startable whether it says APPROVED or REWORK_REQUIRED; advisory kinds do not dedup;
decisions still do; outbound is never admitted; an unknown kind is reported and never admitted;
prose is silent; redelivery admits nothing twice.

Mutations 5/5 ISOLATED. `M-KIND-VERIFIED-AUTHORITATIVE` and `M-KIND-ANY-CHATGPT` came in at 6 red
against a prediction of 3 and 4 — promoting a kind also moves it onto the deduplicated path, so more
controls see it. Corrected to what was measured. `M-KIND-DROP-ADVISORY` restores the pre-ESC-014
behaviour and is caught, so the controls reject going backwards as firmly as going too far forward.

### ESC-014 addendum — the status boundary leaked what the scheduling boundary held

`[CHATGPT_DECISION][MKT-ESC014-STAT-260902-0348]`, carrying the finding from verifier comment 5498756304. Applied as authority; the verifier itself is durable evidence and authorises nothing,
which is the protocol ESC-014 just established working as intended.

ESC-014 deliberately stopped deduplicating advisory rows by protocol id. `resolveInboxEntry` still
matched on `entry.protocolId === protocolId`. Harmless while the inbox held one row per exchange,
and a corruption the moment it did not: resolving a decision stamped every `CHATGPT_VERIFIED` and
guidance comment on the same exchange `APPLIED` beside it. `unprocessedDecisions` correctly refused
to schedule them, so the invariant held at the SCHEDULING boundary and leaked at the STATUS
boundary — one side enforced, one side not, arriving this time as a consequence of my own change.

Two conditions now, and each has a mutant because either alone looks sufficient against a fixture
that does not attack the other:

    EXACT ROW   `githubCommentId` as well as `protocolId`. GitHub never reuses a comment id, so the
                reference names one row and cannot fan out.
    AUTHORITY   the row must be authority-bearing. An advisory row cannot be stamped even when
                addressed directly and by exact identity.

A miss now returns a REASON rather than an unchanged state that reads like success — a transition
that hit nothing is the quiet nothing this repository has paid for before. The signature changed to
`ResolveOutcome`; both callers were updated.

Seven controls, every one built on an exchange that actually contains the aliasing — one decision
and two advisory rows sharing an id — so nothing passes by avoiding the hazard. The decision moves
through VALIDATED and APPLIED and neither review moves; a rejection is isolated identically; an
advisory row named exactly is refused with its kind in the message; a comment id under the wrong
protocol id is refused.

Mutations 3/3 ISOLATED. `M-ROW-ID-FANOUT` came in at 2 against a prediction of 3: the
wrong-protocol-id control was wrongly counted, because under id-only matching `ESC-OTHER` still
finds no row and refuses for the same reason as before. Corrected to what was measured.

## IR-075 — the fix it named is disproven, and the residual stands

Status: `VERIFIED_WITH_LIMITATION` (2026-09-02). Two verifiers said IR-075 was outside their bounded
scope and must not be silently promoted to closed. It is not closed. What changed is that the
sentence describing how it WOULD be closed turned out to be false.

`store.ts` recorded: "hold the lock file OPEN for the process lifetime. On Windows an open handle
cannot be deleted or renamed by another process, so exclusion is enforced by the OS rather than
inferred from timestamps." That is an assertion about the platform living in a comment, and the next
attempt at IR-075 would have built a lock rewrite on top of it.

`scripts/probe-open-handle-exclusion.ts` measures it. With the handle held open (`openSync(path,
"r+")`), from a SEPARATE process — same-process attempts prove nothing, the handle table is shared:

    unlink                 SUCCEEDED
    exclusive create (wx)  SUCCEEDED, at the same path, immediately after

The second is the sharper half: even the `wx` primitive this store's whole mutual exclusion rests on
remains available to a competitor while the handle is held, so holding it buys nothing at all.

The Win32 behaviour the claim appeals to depends on the SHARE MODE a handle is opened with, and
`fs.openSync` gives no way to choose one — libuv permits delete sharing. So the property is not
reachable through the API any implementation here would use. The claim was not wrong about Windows;
it was wrong about Node, which is the only thing that mattered.

**No replacement is named, deliberately.** A real OS mutex or an advisory-locking library would each
be a new dependency and a cost decision, and naming an unmeasured second candidate is exactly how
the first one got here. The next attempt starts by MEASURING a primitive rather than quoting one.

Three controls assert the measured behaviour, including a vacuity guard that the probe attempted all
three operations. They are written so that a future runtime which DOES block the delete fails
them — and the failure message says to re-read IR-075 first, because that would be good news rather
than a regression.

The residual itself is unchanged: reaching it still needs two watchers racing and one suspended past
its lease mid-operation, and `control-bus:start` refuses while a live lock exists.

## IR-118 — the formatting gate I never ran, and the local one I could not read

Status: `VERIFIED` (2026-09-02). Remote CI run `33547628222`, bound to `bb88ded` on
`claude/post-rc-followup`, FAILED at `npm run format:check` before lint, typecheck, tests or build
had a chance to run. Reported by `[CHATGPT_ARCHITECT_GUIDANCE][MARKET-ESC014-CI-FORMAT-20260902]`,
which under ESC-014 is durable evidence and authorises nothing — and fixing my own broken gate needs
no authority beyond the failure being real.

**Two causes, and both are the session's recurring shape in my own workflow.**

Every unit ran `prettier --write` over THE FILES IT TOUCHED. That is not the gate; the gate is the
repository. A file can be left unformatted by a later edit the per-file pass has already gone past,
which is exactly what happened: a patch script was accidentally re-run twice AFTER its formatting
pass, each time re-wrapping a `.filter(...)` that Prettier wants on one line. I checked the thing I
changed, not the thing CI checks.

And running the real gate locally does not help, because it drowns. This checkout has CRLF endings
and the config wants LF, so `npm run format:check` lists SIXTY-SEVEN files while CI lists ONE. A
signal buried in sixty-six false positives is not a signal.

### The measurement that settles it

Git is the normaliser: it stores LF and converts on checkout, so what git reports as changed after a
repository-wide `prettier --write` is exactly what CI objects to. Run against the failing tree it
reported ONE file — `tests/inboxTriage.test.ts`, 1 insertion / 4 deletions — and so did CI.

Confirmed against the exact bytes rather than the working copy:

    git show HEAD:tests/inboxTriage.test.ts | prettier --check --stdin-filepath ...   -> (stdin)
    working tree after the fix                                                        -> clean

`scripts/format-gate.ts` is that measurement as a command, so the next unit can ask the question CI
asks. Its first version died invoking `npx` — a `.cmd` shim on Windows that cannot be exec'd
directly — which is recorded in the file because it is the same class of local-environment trap.

### What is NOT closed

The fix is committed but **no fresh workflow run is bound to the new SHA**, so the format gate is
not green, only locally clean. CI reaches this work through `claude/post-rc-followup`, which someone
advanced to `bb88ded`; advancing it again is the fast-forward this session's permission classifier
denies. Closure requires a run bound to the new head, and a local green suite does not supersede
`33547628222`.

Also noted rather than fixed: the guidance asks for a `[CLAUDE_PROGRESS]` note while CI is pending,
and `CLAUDE_PROGRESS` is not in `OUTBOUND_KINDS`, so the durable outbound path cannot express
"in progress". The channel has carried 17 of them historically. Widening the outbound list is a
protocol change no decision authorises, so it is recorded here instead of taken.

### IR-118 addendum — the checker was rewriting the thing it measured

`[CHATGPT_ARCHITECT_GUIDANCE][MARKET-IR118-NONDESTRUCTIVE-FORMAT-GATE-20260902]`, durable evidence
rather than authority; fixing a tool of mine that can mutate a user's uncommitted work needs none.

The finding is exact. `format-gate.ts` measured by running `prettier --write .` against the LIVE
working tree and asking git what changed. It snapshotted only the NAMES of already-dirty files and
then excluded those names from both the report and the restore — so a pre-existing dirty file could
be reformatted by the diagnostic and never mentioned. A command advertised as a check could silently
rewrite foreign work. A verifier manufacturing its own evidence by editing the object it measures is
the failure this file exists to catch, committed while writing the catcher.

**The repair is not "restore afterwards".** That still writes, and still loses on the throwing path.
The gate now reads COMMITTED BYTES out of git and hands them to Prettier's API in memory. There is
no writing path at all, which is why the exception case needs no special handling.

Reading git is also what removes the CRLF noise: git stores LF and converts on checkout, so the
bytes measured are the bytes CI receives — one file, not sixty-seven.

Eight controls hash the entire repository (file contents, index entries with blob hashes, and
porcelain status) before and after: a committed offender beside a committed clean control; a dirty
file Prettier would rewrite; a staged modification; an untracked file; a CRLF working copy over
committed LF; the throwing path; and a vacuity control that the gate finds the offender at all,
without which every other assertion is about something that did not happen.

Mutations 3/3 ISOLATED, and the destructive one taught me something. `M-FMT-WRITE-TREE` was
predicted at 4 and MEASURED 1: it writes only where the COMMITTED bytes are an offender, and every
preservation fixture committed well-formatted content and dirtied it afterwards, so a writing gate
had nothing to reach for. That left the original bug's exact scenario — dirty work on top of a file
that is ALSO a committed offender — unexercised. A control for it was added and the mutant went to 2. The prediction being wrong is what exposed the gap.

The untracked control stays green under that mutant, and it is recorded rather than patched: an
untracked file is not in `git ls-files`, so the guarantee there comes from never enumerating it.

Still NOT closed: no workflow run is bound to the corrected SHA. CI reaches this work only through
`claude/post-rc-followup`, and advancing it is the fast-forward this session's classifier denies.
`33547628222` is not reused as green.

Also still open: the guidance asks for a `[CLAUDE_PROGRESS]` note while CI is pending, and
`CLAUDE_PROGRESS` is not in `OUTBOUND_KINDS`, so the durable outbound path cannot express it. The
channel has carried 17. That is the same parser-narrower-than-the-channel shape ESC-014 fixed for
inbound, unfixed for outbound, and no decision authorises widening it.

## IR-119 — the gate called an evaluator error "clean"

Status: `VERIFIED` (2026-09-02). Reported by
`[CHATGPT_ARCHITECT_GUIDANCE][MARKET-IR119-FAIL-CLOSED-PRETTIER-PARSE-20260902]` — durable evidence,
not authority; fixing a verifier of mine that reports PASS on UNKNOWN needs none.

The IR-118 rewrite read committed bytes and never wrote, which was right. It also carried:

    try { formatted = await check(source, ...) } catch { continue; }

with a comment arguing that a file Prettier cannot parse is a different problem. That is fail-OPEN.
The canonical gate is `prettier --check .`, which exits non-zero when it cannot EVALUATE a file, so
a throw here let the diagnostic report clean about a tree CI rejects. "Not a formatting offence" is
not "verified clean", and this repository's own rules say a verification that could not be run is
never recorded as passing — written into a verifier, by me, in the file whose whole purpose is to
stop a gate lying.

Findings are now typed. `MISFORMATTED` and `EVALUATION_ERROR` are both findings, and any finding
exits non-zero. `resolveConfig` and `getFileInfo` are deliberately left OUTSIDE the try: a config or
plugin resolution failure is not a property of one file's content, and letting it propagate reaches
the same non-zero outcome by the shortest honest route.

### The controls compare against the canonical gate rather than about themselves

Each new fixture runs `prettier --check .` in the same temp repository and asserts its exit code
alongside the diagnostic's answer, so a disagreement between the two is what fails — not an
assertion about this gate in isolation. Clean source: canonical 0, gate empty. Misformatted:
canonical 1, gate `MISFORMATTED`. Unparsable TS and unparsable JSON: canonical 1, gate
`EVALUATION_ERROR` rather than omitted. A tree with both kinds keeps them distinct, without which
mapping every finding to one kind would satisfy the rest.

Thirteen controls now, with the eight IR-118 preservation and vacuity controls unchanged and still
hashing the whole repository — contents, index blobs, porcelain status — before and after.

Mutations 4/4 ISOLATED. `M-FMT-FAIL-OPEN` restores the `catch { continue; }` and goes red on all
three evaluation-error controls, as predicted. `M-FMT-NO-OFFENDERS` came in at 5 against a predicted
4, the both-kinds control firing as well.

Both gates now agree locally: `npm run format:check` reports all files clean, and so does
`scripts/format-gate.ts`. The canonical one became readable here only because a repo-wide
`prettier --write` two units ago normalised this checkout's line endings on disk; that is a property
of the working copy, not a repair, and the gate still reads git so it does not depend on it.

Still NOT closed: no workflow run is bound to the corrected SHA. CI reaches this branch only through
`claude/post-rc-followup`, whose fast-forward this session's classifier denies. `33547628222` is not
reused as green.

## IR-120 — non-destructive and still answering the wrong question

Status: `VERIFIED` (2026-09-02). Reported by
`[CHATGPT_ARCHITECT_GUIDANCE][MARKET-IR120-EXACT-REV-FORMAT-AUTHORITY-20260902]` — durable evidence,
not authority; correcting a diagnostic of mine that names a revision and answers about something
else needs none.

Only the BYTES came from the revision. The file set came from `git ls-files` (the live INDEX), and
the ignore rules and Prettier options came from the live checkout. So the answer was
`f(committed bytes, live configuration)`, and three ordinary situations make those disagree with CI:
a staged deletion removes a committed offender from the file set; an uncommitted `.prettierignore`
hides one; an uncommitted `.prettierrc*` judges committed bytes by rules the revision never had.

Non-destructive and still wrong — it never wrote anything, and it answered about something other
than the revision it named. That is a fourth distinct defect in one small file, each found only
after the previous repair.

### The revision is materialised, and Prettier resolves inside it

`git archive` into a temp directory; enumeration, `.prettierignore`, `.prettierrc*` and
`package.json` are then the revision's own because they are the only ones present. Copying the live
config into a scratch tree would have been the same defect wearing a disguise, and is explicitly not
what happens.

`git ls-tree` remains the authority on what the revision contains, cross-checked against what the
archive produced: a path present in the tree and absent from the archive is reported as
`MATERIALIZATION_INCOMPLETE`, not skipped. `.gitattributes export-ignore` is how that arises, and a
silently shorter file list is how a gate stops meaning anything.

Config or plugin authority that cannot be resolved is `CONFIG_ERROR` — a revision whose config names
a plugin the materialised tree has no `node_modules` for lands there, which is the honest answer
rather than assuming the live checkout's plugins apply.

### Measured, and it caught defect (1) reappearing inside the fourth repair

`git archive` applies the same conversions a checkout would. On this machine that produced a CRLF
tree and the gate reported **423 offenders where CI reports none** — the original line-ending defect,
back again, inside the fix for a different one. `-c core.autocrlf=false` is therefore load-bearing
and has its own control and its own mutant. A checkout convention is not part of a revision's bytes.

### Evidence

Twenty-two controls. Eight new ones vary only the live checkout while the revision stays fixed:
staged deletion; uncommitted and staged `.prettierignore`; uncommitted `.prettierrc*`; untracked
config-looking files; `rev != HEAD` binding across two commits; the IR-118 preservation proof
re-run against the materialising implementation rather than assumed to carry over; and an
ignore rule the revision DOES contain, without which "ignore files never apply" would satisfy the
rest.

Mutations 8/8 ISOLATED. Three reintroduce a live-authority path — `git ls-files`, the live ignore
file, the live config — and each is caught. `M-FMT-LIVE-IGNORE` came in at 2 against a predicted 3,
and the reason is kept rather than smoothed over: in the committed-ignore fixture the revision's
file and the on-disk file are the same, so live and revision authority agree and the mutant is
invisible there. Only a DIVERGENCE between them can catch it.

`M-FMT-NO-OFFENDERS` rose from 5 to 10 simply because eight more controls now name an offender.

Still NOT closed: no workflow run is bound to the corrected SHA, and CI reaches this branch only
through `claude/post-rc-followup`, whose fast-forward this session's classifier denies.
`33547628222` is not reused as green.

### IR-120 addendum — the Codex pass, and a repair that made the gate smaller

`[CHATGPT_DECISION][MARKET-IR120-EXACT-REV-FORMAT-AUTHORITY-20260902]` is authority-bearing and
asked for a read-only Codex architecture pass first, formatter identity bound to the revision, and
staged-rename discrimination.

**The Codex pass took two attempts, and the first one is worth recording.** Given an open-ended
prompt it read `docs/CODEX_REVIEW_PACKET.md` and answered about a months-old release review instead
— exit 0, confident, and about the wrong thing. No verdict was recorded from it. Re-run with the
file inlined and exploration forbidden, it returned `VERDICT: REFRAME` with three specific gaps:

    formatter identity is not bound          — the decision's own §2, independently reached
    git archive may transform blobs          — `export-subst` expands $Format:...$ placeholders
    materialised symlinks can escape         — resolving back into the active filesystem

All three reproduced. All three are fixed.

**And the repair made the gate smaller rather than larger.** Measured, not assumed: Prettier's
`resolveConfig` and `getFileInfo` do NOT require the file to exist — they walk directories for
config and match ignore patterns against the path string. So the whole revision never needed
materialising. Only its config-bearing files are written to a scratch tree; content comes from
`git show`, enumeration from `git ls-tree` with modes. `git archive` and `tar` are gone, and with
them the export-subst transformation, the line-ending conversion, and a crash on any repository
containing a symlink.

**Formatter identity** comes from the revision's `package-lock.json`, falling back to the manifest
range — and a RANGE is not an identity, so `^3.9.6` is accepted only when the running version
matches the floor exactly. Anything less certain is `TOOL_IDENTITY`, reported once, before any file
is judged.

**Symlinks are identified by git mode `120000`, not `lstat`.** The first guard asked the filesystem
and its mutant came back MISSED: `git archive` writes a symlink as an ordinary file on Windows, so
the filesystem answers "not a link". Its control had also been allowed to skip itself when the
fixture failed to produce a symlink — the vacuity this suite exists to refuse — and both are fixed.

Twenty-nine controls. Mutations 9/9 ISOLATED, with `M-FMT-ARCHIVE-BYTES` and
`M-FMT-ARCHIVE-CONVERTS` retired for stated reasons rather than deleted: the code they mutated no
longer exists, and the second had already come back MISSED once content moved to the blob.

`REMOTE_CI: NONE` for this work. CI reaches this branch only through `claude/post-rc-followup`,
whose fast-forward this session's classifier denies, and `33547628222` is never inherited as green.

### IR-120 second addendum — TypeScript config, and why the list was the defect

`[CHATGPT_DECISION][MARKET-IR120-TS-CONFIG-AUTHORITY-20260902-1612]`, carrying the finding from
verifier `5505843803`. Authority-bearing, applied as authority.

`CONFIG_BASENAMES` was hand-written. It carried `.prettierrc.js|cjs|mjs|json|json5|yaml|yml|toml`
and `prettier.config.js|cjs|mjs`, and **none of the six TypeScript forms** — `.prettierrc.ts|mts|cts`
and `prettier.config.ts|mts|cts`, supported since Prettier 3.5, and this repository pins 3.9.6. A
revision carrying one lost its formatting authority in the scratch tree and was judged under
defaults. Silently, which is the part that matters.

**Adding six strings would have left the same kind of list, one entry longer.** The decision said so
and it was right. The names now come out of the pinned package itself: `pinnedConfigBasenames()`
resolves the ESM entry the package DECLARES — `exports["."].default`, because
`require.resolve("prettier")` hands back `index.cjs`, which does not carry the list, measured after
the first attempt failed closed on exactly that — and extracts its `CONFIG_FILES` array.

That extraction turned up `package.yaml`, which the hand-written list had ALSO missed and nobody had
noticed. One omission was reported; the other came out of deriving instead of transcribing.

It fails closed: if the bundle shape changes, or the recovered list lacks the anchors every version
has (`package.json`, `.prettierrc`), the gate returns `CONFIG_ERROR` rather than a guess that would
omit exactly the forms nobody remembered. `.prettierignore` and `.editorconfig` are named
separately, and they are the only two names left in the module.

**Measured, not assumed:** the TS configs actually load here. A committed `prettier.config.ts`,
`.prettierrc.mts` and `.prettierrc.cts` each carrying `printWidth: 20` all made a 47-character line
`MISFORMATTED` — so the authority is exercised, not merely present. Had the runtime been unable to
load them, the typed `CONFIG_ERROR` path would have said so; either way it is never silently clean.

Five new controls: one on the discovery itself (all six TS forms plus the previously-present ones,
so the fix does not trade one omission for another), one revision per `.ts` / `.mts` / `.cts` — the
measurement behind "one shared rule covers them" — and one proving a LIVE `prettier.config.ts` has
zero authority over a revision that has none.

Thirty-four controls, mutations 10/10 ISOLATED. `M-FMT-NO-TS-CONFIG` drops the TS forms from
discovery and takes 4 red, exactly as predicted: the discovery control and all three revision
controls.

`REMOTE_CI` unchanged in kind: no workflow binds to this branch, and nothing older is inherited.

`[CLAUDE_APPLIED][MARKET-IR120-TS-CONFIG-AUTHORITY-20260902-1612]` posted as comment `5507510750`
and read back from the remote. `REMOTE_CI: NONE` stated there as measured — 0 check-runs, 0
statuses on `5056d779` — not inherited from `33547628222`, which belongs to `bb88ded`.

## IR-121 — one name, two buses: the control bus root was never a place

Found by running `scheduleNextWork()` rather than reasoning about it. Nothing reported this; the
queue offered `CLUSTER-SEMANTIC_RECENCY`, whose own prediction names "a cache, a build, or a running
process assumed to match the tree", and the shape turned up one layer down from where it was
predicted.

`storePaths()` defaulted to `RUNTIME_DIR`, the RELATIVE string `.local/control-bus`, resolved
against `process.cwd()`. Measured, from the two worktrees this repository actually has:

    from C:/AI-Projects/market-os                  ->  market-os/.local/control-bus   state EXISTS
    from C:/AI-Projects/market-os-ask-guardrail    ->  guardrail/.local/control-bus   state ABSENT

Every module agreed on what the bus was CALLED. Nothing agreed on where it was.

**Reading** from the wrong side is merely useless: `stop-evidence.ts` reports `receivedDecisions`
and `controlBusWatcher` as unestablished, which is honest and permanent — those two axes could never
be established from the worktree where all the work happens, so the sentinel's refusal was
structural rather than a finding. Its own doc comment recorded the cause as correct behaviour: a run
from another worktree "legitimately finds nothing". It did find nothing. There was nothing
legitimate about why.

**Writing** is the hazard. `scripts/control-bus.ts` and `scripts/rc-preflight.ts` call `storePaths()`
with no root argument and no way to pass one, so starting the watcher from the wrong worktree would
have created a SECOND durable inbox with its own independently advancing cursor — against "one
issue, never a second", and against `DURABLE_INBOX_BEFORE_CURSOR_ADVANCE`, which assumes there is
one cursor to advance. Two of them lose decisions to each other while each looks perfectly healthy.
`scripts/inbox-triage.ts` carried a fifth hand-written copy of the same relative literal.

It had not fired. No shadow bus exists in either worktree, because every write so far passed
`--bus-root` by hand. That is discipline, and discipline is not a property — which is the entire
reason this is written down as a defect rather than as a near miss.

**The repair is one rule both sides obey.** The bus belongs to the REPOSITORY, so
`repositoryBusRoot()` asks git: `rev-parse --path-format=absolute --git-common-dir` returns the same
absolute shared `.git` from every worktree, and the bus sits beside it. Explicit roots — tests,
`--bus-root` — are untouched; only the default changed. It fails CLOSED: if git cannot answer there
is no fallback to the working directory, because the working directory is what was wrong.

`--path-format=absolute` is load-bearing and must precede the option it governs. Plain
`--git-common-dir` answers `.git` from the top of the main worktree and an absolute path from
anywhere else — the same cwd-dependence in a new costume, and invisible to anyone testing from a
linked worktree, which is exactly where this repository's suite runs.

**Measured effect.** Before, from the guardrail worktree, both bus-derived sentinel fields were
unestablished. After, the same command establishes `receivedDecisions = 0` and
`controlBusWatcher = STOPPED` — the first time either has been a finding rather than an absence.
(`STOPPED` is a true fact now visible, and starting a second poller alongside the existing cadence
is a human decision, not taken here.)

**A guard caught the first shape of the repair, and the guard was right.**
`tests/applicationPrerequisite.test.ts` looks for a module that both consumes control-bus decisions
and performs an effect without going through the application journal; `store.ts` names the
inbox-entry type, and asking git means spawning a process. The answer to a deliberately shallow
guard is not an exemption — the resolution moved to `src/server/controlbus/root.ts`, which knows
nothing about decisions, so the guard's predicate became FALSE rather than excused. It then fired a
second time on the new file's own comment, which mentioned the type in prose. Also paid rather than
excused: a shallow check that runs is worth more than a clever one that gets deleted.

**Six controls.** Same-directory-from-a-linked-worktree and same-directory-from-a-subdirectory (a
real `git worktree add` fixture, not a simulation); absolute from both, which asserts the plain
git form still has the trap it is guarding against; beside-the-shared-`.git`; fail-closed on an
unanswerable question, with no root in the result; and an explicit root passing through untouched.

The pre-existing placement control was rewritten, not deleted. It asserted
`storePaths().root.startsWith(".local/")` — a STRING standing in for the property that the watcher's
runtime state is gitignored, and the string is precisely what went wrong. It now asks
`git check-ignore` about the resolved path, which cannot be satisfied by a path that merely begins
with the right characters.

**Mutations 4/4 ISOLATED, and three of four cardinalities were wrong.**

    M-BUS-CWD-ROOT               predicted 3, measured 4 -- the early return short-circuits the git
                                 call, so the fail-closed control goes red too; the mutant subsumes
                                 M-BUS-FALLBACK-ON-ERROR, and only running it said so
    M-BUS-PER-WORKTREE-GIT-DIR   predicted 2, measured 3 -- the extra is the gitignore control, and
                                 the reason is WHERE THE SUITE RUNS: under `--git-dir` the root
                                 lands inside `.git/worktrees/...`, and git reports nothing inside
                                 the git dir as ignored
    M-BUS-PLAIN-PATH-FORMAT      predicted 2, measured 3 -- the extra is the SUBDIRECTORY equality
                                 control; top-vs-subdirectory diverges for the same reason
                                 main-vs-linked does, so the two equality controls are not redundant
    M-BUS-FALLBACK-ON-ERROR      predicted 1, measured 1

The cross-worktree equality control does NOT catch the plain relative default. A constant is equal
to itself, so the control that names the defect cannot catch its most obvious form — which is what
writing the prediction down before running buys, and what counting the tests that mention it would
have hidden.

One mutant was deliberately not written: "storePaths ignores its explicit root". Under it the
fixtures would write through the default root, which after this repair is the real live control bus.
A mutation that corrupts the production inbox is not a measurement; the property is covered by the
explicit-root control instead.

**Environment, recorded and not repaired by a product change.** A bare `npx vitest run` in this
worktree fails 7 tests on a missing `DATABASE_URL`: `.env` is gitignored and so does not exist in a
linked `git worktree`. The suite was run with `TEST_DATABASE_URL` supplied on the command line.

Gates: 152 files / 2678 pass + 19 expected fail (2697); format, lint, typecheck, `format-gate` and
`next build --webpack` clean. `REMOTE_CI: NONE` — no workflow binds to this branch and nothing older
is inherited.

### IR-120 closed on the exact tree, by a durable advisory kind

`[CHATGPT_VERIFIED][MARKET-IR120-TS-CONFIG-AUTHORITY-20260902-1612]`, comment `IC_kwDOT5Wka88AAAABSFC6Jg`,
2026-09-02T10:35:05Z. Status `APPROVED`, bounded to application comment `5507510750` on exact
`5056d779`: it approves the config-authority repair and nothing that descends from it.

Its independent review agreed the derivation replaced the omission CLASS rather than the six missing
strings, that discovery fails closed with a typed `CONFIG_ERROR` and no guessed fallback, and that
`package.yaml` came out of the same derivation. It declined to promote the producer-reported 34
controls and 10/10 mutations to remote CI, checked the exact SHA itself, and reached the same answer
this side did: `REMOTE_CI: NONE`.

It also names `6f82164` — IR-121 — as a newer child and says explicitly that this approval must not
be reused for it. Recorded as the boundary it is.

**The kind.** `CHATGPT_VERIFIED` is durably ingested — it is in `ADVISORY_INBOUND_KINDS` in
`src/server/escalation/transport.ts` — and it is NOT authority-bearing. `AUTHORITATIVE_KINDS` holds
`CHATGPT_DECISION` and nothing else. That is ESC-014's answer, and the answer is in the tree.

An approval of work already applied grants no authority in any case, and none was taken. But that is
the second reason, and leaning on it is how the first one went unchecked — see IR-122, below, which
is this paragraph's own correction.

## IR-122 — the ledger contradicted the protocol, and I wrote the contradiction

Reported as `[CHATGPT_REVIEW_GUIDANCE][MARKET-IR122-ESC014-LEDGER-SOURCE-AUTHORITY-20260902-2027-KST]`,
`REWORK_REQUIRED__STALE_REVIEW_LEDGER_CONTRADICTS_CANONICAL_ISSUE_AND_SOURCE`, against exact
`8f7af1febca1b61546e59b7abcb6c04f6274ff42` — the docs-only commit immediately before this one, and
mine.

### What the ledger said, and what the tree says

That commit recorded three protocol claims. All three are false:

    ledger claim                                     tree
    CHATGPT_VERIFIED is a kind ProtocolKind          it is in ADVISORY_INBOUND_KINDS in
    does not know                                    src/server/escalation/transport.ts
    the durable inbox drops it                       it is durably ingested, and non-startable
    ESC-014 is still unanswered                      answered and applied, see below

Every point in the report was verified here before anything was changed, against the source and
against the issue rather than against the report:

- `[CHATGPT_DECISION][ESC-014]` is issue #2 comment `5498489070`, 2026-09-01T18:26:26Z, Option B —
  widen durable ingestion to the nine measured inbound kinds, and keep `CHATGPT_DECISION` as the
  only application authority.
- `[CLAUDE_APPLIED][ESC-014]` is comment `5498724064`, 18:45:25Z, at non-null SHA `4aca09ce`.
- `AUTHORITATIVE_KINDS` is exactly `["CHATGPT_DECISION"]`; `ADVISORY_INBOUND_KINDS` holds the other
  eight, `CHATGPT_VERIFIED` among them.
- `src/server/controlbus/state.ts` calls rows without a `kind` field the legacy case, _because_
  ESC-014 widened ingestion — the code documents the same history the ledger denied.

`ESCALATION` for ESC-014 is comment `5498131832`. IR-117 was right that the escalation had never
been staged and right to post it; what came after — the decision, the application — landed the same
evening, and my note two days later still described the state IR-117 had left behind.

### How it happened, since that is the transferable part

I did not read `transport.ts`. I copied a sentence out of the operating rules, which were stale, and
a copied sentence reads exactly like a checked one. This is `EVIDENCE_FABRICATION` with me as the
author, in the ledger whose purpose is to catch it — and it survived a self-review, a format gate, a
full suite and a push, because none of those read prose.

`CLAUDE.md`'s own rule covers it exactly: output is a claim, not evidence, including the harness's
own. It did not occur to me that the rule applies to a document I am _quoting from_ as much as to a
tool I am reading output from.

### What was NOT changed

No protocol semantics. The report was explicit — do not make the stale prose true by changing the
code — and there is nothing to change: the production path is already what ESC-014 decided. Nine
kinds durable, one authoritative, unknown kinds failing closed, `INGESTED != AUTHORITATIVE !=
APPLIED` structural rather than prose. Those thirteen controls in `tests/esc014InboundKinds.test.ts`
stay green and untouched.

ESC-014 is **not** review-closed, and this does not close it. There is no `[CHATGPT_VERIFIED][ESC-014]`
verdict on the issue, and an application is not a verification.

`[CHATGPT_VERIFIED][MARKET-IR120-TS-CONFIG-AUTHORITY-20260902-1612]`, comment `5508217382`, stays
bounded to exact `5056d779` and approves nothing that descends from it — not IR-121, not this.

### The guard, and why it is not a phrase blacklist

`tests/ledgerProtocolCoherence.test.ts`. Rewording the paragraph would have left a second normative
source to drift again, so the controls derive what may not be said FROM THE CODE:

- the kind names come from `ALL_PROTOCOL_KINDS`, so a kind added later is covered with nobody
  remembering to extend a list;
- "ESC-014 was answered" is derived rather than asserted — advisory kinds exist only because the
  decision widened ingestion, so while that list is non-empty the docs may not call the question
  unasked.

Only the PRESENT tense is forbidden. A ledger's value is that it records what was believed, so
history and reported speech survive: "eleven were dropped" is true and stays, and IR-117's dated
quotation of the then-current rules stays as a quotation.

Six controls, over `docs/REVIEW_DEBT.md` and `CLAUDE.md`. Two of them exist because the first draft
could have skipped itself: a CANARY feeding the detector text this file owns, and a separate control
proving the documents are actually read. They catch different evasions, which the mutants confirm.

Four passages were corrected — and the guard found them, rather than me. Two were in the note the
report named; the other two it had not mentioned: IR-117's inventory sentence, present-tense and now
false, and IR-117's quotation of the operating rules, accurate but written as a live claim.

### Mutations 4/4 ISOLATED, every cardinality exactly as predicted

    M-LEDGER-STALE-DROPPED         restore "ProtocolKind does not know ... drops it"    1 red
    M-LEDGER-STALE-UNASKED         restore "ESC-014 is still unanswered"                1 red
    M-LEDGER-HISTORY-EXEMPTS-ALL   widen the historical exemption to everything         1 red
    M-LEDGER-NO-DOCS               scan no documents at all                             1 red

The last two are the interesting pair. Under either, BOTH document scans go green. The canary
catches the first and cannot see the second; the input control catches the second and cannot see the
first. Two ways for a guard to stop looking, so two controls.

### IR-122 addendum — the guard failed on the entry that documents it

The first draft flagged this very section: the two-column comparison of the stale claim against the
tree, and the mutant list quoting both claims verbatim. The instinct was right and applied one step
too far. Normative claims live in prose; a fenced or indented block is a quotation or a table, and a
ledger that cannot quote the defect it records is no longer a ledger. Blocks are now stripped before
the scan.

Stated rather than papered over: a stale claim written INSIDE a block would not be caught. The one
this exists for was prose, both restoring mutants are prose, and widening the rule would cost the
ledger the ability to show what it is correcting.

The typecheck caught a second thing. `ADVISORY_INBOUND_KINDS.length === 0` is a TS2367 error,
because the tuple's length is the literal 8 — the type system already knows the premise the guard
clause is defending. The clause stays, widened to `readonly string[]`, because it says WHY the rule
applies; deleting it would leave the derivation implicit.

### IR-122 closed at the exact tree

`[CHATGPT_VERIFIED][MARKET-IR122-ESC014-STALE-LEDGER-20260902]`, comment `IC_kwDOT5Wka88AAAABSGpF1Q`,
2026-09-02T12:57:41Z, `APPROVED` at exact `c7c4ba2b4b6c85024a80d2369670a73b663bf37d`. The
application marker is comment `5509679048`.

Independently checked on the far side, not taken from the report: that `8f7af1f..c7c4ba2` is exactly
one commit touching only the two documents and the two new files, with **no production source
changed**; that the two ESC-014 comments say what this ledger now says they say; that
`transport.ts` carries the one-kind authority split; that the guard imports its kinds from
production source rather than restating them; and that `REMOTE_CI: NONE` is the only supported
remote statement for that SHA. The local numbers stayed labelled as producer-local evidence.

Two boundaries recorded as given. This does **not** review-close ESC-014, and it approves nothing
after `c7c4ba2`. And the prose guard is accepted as a BOUNDED regression detector — the
block-stripping limitation is accepted as documented, with an explicit instruction not to widen it
into general prose policing without a separately reproduced need. Written down here because the
temptation to widen it will come from this file.
