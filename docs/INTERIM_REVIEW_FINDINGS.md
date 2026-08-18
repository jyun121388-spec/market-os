# Interim Review Findings

Review base: `a0eb92a` · Branch `claude/market-os-development-7vnicg`

**Status changed 2026-08-18.** IR-001 through IR-008 were raised while Codex usage was exhausted
and local AI had failed calibration, so they were author-reviewed only. Codex access has since
been restored by a plan upgrade (`docs/AI_REVIEW_RUNTIME_STATE.md`) and the first genuine
independent review of this branch has now run — IR-009 through IR-011 below came from it. The
earlier entries still want independent eyes; they are marked `Codex re-review: YES`.

Verification at the close of this round: **538/538** tests across 67 files against real
PostgreSQL 16.10; **33/33** E2E in a real browser against a freshly rebuilt production build; **67/67** live
EDGAR contract checks; lint, typecheck, format and build clean. The real dev database still holds
2240 filings and 1428 facts, verified by re-ingest after every suite run.

Severity: **P0** data loss / security · **P1** false financial output reaching a user ·
**P2** latent correctness or provenance defect · **P3** hygiene.

---

## IR-001 — Ask Market blends financial facts across providers

|                 |                                                                |
| --------------- | -------------------------------------------------------------- |
| Reviewer        | Claude (adversarial second pass, §14 method)                   |
| Subsystem       | `src/server/domain/askMarket.ts` — `findCompanyFacts`          |
| Severity        | **P2** (latent; **P1** the moment a second fact source exists) |
| Status          | **VALID — fixed**                                              |
| Fix commit      | `f6ebb5b`                                                      |
| Codex re-review | **YES**                                                        |

**Hypothesis.** The company is matched through a _filing_, which belongs to exactly one source,
but the facts were then fetched with `where: { corpCode: filing.corpCode }` — no `sourceId`. Both
unique indexes on `financial_facts` begin with `sourceId`, so the schema states that a corp code
identifies a company only _within_ its provider. The query's correctness depended on corp-code
namespaces never colliding across providers, which nothing enforces.

**Reproduction.** Seeded a second source reusing the same `corpCode`, with a KRW figure of
`999999999`. Ask Market returned `[999999999, 1000000, 250000]` — the other provider's
foreign-currency figure _leading_ the answer, because it sorted first by `periodEnd`.

**Root cause.** Query keyed on a non-unique business identifier.

**Fix.** `where: { sourceId: filing.sourceId, corpCode: filing.corpCode }`.

**Verification.** New regression test in `tests/integration/ask-market.test.ts`; the pre-existing
`toHaveLength(2)` assertion independently caught the leak once the data existed. Full suite green.

---

## IR-002 — Company X-Ray presents a merged multi-source entity as one sourced record

|                 |                                                           |
| --------------- | --------------------------------------------------------- |
| Reviewer        | Claude (propagation check from IR-001)                    |
| Subsystem       | `src/server/domain/companyXray.ts` — `computeCompanyXray` |
| Severity        | **P2** (latent; **P1** with a second source)              |
| Status          | **VALID — fixed**                                         |
| Fix commit      | `f6ebb5b`                                                 |
| Codex re-review | **YES**                                                   |

**Hypothesis.** Worse than IR-001, because the page _displays_ provenance. `sourceCode` is taken
from whichever filing is newest, while `filingCount`, the ticker, `latestFigures` and
`recentFilings` were each queried on `corpCode` alone — one provider named in the header, several
pooled in the body. `listCompanies()` already groups by `(corpCode, corpName, sourceId)` and would
list those as two separate companies, so the index page and the detail page disagreed about how
many companies exist.

**Reproduction.** Second provider sharing the corp code, filing _earlier_ so the header stayed
correct and only the body was contaminated — the more dangerous arrangement. Result: three revenue
figures where two exist, `filingCount` 2 instead of 1, and the other provider's report in the
filing list. Two pre-existing tests failed alongside the new one.

**Fix.** All four queries scoped to `{ sourceId: anyFiling.sourceId, corpCode }`. `changes` and
`completeness` were already scoped this way; these four were not.

**Known limitation, deliberately not fixed here.** `/company/[corpCode]` is keyed on corp code
alone, so if two providers ever share one, the page shows the newest-filing source and the other is
unreachable. Fixing that means changing the route to carry the source, which is not a minimal
change during release hardening. Recorded rather than silently widened.

---

## IR-003 — Company X-Ray test suite silently stopped running

|                 |                                                                             |
| --------------- | --------------------------------------------------------------------------- |
| Reviewer        | Claude (observed during IR-002 work)                                        |
| Subsystem       | `tests/integration/company-xray.test.ts`                                    |
| Severity        | **P3** — test hygiene (see the correction below; this is not a false-green) |
| Status          | **VALID — fixed**                                                           |
| Fix commit      | `f6ebb5b`                                                                   |
| Codex re-review | NO                                                                          |

