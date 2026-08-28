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
would refuse a legitimate request: ` current ` occurs twice in
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

  * The first overlap found could not have killed the mutant. Production decides it at the early
    return, because the attribution parser claims the entire string — condition 1, which hand
    analysis kept missing.
  * The blindness is not "the marker sits in the overlap". The case that kills the mutant is two
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
FABLE_EXACT_TREE_REVIEW   = REWORK_REQUIRED for 007e6c8, one reproduced P1 (see the OPEN BLOCKER
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

| # | Finding | Reproduction | Disposition |
| - | ------- | ------------ | ----------- |
| 1 | `startup_recovery()` ran BEFORE the lock. A second harness could read a live run's incomplete manifest, restore its active mutant, delete the manifest, and only then fail to acquire the lock — leaving the first harness measuring a tree that had been put back underneath it | instrumented call order: recovery at offset 215, lock at 1510 | **REPAIRED.** `acquire_lock(token)` is now the first statement of `harness()`; the body moved into `_run_locked()` so recovery, snapshot and the mutation transaction are all inside the lock. Re-measured: lock precedes recovery |
| 6 | Dead-owner reclaim was TOCTOU-racy: two processes could each read the same dead pid and each conclude the lock was theirs, after which either `release_lock()` would delete the other's | read of the pid-only lock format, no atomic claim step | **REPAIRED.** Locks carry a unique token (`pid-time_ns`); reclaim writes a staging file and `os.replace()`s it, then reads the lock back and proceeds only if it still holds our own token; `release_lock(token)` removes the file only while it contains that token |
| — | Control G was weakly discriminating: its holder took the lock and nothing else, so a second harness had no manifest to wrongly recover — G could not have caught finding 1 | inspection, confirmed by construction | **STRENGTHENED.** The holder now writes an incomplete manifest AND an active mutant. G0 asserts the holder is genuinely mid-mutation; G2/G3 assert the live run's bytes and manifest survive untouched |
| — | Control D was weakly discriminating: it never fed a stale verdict into any aggregation path | the filter it nominally covered (`foreign = [v for v in verdicts if v["run_id"] != run_id]`) reads a local list appended to in exactly one place with a literal `run_id` — no value could fail it | **CHECK DELETED, CONTROL REBUILT.** The vacuous filter was removed rather than tested. Aggregation does not happen in-process; it happens when a log is read afterwards, which is how the 59-minute stall nearly passed for a measurement. Verdict lines now carry their run id; `verify_report()` admits a verdict only when its run also emitted `RUN_COMPLETED`; D drives two REAL harness logs through it — one complete, one killed after a verdict had already printed |

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

| Mutant | Verdict |
| ------ | ------- |
| B-M1 Hangul no longer confirms a boundary | ISOLATED |
| B-M2 clause-opening tokens no longer confirm | ISOLATED (5 tests) |
| B-M3 only the FIRST token is scanned, not the whole fragment | **MISSED** |
| B-M4 a boundary-adjacent determiner no longer confirms | ISOLATED |
| B-M5 confirmation stops accumulating, so a clean later fragment launders it | ISOLATED |
| B-M6 blocked runs skipped rather than withheld (cost invariant only) | ISOLATED (3 tests) |

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

| | |
| - | - |
| corpus | 42,840 requests |
| differing | 2,532 |
| current REFUSES / mutant AUTHORIZES | **1,204** |
| current AUTHORIZES / mutant refuses | **0** |
| PROHIBITED payloads differing | 0 |

The 1,204 are the P1 itself. `What did Reuters publish about Alpha. In 2024 what was the CPI?`
authorizes under the mutant with subject region ` alpha in 2024 what was the cpi ` and source
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

| request | repaired | pre-repair |
| ------- | -------- | ---------- |
| `What is the definition of Mr. Show?` | UNSUPPORTED | AUTHORIZED, DEFINITION ` mr show ` |
| `What did Mr. Show report about Alpha?` | UNSUPPORTED | AUTHORIZED, source `mr show` |
| `What is the definition of Samsung Electronics Co. 삼성전자?` | UNSUPPORTED | AUTHORIZED, DEFINITION |
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
- **(ii) require the tail to read alone too** — the pinned swallowed tails were *chosen* because
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

| Concern | Response |
| ------- | -------- |
| H4's twelve rounds detect ~93% of a 6/30 mode and ~72% of a 3/30 mode, but only **~18%** of the 1/60 stranding mode; ~137 rounds gives 90% | The arithmetic is now written into the control's own comment instead of being implied, and `--soak` runs 150 rounds. **Recorded evidence: 54/54 controls pass at 150 rounds**, plus 180 rounds from the standalone race harness |
| H4 could not distinguish two winners (broken exclusion) from zero winners (stranding) | Split into **H4a** (no round produced TWO) and **H4b** (no round produced ZERO); the two failures mean opposite things |
| H6 checks non-owner release sequentially, not against a concurrent release/replacement schedule | **NOT CLOSED.** Recorded as coverage debt. Luna classed it a concern, not a demonstrated wrong result |
| A reclaimer that dies holding the claim leaves a permanent fail-closed lock | Intended and documented, with a diagnostic naming the directory. Luna confirmed the scoping is correct |

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

| group added | swallows closed | requests wrongly refused |
| ----------- | --------------- | ------------------------ |
| interrogatives `who whom whose why when where` | 456 | **0** |
| imperatives `compare list` | 1,380 | **0** |
| determiners `any same` | 1,040 | **0** |

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

| when | the half the tests could not fail on |
| ---- | ------------------------------------ |
| pre-repair | every swallowing test picked a tail that authorizes ALONE — the precondition for cover competition to work |
| B-M3 | every swallowed tail either opened with a determiner or had its clause-opening word first |
| here | every internal boundary was `?`, which the terminator rule now catches without consulting anything lexical |

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

| tail shape | swallowed |
| ---------- | --------- |
| imperative not in the set (`Summarize`, `Break down`, `Chart`, `Plot`, `Find`, `Check`, `Look up`, `Graph`, `Pull the ... series`) | 11 of 12 |
| imperative IN the set (control) | 0 of 5 |
| interrogative fragment (control) | 0 of 4 |
| bare noun (`Gamma.`, `Revenue.`, `Inflation.`) | 4 of 4 |
| proper-name-shaped (`Gamma Corp.`, `Alpha Holdings.`) | 4 of 4 |
| coined token (`Zorbulate Gamma.`) | 4 of 4 |
| Hangul after a period | 2 of 2 |
| digits (`2024.`, `Q3 Gamma.`) | 3 of 3 |
| | **28 of 38** |

Every swallow serves a composite subject — ` alpha summarize gamma `, ` alpha 2024 `,
` alpha zorbulate gamma ` — with source `reuters`. Factual records represented as answering a
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
case at all; the suite already held one, and it failed, serving the subject ` smith ` instead of
`smith jones revenue`. A shorter subject that authorizes is the dangerous failure, not one a reader
would notice. `;` moved to provisional alongside `!`.

#### The residual, quantified rather than described

Sweeping the 38-tail matrix across all three terminators:

| boundary | swallowed | refused |
| -------- | --------- | ------- |
| `.` | **0 of 38** | 38 |
| `!` | 28 of 38 | 10 |
| `;` | 28 of 38 | 10 |

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
