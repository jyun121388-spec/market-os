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