**Reproduction.** The file's cleanup deleted facts and filings but not `ingest_runs`, which the
completeness tests write. After a run aborted part-way, leftover rows blocked
`prisma.source.delete` on `ingest_runs_sourceId_fkey`, so `beforeAll` threw on the _next_ run and
vitest reported **"9 tests | 9 skipped"** — a suite that had quietly stopped exercising anything.

**Correction to the first assessment.** I initially rated this P2 and called it a false-green on
the grounds that the failure was silent. It is not. Vitest also printed `Failed Suites 1` and
exited **255**, so CI fails loudly and a real regression could not slip through this way. What is
genuinely wrong is narrower: an interrupted run left state that broke every subsequent run of the
file, and the summary line reads "skipped" — misleading to a human skimming output, which is how
it cost time here. Downgraded to P3 and removed from the Codex queue accordingly.

**Fix.** `deleteSourceAndDependents()` removes `ingestRun` rows first, used by both `beforeAll`
and `afterAll`; `afterAll` also tolerates an id that was never assigned.

**Systemic lesson.** Test cleanup must cover every table with a foreign key to the fixture root,
not just the tables the file writes directly. The completeness tests added `ingest_runs` writes
later without extending teardown — the same "new dependency, old teardown" drift worth watching
for elsewhere.

---

## IR-004 — Stored dates could shift a day under a non-UTC process — REJECTED

|                 |                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------- |
| Reviewer        | Claude                                                                                   |
| Subsystem       | `edgar/normalize.ts`, `edgar-xbrl/normalize.ts`, all `toISOString().slice(0,10)` renders |
| Severity        | would have been **P1**                                                                   |
| Status          | **REJECTED — no defect**                                                                 |
| Codex re-review | NO (recorded so it is not re-investigated)                                               |

**Hypothesis.** This machine runs at UTC+9. If any date were parsed as local time, rendering it
with `toISOString().slice(0, 10)` would print the **previous day** on every period label in
Filing Diff and Company X-Ray.

**Result.** Both ingest paths use `new Date(Date.UTC(y, m - 1, d))`. Verified empirically rather
than by reading: all 1431 facts and 2240 filings in the real dev database were checked for
`getTime() % 86_400_000 !== 0` under a UTC+9 process. Zero offenders. Round-trip through
PostgreSQL preserves exact midnight UTC.

---

## IR-005 — Fixture rows in the dev database — observation, not a product defect

|                 |                                          |
| --------------- | ---------------------------------------- |
| Status          | **NOT A DEFECT — retained deliberately** |
| Codex re-review | NO                                       |

`financial_facts` in `market_os_dev` holds 1431 rows, not the 1428 the ingest reports. The extra
three are `TESTCIK` rows under a second `sourceId`, left by test runs from before the fail-closed
guard existed. No filing references that corp code, so nothing surfaces them.

They are being kept as a **canary**: after IR-001 and IR-002, any appearance of `TESTCIK` in
user-facing output is now a provenance regression with an obvious signature. Noticing the
1431/1428 gap is what led to IR-001 in the first place.

---

## IR-006 — Twenty-one Ask Market guardrail bypasses

|                 |                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Reviewer        | `qwen3.5:4b` proposed the inputs; `detectPersonalizedAdviceRequest` scored them                     |
| Subsystem       | `src/server/domain/askMarket.ts` — `ADVICE_REQUEST_PATTERNS`                                        |
| Severity        | **P1** — a personalized-advice request answered without redirect crosses `docs/LEGAL_GUARDRAILS.md` |
| Status          | **VALID — fixed**                                                                                   |
| Codex re-review | **YES**                                                                                             |

This is the one sanctioned use of the local model: it generated candidate phrasings and the real
detector graded every one. The model never judged anything, so its demonstrated false-positive
bias could not introduce a wrong answer — only wasted candidates.

**Batch 1** — 8 of 14 got through, in five classes: asking on behalf of a third party ("my brother
asked me… which stocks to buy"); an adjective between possessive and noun ("my **current**
holdings"); order mechanics as logistics ("where to place my orders"); a position change without a
possessive ("adding more position"); a hypothetical whose payload sat 85 characters after the
opener, past the old 60-character window; and Korean entry-price / sell-strategy / tailored-advice
forms.

**Batch 2** — 3 more classes, two of them the _same word-order bug already fixed once for English_:
`목표가` was covered but `가격 목표` was not, `수익 보장` was covered but `보장된 수익률` was not.
Plus definitive price prediction with no numeral in the sentence, which the existing
`will … (hit|reach|go to) <number>` pattern structurally cannot match — "where this asset will
land", "fair value", "upside to".

**Batch 3 — stopped probing and enumerated instead.** The two word-order misses were not bad luck,
they were the visible corner of a class: _a concept covered in English whose Korean mirror was
never written_. So every English-only pattern in the list was walked and checked for a Korean
counterpart. **Ten had none** — 적정가 (fair value), 네가 나라면 / 당신이라면 ("if you were me"),
인 척 (roleplay), 어디에 투자할까요 (where to invest), 제 애널리스트 / 내 증권사 직원 (advisor
proxy), and 얼마나 오를까 (definitive price prediction).

That is the durable lesson of this finding. Probing surfaces these one accident at a time;
enumerating the list surfaced all ten in a single pass. **Any future guardrail pattern added in one
language must be added in the other, or explicitly recorded as not applicable.**

**Over-blocking is tracked as a failure too.** Three patterns from the first draft were too broad
and are recorded in the test file with the sentences that exposed them: `매도\s*가` flagged
"외국인 매도가 증가했다" (foreign _selling_ rose — an observation, not a sell price), and
`투자\s*계획` flagged "정부의 투자 계획" (government capital spending). A guardrail that refuses the
product's own subject matter has failed in the direction nobody reports.

**Deliberately NOT fixed: prompt injection.** `askMarket` makes no model call — it regex-matches,
reads PostgreSQL, and returns a static redirect string. There is no instruction hierarchy to
override, so "ignore your previous instructions" is an unmatched string and patterns for it would
be theatre. This changes the moment the LLM interpretation layer in the module docstring is built;
the note lives in `tests/askMarketAdversarial.test.ts` so whoever builds it sees it.

**Verification.** `tests/askMarketAdversarial.test.ts`, 39 cases — 21 bypasses and 18 legitimate
questions that must keep passing through. Each over-block case is the specific sentence that
forced a pattern to be narrowed: 라면 is instant noodles as well as "if it were", 투자되어 is
passive and asks where money already sits, 물가 and 수출 are macro series rather than assets.

---

## IR-007 / IR-008 — Figures shown to users with no source attribution

|                 |                                                                               |
| --------------- | ----------------------------------------------------------------------------- |
| Reviewer        | Claude (systematic sweep of the IR-001/IR-002 class)                          |
| Subsystem       | `askMarket.ts` + `/ask`; `morningBrief.ts` + `/today`                         |
| Severity        | **P2** — provenance; CLAUDE.md requires every FACT shown to trace to a source |
| Status          | **VALID — fixed**                                                             |
| Codex re-review | **YES**                                                                       |

Found by walking all 86 Prisma call sites rather than by suspicion. The IR-001/IR-002 class was
"queries keyed on an identifier unique only within a source"; the sweep turned up its mirror image
— **queries correctly scoped but whose OUTPUT drops the source on the floor**.

**IR-007.** `SeriesFactor` and `CompanyFactFactor` carried no source, and `/ask` rendered none.
`Series` is unique on `(sourceId, externalId)` and never on name, so two providers publishing
their own CPI or policy rate is ordinary. Both match one topic, both get listed, and the reader
sees two different values under near-identical labels with nothing to separate them — or to
indicate two organisations are being quoted at all.

**IR-008.** The same gap in Morning Brief's `whatChanged`. Notable because `recentFilings` and
`calendar` in the _same response object_ already carried `sourceCode`, and `/today` already
rendered it for both. `whatChanged` is the section that shows actual numbers, and it was the one
without attribution — the inconsistency is what makes it a defect rather than a design choice.

**Reproduction.** Second provider with a series whose name also matches the topic; the answer
returned both, at 102 and 530, indistinguishable. Test asserts every factor carries a source and
that the two values map to the right providers.

**Fix.** `sourceCode` added to `SeriesFactor`, `CompanyFactFactor` and `SeriesChangeSummary`,
sourced via `include: { source: { select: { code: true } } }`, and rendered as a badge on both
pages. For company facts it is taken from the matched filing, which is sound because IR-001
already scoped that query to the filing's source.

### What the sweep cleared

Recorded because a sweep that only reports hits says nothing about coverage:

| Area                                             | Verdict                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `macroRegime` series resolution                  | Clean — resolves by `{ sourceCode, externalId }` explicitly   |
| `economicCalendar` / `CalendarEntry`             | Clean — already carries `sourceCode`                          |
| `systemHealth` aggregates                        | Clean — every aggregate is `where: { sourceId }`              |
| `etfExposure`, `seriesReadings`, `claimStore`    | Clean — keyed on primary keys, scoped by construction         |
| FRED / ECOS / DART / EDGAR ingest lookups        | Clean — compound `sourceId_externalId` / `sourceId_receiptNo` |
| `filingDiff`, `companyXray`, `askMarket` facts   | Clean — scoped by IR-001/IR-002                               |
| `CausalEdge`                                     | Clean by design — curated INFERENCE, has no provider relation |
| `eventIngest` cross-source clustering            | Clean by design — `distinctTierCount` exists to pool sources  |
| `findKnownCorpCodes` (watchlist link resolution) | Accepted — existence check only; residual noted in IR-002     |

---

# First independent Codex review — 2026-08-18

Codex access was restored by a plan upgrade (`docs/AI_REVIEW_RUNTIME_STATE.md`), so this is the
**first genuine independent review this branch has had since `9b34f8b`**. Run read-only
(`-s read-only`) so a reviewer could not modify the tree. Reviews were complementary, not
duplicated: Luna took the bounded matrix, Terra the cross-file semantics, Sol was not needed.

Every finding below was reproduced by me before any code changed. Model authority does not
override runtime evidence.

## IR-009 — Equal month buckets are not equal durations (Terra)

|                 |                                                              |
| --------------- | ------------------------------------------------------------ |
| Reviewer        | `gpt-5.6-terra` — reproduced and confirmed against real data |
| Subsystem       | `src/server/domain/filingDiff.ts`                            |
| Severity        | **P1** — a plausible, misleading financial number            |
| Status          | **VALID — fixed**                                            |
| Codex re-review | **YES**                                                      |

**Claim.** `periodLengthMonths` buckets with `Math.round(days / 30.436875)`, so a 52-week and a
53-week fiscal year both become `12`, and a 13-week and 14-week quarter both become `3`.

**Reproduction — this is not hypothetical, it is in the database now.** Real Apple facts:

| Actual span  | Bucketed months | Rows |
| ------------ | --------------- | ---- |
| 90 days      | 3               | 492  |
| **97 days**  | **3**           | 28   |
| 363 days     | 12              | 147  |
| **370 days** | **12**          | 33   |

Apple's fiscal Q1 is periodically 14 weeks. Filing Diff therefore compares the 90-day quarter
ending 2022-06-25 against the 97-day quarter ending 2022-12-31 and reports **+54.2948%** on
NetIncomeLoss with `periodMonths: 3` — implying equal periods when one contains an extra week
(~7.8% more days). Same shape in 2016 and 2011, and on OperatingIncomeLoss.

**Fix — disclose, do not refuse.** Refusing would be wrong: companies report those quarters as
consecutive and so should we. `currentPeriodDays`, `previousPeriodDays` and `periodLengthMismatch`
(tolerance 4 days, which separates ordinary calendar drift from a whole extra week) are now
returned and surfaced as an amber note on `/company/[corpCode]`. This is the same remedy applied
to the nine-month-vs-quarter defect: carry the period so the reader can see it.

**Verification.** Two tests — the 90-vs-97 case, and a **negative control** (88 vs 89 days must
NOT flag). A mismatch flag that is always set discloses nothing.

## IR-010 — Revision-chain cycle hidden behind an intact original (Terra)

|                 |                                                   |
| --------------- | ------------------------------------------------- |
| Reviewer        | `gpt-5.6-terra` — reproduced                      |
| Subsystem       | `src/server/domain/revisionChain.ts`              |
| Severity        | **P2** — DB constraints make it unreachable today |
| Status          | **VALID — fixed**                                 |
| Codex re-review | **YES**                                           |

`findRevisionChainTail` returned the row nothing points at, and threw only when **every** row was
referenced. Given an original `o` plus revisions `a → b` and `b → a`, both `a` and `b` are
referenced, `o` is the sole tail, and the function returned `o` — presenting a superseded value as
current and silently discarding two stored revisions. Its own docstring promised it throws on a
cycle; it did not.

**Reachability, checked rather than assumed.** `observations_series_date_original_unique` permits
one original per (seriesId, observationDate), and the composite unique permits one child per
parent, so every malformed shape is DB-prevented. Fixed anyway: this function decides which number
a user sees, and "the schema should prevent it" is the assumption behind most defects in this repo.

**Fix.** Walk back from the tail and require every row to lie on that one path. One traversal
catches cycles, dangling parents and disconnected components. Forked chains now throw instead of
returning `tails[0]` — a deliberate reversal of the earlier "stable answer" choice, justified
because two tails are two competing current values and the DB prevents it arising.

## IR-011 — `FilingDiffResult` carried no source (Luna)

|          |                                           |
| -------- | ----------------------------------------- |
| Reviewer | `gpt-5.6-luna` — confirmed                |
| Severity | **P3** — attributed by page context today |
| Status   | **VALID — fixed**                         |

The same omission as IR-007/IR-008, in the one output type I missed when fixing those.
`sourceCode` added. Low severity because `/company/[corpCode]` names the source in its header and
all its data is scoped to it — but the API returned an unattributed financial comparison.

## IR-012 — Password hash crossed the server boundary (Terra, security pass)

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| Reviewer        | `gpt-5.6-terra` — reproduced                    |
| Subsystem       | `src/server/domain/auth.ts` — `validateSession` |
| Severity        | **P1**                                          |
| Status          | **VALID — fixed**                               |
| Codex re-review | **YES**                                         |

`validateSession` used `include: { user: true }` and returned the whole Prisma `User` row.
`getCurrentUser` — exported from a `"use server"` module, which makes it a reachable endpoint
whether or not any page calls it — returned that verbatim. So `passwordHash` left the server.

**Why P1 despite being self-only.** It requires a valid session and yields only that user's own
hash, so it is not cross-user disclosure. It matters because it converts a _session_ compromise
into a _credential_ compromise: a stolen cookie expires, an offline-crackable scrypt hash for a
password the person reuses elsewhere does not.

**Fix.** Explicit `select` returning `{ id, email }` — the only fields any caller reads (verified
by grep across `src/app` and `src/server/actions`). The test pins the exact key set, so a future
widened `include` fails rather than silently reintroducing the leak.

## IR-013 — `/admin` required only that someone be signed in (Terra, security pass)

|                 |                              |
| --------------- | ---------------------------- |
| Reviewer        | `gpt-5.6-terra` — reproduced |
| Subsystem       | `src/app/admin/page.tsx`     |
| Severity        | **P2**                       |
| Status          | **VALID — fixed**            |
| Codex re-review | **YES**                      |

The page checked `if (!user) redirect("/login")` and nothing else. `Plan` is `FREE`/`PRO` — a
billing tier, not an authorization boundary — and the schema has no role. On a product with open
signup, any registered user could read source tiers, ingest targets, completeness shortfalls,
unresolved conflict counts and persisted ingest error messages.

**Fix — allowlist, not a schema role.** `isOperatorEmail()` against a comma-separated
`ADMIN_EMAILS`, **failing closed** when unset. Adding `isOperator` to `User` is the better
long-term model but needs a migration during a release freeze and creates a bootstrapping problem:
every existing row defaults to false, so nobody reaches `/admin` until someone hand-edits the
database. Recorded so the migration stays a deliberate later choice.

**Verification, both directions.** Eight unit tests including the unconfigured case (a gate that
opens when nobody configured it is the same defect wearing a hat), substring and prefix
non-matching, and case-insensitivity. Plus a new **E2E step [4b]**: a second, ordinary account
signs up and is turned away from `/admin`. Unit-testing `isOperatorEmail` alone would not have
caught a page that forgot to call it — the exact "helper tested, wiring untested" trap this
project already hit with Watchlist.

## IR-014 — Account-targeted login lockout is a DoS vector — VALID, DEFERRED

|           |                                                           |
| --------- | --------------------------------------------------------- |
| Reviewer  | `gpt-5.6-terra` — confirmed by reading the implementation |
| Subsystem | `src/server/domain/auth.ts` — `isLoginLocked`             |
| Severity  | **P2**                                                    |
| Status    | **VALID — deferred, HG-009**                              |

Failed attempts are keyed solely by normalised email and checked _before_ password verification,
so anyone who knows an address can lock that account for 15 minutes with five wrong guesses. No
session and no victim interaction required.

**Deliberately not fixed while unattended, because every option is a real trade-off, not a bug fix:**

- Remove the lockout → brute-force protection disappears.
- Verify the password before the lock check → the DoS goes away, but an attacker regains unlimited
  guesses, which is strictly worse than the status quo for the threat the lockout exists to stop.
- Key on IP instead of email → needs request-IP plumbing behind an unknown proxy topology, and is
  trivially defeated by a distributed attacker.
- Exponential backoff per email → softens the DoS without removing it.

The current comment in `auth.ts` already states the chosen threat model: a targeted attacker
guessing one account's password, explicitly not distributed credential stuffing. That is a
defensible position, and reversing it is a security **design decision** with a real downside
either way — the kind of call to put in front of a person rather than make silently at 3am.
Recorded as HG-009 with a recommended default.

## IR-015 — `/company` claimed COMPLETE on evidence that did not exist (Terra, A4)

|                 |                                                        |
| --------------- | ------------------------------------------------------ |
| Reviewer        | `gpt-5.6-terra` — reproduced against the real database |
| Subsystem       | `companyXray.assessCompleteness`, EDGAR client         |
| Severity        | **P2** — provenance                                    |
| Status          | **VALID — fixed**                                      |
| Codex re-review | **YES**                                                |

**Reproduction.** All **20** ingest runs in the real database had `providerTotal = NULL` and
`status = SUCCESS`, so `/company/0000320193` told readers "the most recent ingest retrieved
everything the provider reported" when the provider reported no total at all. That is the same
rule this function already states two branches earlier — _absence of a record is not evidence of
completeness_ — applied inconsistently to itself.

**Fixed in both directions, which matters.** Softening the wording alone would have traded a false
claim for a permanently vague one.

1. New `UNCONFIRMED` status, distinct from both COMPLETE and UNKNOWN: the run succeeded and
   reported no shortfall, but there was nothing to check against. Rendered in its own tone, since
   dressing it like a KNOWN shortfall trains readers to ignore both.
2. **EDGAR now supplies a real total.** SEC publishes no single figure but declares the pieces —
   `filings.recent` length plus the `filingCount` of every overflow file, fetched or not. Summing
   them gives `providerTotal`.

**Verified on real data**: the next EDGAR run recorded `providerTotal = 2240, fetched = 2240`.
Exactly matching, which also independently corroborates the earlier 1000-cap fix. Completeness for
filings is now provable rather than assumed; XBRL facts remain `UNCONFIRMED`, correctly, because
companyfacts genuinely publishes no total.

## IR-016 — Same database, two spellings, defeats the test guard (Luna, A6)

|           |                                                      |
| --------- | ---------------------------------------------------- |
| Reviewer  | `gpt-5.6-luna`                                       |
| Subsystem | `tests/support/testDatabaseGuard.mts` — `sameTarget` |
| Severity  | **P2** — contrived, but this guard is P0-critical    |
| Status    | **VALID — fixed**                                    |

`sameTarget` compared host TEXT, so `localhost` and `127.0.0.1` read as different servers. Two
URLs naming one physical database could pass the same-target check, and with a disposable-looking
name the suite would treat a populated database as safe to wipe.

Contrived — but this guard exists because real ingested data was destroyed three times, and the
fix is four lines. Loopback spellings now canonicalise to one form, with the default port applied
so `localhost` and `localhost:5432` match.

**Deliberately a fixed list, not a DNS lookup.** Resolution would make a safety decision depend on
the network, and a guard that behaves differently when DNS is slow is worse than one with a known
blind spot. Unrecognised hosts still compare literally, so the fallback is the old behaviour rather
than a wrong clear. Negative controls pin that two genuinely different databases on one host, and
an unrecognised host, are still allowed.

## Findings recorded but not actioned this round

Valid, reproduced by reading, and deliberately queued rather than changed during freeze:

| Finding                                                                                                                                     | Why deferred                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truncated` is persisted and displayed but never **consumed** — series readers compute changes over possibly-partial FRED/ECOS data (Terra) | Latent: no FRED/ECOS data exists without keys (HG-002/003). Threading completeness into `seriesReadings` is what the Verify layer is for, and Verify already returns TRUNCATED for it. |
| A later SUCCESS masks an earlier truncated run, because `IngestRun` records neither query range nor full-vs-incremental mode (Terra)        | Needs a schema migration to record range/mode. Same hypothesis the Fabric shadow projection raises as `COMPLETENESS_HISTORY`.                                                          |
| Row writes and the `IngestRun` audit row are non-atomic, so a mid-run exception leaves rows with a zero-count FAILED record (Terra)         | Real. Fixing means wrapping ingest in a transaction, which changes ingest behaviour materially — not a freeze-safe change.                                                             |
| EDGAR does not persist `requestsMade` (Terra, P2)                                                                                           | Auditing completeness only; no user-facing effect.                                                                                                                                     |
| Four models have no natural unique key — `EtfHolding`, `RealEstateTransaction`, `Event`, `CausalEdge` (Luna, TOO-WIDE)                      | `Event` clustering is deliberate and `CausalEdge` is curated seed data. The other two have no active ingest path today.                                                                |

**Luna found 0 TOO-NARROW keys across 16 models** — the dimension that produced the 168-discarded-facts
defect is now sound, and `FinancialFact`'s two partial indexes were confirmed correct.

## Luna's matrix result

**67 OK · 11 UNSCOPED-SAFE · 1 UNSCOPED-RISK · 1 OUTPUT-GAP** across every Prisma call site in
`src/`. A discriminating result, not a flag-everything one, which is what makes the two hits
worth acting on.

The UNSCOPED-RISK is `findKnownCorpCodes` (`companyXray.ts:131`) — the watchlist link resolver,
already recorded as a known limitation under IR-002. Unchanged: fixing it means routing
`/company/[corpCode]` by source, which is not a minimal change during freeze.

---

# Independent review of the v2 shadow layers — 2026-08-18

These layers are **shadow-only**: no v1 code imports any of them, verified by search, and no v1
source file changed to accommodate them. Findings are recorded here because the reviews were real
and the corrections were substantive, not because v1 behaviour moved.

## Verify — `gpt-5.6-sol` (financial correctness tier)

**Two P0s and four P1s, all reproduced before any change.**

- **P0** — a `CALCULATION` carrying no calculation returned **VERIFIED**. Every
  calculation-shaped dimension went NOT_APPLICABLE, nothing failed, so the verdict came back
  clean. My own controls had only ever supplied a well-formed calculation, so the empty case was
  never exercised. A verifier that attaches a green label to nothing is worse than no verifier.
- **P0** — `CalculationInput` had **no entity identifier**, so Apple revenue compared against
  Microsoft revenue was not merely undetected, it was _unrepresentable_. The IR-001 class one
  level up: a field that does not exist cannot be checked.
- **P1** — verdict precedence put completeness ahead of correctness, so the +232.9985%
  fabrication computed over a truncated ingest returned `TRUNCATED` — readable as "we are missing
  rows" rather than "this number is wrong", and it would have been filed as a coverage task.
- **P1** — optional `concept` meant two unnamed quantities passed the concept check by skipping
  it. Now `INSUFFICIENT_EVIDENCE`: absence of a concept is not agreement between concepts.
- **P1** — a purely relative percent epsilon undershot the 4dp rounding applied at storage,
  rejecting a correct +0.0000049% change. Absolute floor of 0.00005 added.
- **P1** — refusing every concept change made a legitimate ASC 606 reconciliation
  unrepresentable. It can now be _declared_, surfacing as a disclosed limitation, with a negative
  control proving an undeclared change still fails.

## Governance — `gpt-5.6-terra`

**Seven findings, and the instructive ones all ran the same direction: rules STRICTER than the
document they cited.** Being stricter than the source is not automatically the safe error.

- **P1** — `CALL_PAID_PROVIDER` was `DENIED`, but `CLAUDE.md` says paid external services need
  "explicit human approval — treat as HUMAN GATE". Encoding a gate as a denial looks responsible
  and silently removes a decision the user is entitled to make. Unattended behaviour is identical
  either way, so accuracy costs nothing. Same correction for `PURCHASE_AI_CREDITS` and
  `GIT_HISTORY_REWRITE`.
- **P1** — `EDIT_DOCS` was `AUTO_ALLOWED` on the reasoning that docs affect no runtime behaviour.
  False for the documents that _define_ the rules: an agent able to edit `LEGAL_GUARDRAILS.md`
  can weaken its own constraints. Split out `EDIT_GOVERNING_DOCUMENT`.
- **P1** — `CALL_FREE_PROVIDER` failed **open** on its own rate-limit precondition, so missing
  context produced the _more_ permissive answer.
- **P1** — the `GIT_PUSH` calibration was not a faithful replay. It asserted auto-allow while
  labelling the row HG-001, whose recorded outcome is "blocked on the user authenticating this
  machine". Policy permission and credential availability are now separate.
- **P1** — a red suite produced `DEFERRED_HUMAN_GATE` asking "proceed while verification is
  failing?". `AUTO_ALLOWED_WITH_VERIFY` means it must pass; that is a failed precondition, not
  something a human waves through. Now `DENIED`.
- **P2** — `CREDENTIAL_CHANGE` and `BULK_MESSAGING` were in the contract and in CLAUDE.md's gate
  list but absent from the table, so the engine could not decide them at all.

## Evolution — `gpt-5.6-luna`

**28 ledger entries checked, 28 accurate, zero fidelity errors** — the backfill is honest, which
matters more than anything else here because fabricated history would corrupt the signal the layer
reads. Fourteen documented defects were missing; four were added (`SF-05`, `SF-06`, `EN-03`,
`PD-05`). Five untested detector behaviours were named and are now covered — `worstSeverity`
ordering, subsystem deduplication, a deliberately LOCALISED pair, tie-break stability, and mixed
clustered/isolated input.

**Known limitation, recorded rather than half-fixed:** an entry can genuinely belong to two
categories (Luna identified five), and single-category clustering will split or merge those
wrongly. Supporting secondary categories changes what "instance count" means, so it is a design
decision rather than a patch.

---

# Final Release Candidate adversarial audit — `gpt-5.6-sol`, 2026-08-18

Run over the full `9b34f8b..HEAD` range, read-only, after every other reviewer. It was asked
specifically for what the others missed: interactions between fixes, regressions caused by fixes,
and pages that drop what the domain layer attached.

## IR-017 — The page claimed an amended figure while showing the original — **VALID, fixed**

The finding I asked for by name: **two fixes, each correct alone, wrong together.**

The same-`filedDate` tiebreak orders by `id` ascending so the figures table and the changes table
agree. cuids are roughly monotonic, so ascending id picks the earlier row — the **original**.
Separately, `currentIsRestatement` is true whenever two rows cover one period, and the page says
"the amended value is shown". On a same-day amendment the page therefore displayed the original
under a banner asserting it was the amendment.

Reproduced (`SD-ORIGINAL` selected with the restatement flag set), then fixed at the root: the two
call sites were deriving "which row is current" independently, which is what let them diverge at
all. One exported `compareFactCurrency` now serves both, and an amended form (SEC's `/A` suffix)
wins a same-day tie.

## IR-018 — Completeness ordering was nondeterministic — **VALID, fixed**

`assessCompleteness` ordered runs by `startedAt` alone, a `timestamp(3)`. Two runs starting in the
same millisecond — which two ingest scripts launched together routinely do — are indistinguishable,
so "the most recent run per target" could flip between COMPLETE and KNOWN_INCOMPLETE across
requests. **The same millisecond-resolution trap as the observation revision chain, in a third
place.** Deterministic `id` tiebreak added.

## IR-019 — `/today` dropped provenance the domain layer had attached — **VALID, fixed**

Macro Regime axes rendered `name: value (direction)` — no source, no date — while every other
section on the page names both. `SeriesReading` already carried `sourceCode` and `asOfDate`; the
page simply discarded them. Same class as IR-007/IR-008, in the one place those did not reach.

## IR-020 — "Every date shifts one day backward outside UTC" — **REJECTED**

Reported **P1**, with the claim that it had been _"reproduced against the populated database"_ and
a quoted Company X-Ray output of `2026-03-28 → 2026-06-26`.

It had not been reproduced. Running the real path under Asia/Seoul returns
`2026-06-27T00:00:00.000Z` — exactly midnight UTC — rendering `2026-06-27`. That also matches
IR-004, which checked all 1431 facts for a non-midnight offset and found zero.

Recorded because it is the most useful kind of rejection: **a confident reproduction claim from
the strongest available model, which was simply false.** No code was changed. The standing rule —
reproduce before modifying — is what stopped this becoming a day of chasing a timezone bug that
does not exist.

## Still open from this audit

`A delayed older ingest can become the newest revision` (P1) — not yet reproduced, and not acted
on. Recorded as an unverified hypothesis rather than a finding.

---

## IR-021 — A stale replay rolled a corrected value backward — **VALID, fixed**

|           |                                                         |
| --------- | ------------------------------------------------------- |
| Reviewer  | `gpt-5.6-sol` proposed it; reproduced before any change |
| Subsystem | `src/server/domain/observationIngest.ts`                |
| Severity  | **P1** — a superseded figure served to users            |
| Status    | **VALID — fixed**                                       |

**Hypothesis.** "A delayed older ingest may become the newest revision and roll a correct value
backward." `upsertRevisionAwareObservation` asks only whether an incoming value differs from the
chain tail, which silently assumes whatever arrived last is true.

**Reproduced.** Original 100 → legitimate revision 110 → a replay of 100 returned `revised`, the
tail became 100, and `getRecentObservationPair` served 100 to the read path. The test was written
to record a rejection if it did not occur; it occurred.

Not exotic: a provider CDN serving a stale cached response, a lagging read replica, or a retried
job from an earlier queue all deliver an OLD value at a NEW time.

**Fix.** A value that already appears earlier in the same chain is the signature of a replay and
is no longer applied. Returns a distinct `stale_ignored` status and logs; counted in the FRED and
ECOS tallies rather than dropped.

**Known limitation, deliberate and stated in the code.** A provider genuinely re-correcting back
to a previously reported figure looks identical and is also ignored. Distinguishing them needs the
provider's own vintage — FRED publishes `realtime_start` for exactly this, and
`Observation.releaseDate` exists to hold it — but **no adapter populates it and no key is
available to verify the real semantics**, so ordering on it now would be inventing behaviour.
Of the two available errors, refusing to regress a published figure is visible in the log and the
counts; the other is silent. Resolving it properly is **PROVIDER_KEY_REQUIRED**.

**Controls.** No row is written for the ignored replay (appending one would make it the tail and
reinstate the defect); a genuinely new value still applies, so the guard cannot wedge the chain; a
repeat of the current value is still `unchanged`, so re-ingestion stays idempotent.

**Follow-up, 2026-08-18 — the concept now exists, in shadow.** `src/server/fabric/vintage.ts`
models the missing evidence provider-neutrally: `providerVintageAt`, `sourceReleasedAt`,
`providerRevisionId`, each with an availability state (`KNOWN` / `UNKNOWN` / `NOT_PROVIDED` /
`NOT_VERIFIED`) so an absence records WHY it is absent. `compareVintage` orders by vintage, then by
release, then returns `UNRESOLVED` — `retrievedAt` is deliberately not a rung, and a negative
control fails if it becomes one. Verify gains a `revision_integrity` dimension and a
`SEMANTIC_REVISION_UNRESOLVED` verdict; the Fabric projection raises `REVISED_WITHOUT_VINTAGE` for
any series that has actually been revised without provider evidence, which currently fires for
`ECOS:722Y001:0101000`. None of this changes v1 behaviour — the heuristic guard above is still what
runs. It is still **PROVIDER_KEY_REQUIRED**; what changed is that the shape of the answer is now
written down and tested, so the key is the only thing missing rather than the key and the design.

## Rejected local-AI findings

Recorded because they document the calibration failure, not because they have engineering value.
Full analysis in `docs/LOCAL_AI_CALIBRATION.md`.

| ID        | Model                     | Claim                                                                            | Disposition                                                                                            |
| --------- | ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| LOCAL-001 | `qwen3.5:4b`              | Fixed `computeFinancialFactDiff` "only matches facts with identical `periodEnd`" | **REJECTED** — contradicted by the `<` comparison in the code it was shown                             |
| LOCAL-002 | `qwen3.5:4b`              | Periods with different start dates "cannot be meaningfully compared"             | **REJECTED** — would forbid period-over-period comparison entirely                                     |
| LOCAL-003 | `qwen3.5:4b`, `gemma3:4b` | `parseEdgarDateAsUtc` accepts `"2026-02-30"`                                     | **REJECTED** — executed it: `Date.UTC(2026,1,30)` → `2026-03-02`, `getUTCDate()` = 2, assertion throws |
| LOCAL-004 | `gemma3:4b`               | Defect in fixed diff, EXPECTED and OBSERVED both "returns INSUFFICIENT_DATA"     | **REJECTED** — self-refuting                                                                           |

No code was changed in response to any of these. Zero local-AI findings survived reproduction.

---

## Carry-forward for the Codex audit

1. Review `a0eb92a..HEAD`, not the older packet range — IR-001/002/003 all landed after it.
2. IR-001 and IR-002 share a root cause: **a query keyed on a business identifier that is only
   unique within a source.** The two found here were fixed; the class deserves a systematic sweep
   that a cross-file reviewer (Terra) is better suited to than a bounded one.
3. The interim period had **no independent review**. Local AI produced zero valid findings and two
   demonstrably false ones, so treat this range as reviewed by the author only.
