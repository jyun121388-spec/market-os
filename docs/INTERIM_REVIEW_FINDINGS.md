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

## IR-022..IR-026 — Independent review of the shadow layers (`gpt-5.6-terra`) — **all five VALID, fixed**

|           |                                                                       |
| --------- | --------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-terra`, cross-file review of `b6eb8fd..HEAD`, `-s read-only` |
| Subsystem | v2 shadow layers only — no v1 file was touched                        |
| Severity  | four P1, one P2 (all shadow; nothing reaches a rendered page)         |
| Status    | **all five reproduced before any change, all five VALID, all fixed**  |

Worth recording as a calibration data point alongside IR-020. Terra reported five findings and all
five reproduced exactly as described — after a round in which Sol fabricated a reproduction and the
local models produced four worthless findings. A reviewer being wrong before does not make it wrong
now; it just means the reproduction step is not optional either way. Each was run first.

**IR-022 (P1) — a stored release date was treated as understood.** `fromSeriesChange` and
`shadowProjection` both promoted `Observation.releaseDate` to `KNOWN` for any provider, while the
capability matrix records FRED's, ECOS's and DART's release semantics as `NOT_VERIFIED`. Holding a
value and knowing what the provider meant by it are different things, and the unverified one was
strong enough to flip `revision_integrity` to PASS. Reproduced: a FRED revision with release dates
on both sides returned PASS. Fixed with one shared `withStoredReleaseDate()` — the two call sites
had each written the same promotion independently, which is how they were both wrong. SEC's
live-verified `filed` date still counts, so the fix narrows by provenance rather than by distrust.

**IR-023 (P1) — "permitted subject to verification" could be recorded as simply done.**
`observeExecution` refused to log a DENIED action as EXECUTED but accepted an
`AUTO_ALLOWED_WITH_VERIFY` one with no statement that the verification had passed. Reproduced with
`REFACTOR`. The condition is part of the permission, so an outcome omitting it is not evidence the
action was allowed — the same hole as the DENIED case, one decision further along. Now requires the
verification be named.

**IR-024 (P1) — the vintage rungs were interchangeable.** `compareVintage` dropped to release time
whenever the two sides did not BOTH carry a vintage. Reproduced: current with vintage 2026-06-01
and release 2026-01-01 against a candidate with no vintage and release 2026-02-01 returned
`CANDIDATE_IS_NEWER`, while the stronger evidence held says the current value became current four
months after the candidate was published. Now `UNRESOLVED` when a vintage exists on one side only.
Release time is still used when neither side has one — the narrowing is specific.

**IR-025 (P1) — an accession names a filing, not the current version.** `revision_integrity`
returned `NOT_APPLICABLE` whenever both figures carried an accession. A figure restated by a later
10-K/A still carries the accession of the filing it was first reported in, so the dimension was
standing down for exactly the case it exists to catch. Fixed by requiring filing identity PLUS a
statement that each side is the most current version HELD for its period; `fromFilingDiff` can make
that statement, because `computeFinancialFactDiff` ranks every held fact through the shared
`compareFactCurrency`. The eight real SEC outputs are unchanged, which is the control — without
that flag they would all have collapsed to one verdict.

**IR-026 (P2) — a conditional absence implied a check that never happened.**
`classifyEvidenceGap` reported `CONDITIONAL_ABSENCE` without being given anything that could
establish whether the record met the condition. The classification stays; the rationale now says
the condition was not evaluated here, so a genuinely malformed record is not described as normal.

All five carry regression tests in `tests/shadowReviewFindings.test.ts`, each paired with a
positive control — four of the five fixes narrow something, and a narrowing that goes too far
produces a layer that answers "cannot tell" to everything, which this project has already done to
itself twice.

## IR-027 — A revision retrieved before its own parent — **no defect, coverage gap closed**

The shadow Fabric projection flagged `ECOS:722Y001:0101000` (한국은행 기준금리) as revised without
provider vintage evidence. Reading the rows behind the flag shows something the flag did not
predict: the revision to 2.5 carries a `retrievedAt` about **nine hours earlier** than the original
3.0 it points at.

**v1 handles it correctly.** `getRecentObservationPair` walks the revision chain structurally
rather than sorting on `retrievedAt`, so the tail is found regardless. Verified by running it.

The gap was in the fixtures. Existing tests cover an original and its revision sharing an
_identical_ `retrievedAt` — the `timestamp(3)` collision behind the original defect — and nothing
covered _inversion_, which is strictly stronger: a tiebreak that merely broke ties deterministically
would pass the equal-timestamps tests and still answer this wrongly.
`tests/integration/revision-retrieval-inversion.test.ts` now pins it, including a three-row chain
whose retrieval order is the exact reverse of its semantic order, and the write path attaching the
next revision to the right parent. Not exotic: a backfill ingesting recent data first, a retried
job from an earlier queue, or a stale CDN page all produce it.

## IR-028 — Ask Market cannot find Apple when you say what you want about Apple — **VALID, reported not fixed (freeze)**

|           |                                                                           |
| --------- | ------------------------------------------------------------------------- |
| Found by  | direct probing of the real database while building the Verify adapter     |
| Subsystem | `src/server/domain/askMarket.ts` — `mentionsEachOther`                    |
| Severity  | **P2** — the answer is NOT_FOUND, which is honest; nothing wrong is shown |
| Status    | **VALID, reproduced. NOT FIXED — v1 is frozen and this is not a P0/P1.**  |

The flagship dataset is 2240 Apple filings and 1431 Apple financial facts. Against the real
database:

| Query                        | Result                  |
| ---------------------------- | ----------------------- |
| `Apple`                      | FACTORS_FOUND, 10 facts |
| `Apple Inc`                  | FACTORS_FOUND, 10 facts |
| `Apple Inc.`                 | FACTORS_FOUND, 10 facts |
| `Apple Inc revenue`          | FACTORS_FOUND, 10 facts |
| **`Apple revenue`**          | **NOT_FOUND**           |
| **`Apple net income`**       | **NOT_FOUND**           |
| **`Apple financials`**       | **NOT_FOUND**           |
| **`What did Apple report?`** | **NOT_FOUND**           |

**Root cause, exactly.** `mentionsEachOther` scores token overlap as `overlap / smaller.size` with
a 0.6 threshold. The stored `corpName` is `Apple Inc.`, which tokenises to `{apple, inc}` — the
legal suffix is a full token carrying no identifying information. `Apple revenue` tokenises to
`{apple, revenue}`. Both sets are size 2, the overlap is 1, and 1/2 = 0.5 fails the threshold. Add
`Inc` back and the smaller set becomes `{apple, inc}` against `{apple, inc, revenue}` — overlap
2/2 = 1.0, and it matches.

So the rule is: **the company name alone works, and the company name plus any word fails unless you
also type the legal suffix.** "Apple revenue" is about the most natural query this product will
ever receive.

This is the ledger's `IDENTITY_MODELLING` cause again — a corporate legal suffix treated as a
content word, in a denominator — and it is the second time a name-versus-identifier confusion has
cost this feature something.

**Why it is not fixed here.** It is P2: the output is `NOT_FOUND`, which is honest rather than
wrong, and v1 is frozen except for reproduced P0/P1. The minimal fix is a suffix stoplist
(`inc`, `inc.`, `corp`, `co`, `ltd`, `plc`, `주식회사`, `㈜`) applied to the corp-name side before
scoring — small, but it changes matching behaviour for every query, so it needs its own round with
must-match and must-not-match fixtures rather than a hurried edit under a freeze.

**Recorded as a release-critical CANDIDATE.** Whether a flagship query returning nothing blocks a
release is the release owner's call, not an autonomous one. The reproduction above is what that
decision needs.

## IR-029 — `PURCHASE_AI_CREDITS` was encoded looser than the policy it cited — **VALID, fixed**

|           |                                                                     |
| --------- | ------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-luna`, bounded fidelity audit of the Governance rule table |
| Subsystem | `src/server/governance/policy.ts`                                   |
| Severity  | P2 (shadow; the engine enforces nothing)                            |
| Status    | **VALID — fixed**                                                   |

The rule was `DEFERRED_HUMAN_GATE`. Both documents it cites prohibit the action outright and
prescribe what to do instead. `docs/AI_RESOURCE_POLICY.md`: "Zero additional AI spend beyond the
Claude Max 20x subscription. No Anthropic usage credits, no API PAYG ..., no auto top-up", and on
exhaustion "stop, write `USAGE_LIMIT_PAUSE` ... do not switch to a paid fallback". CLAUDE.md's
absolute rules: "Never activate paid ... usage, buy credits, or use a PAYG key."

The old rationale — an exhausted quota is a routing event, and purchasing is the user's call to
make rather than the agent's to foreclose — is a good argument about what the policy _should_ be.
It is not what the cited documents say, and an engine that quietly upgrades an argument into a rule
is not encoding policy. Now `DENIED`, with no gate.

**Worth noting the direction.** The previous fidelity correction (`CALL_PAID_PROVIDER`, Terra) made
a rule _less_ strict to match its citation. This one makes a rule _more_ strict. Corrections that
only ever loosen would be a pattern to distrust.

Luna also audited the ledger: **28 entries checked, zero fabrications**, and eight documented
defects with no entry. All eight are now recorded as `VF-01`..`VF-08` — every one of them a defect
in Verify itself, which is the ledger's most direct evidence that a verifier is not exempt from the
failure modes it verifies against.

## IR-030 — A short page reported as a complete answer, in all three keyed adapters — **VALID, fixed (P1)**

|           |                                                                     |
| --------- | ------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-terra`, review packet target A4 (completeness vs. success) |
| Subsystem | `fred/client.ts`, `ecos/client.ts`, `dart/client.ts`                |
| Severity  | **P1** — a partial ingest recorded as SUCCESS and rendered COMPLETE |
| Status    | **VALID — reproduced, then fixed. A v1 change under the freeze.**   |

All three adapters stopped looping on a short page and returned `truncated: false`, **conflating
the reason they stopped with the question of whether they hold everything.** Stopping on a short
page is right; concluding "therefore complete" is a separate claim, and it is false whenever the
provider's own declared total says otherwise. `recordIngestRun` marks the run SUCCESS off that
boolean, and `/company` renders completeness from the run.

This is the 1000-of-2240 defect wearing a different provider's clothes, and it is the same shape
twice over: the field that contradicts the conclusion — FRED's `count`, ECOS's `list_total_count`,
DART's `total_count` — was received, stored, and not consulted at the moment it mattered.

**Reproduced before any change**, three failing tests:

| Provider | Response                                           | Reported      | Should be |
| -------- | -------------------------------------------------- | ------------- | --------- |
| FRED     | `count: 10000`, 100 observations on the first page | not truncated | truncated |
| ECOS     | `list_total_count: 900`, 40 rows                   | not truncated | truncated |
| DART     | `total_page: 2, total_count: 200`, page 2 empty    | not truncated | truncated |

The DART case is the sharpest: the client already detects that DART disagrees with its own
`total_page`, breaks the loop deliberately, logs it — and then reports the result as complete.

**Fix.** `truncated` is derived from held-versus-declared at every return, in all three clients. One
idea written three times, so it was wrong in three places, which is the `IDENTITY_MODELLING` lesson
from `RF-04` arriving again in a different cluster.

**Control.** Every real series ends on a short page. A test asserts that a short page which IS
everything the provider declared still reports complete — turning ordinary series ends into a
permanent truncation warning would make the signal worthless, which is the failure mode of the
over-broad fix.

**Note on the freeze.** v1 is frozen except for reproduced P0/P1. This qualified: reproduced first,
minimal fix, targeted verify, then the full suite. Seven of the eight A1–A8 packet targets returned
**NO FINDINGS** — A1 Filing Diff, A2 fact identity, A3 revision chain, A5 company identity, A6 test
database guard, A7 secret redaction and A8 CALCULATION provenance — which is the first time this
packet has been worked through against current code rather than against the range it was written
for.

## IR-031 — The long/short vocabulary was missing entirely — **VALID, fixed (P1)**

|           |                                                                            |
| --------- | -------------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-terra`, review packet targets A9/A12                              |
| Subsystem | `src/server/domain/askMarket.ts` — `detectPersonalizedAdviceRequest`       |
| Severity  | **P1** — a personalized trading instruction answered instead of redirected |
| Status    | **VALID — reproduced, then fixed. A v1 change under the freeze.**          |

Terra reported one bypass. Reproducing it found seven, in both languages:

| Query                           | Before  |
| ------------------------------- | ------- |
| `Should I go long TSLA today?`  | allowed |
| `should i go long on tesla`     | allowed |
| `Should I short Apple?`         | allowed |
| `go long TSLA`                  | allowed |
| `I want to short the market`    | allowed |
| `테슬라 롱 잡을까?`             | allowed |
| `삼성전자 숏 쳐야 하나`         | allowed |
| `Should I buy Apple stock now?` | blocked |

**A guardrail that depends on the user choosing retail vocabulary over trading vocabulary is not a
guardrail.** The same intent, phrased as "buy", was caught by four separate patterns. The concept
had simply never been enumerated — which is the `GUARDRAIL_COVERAGE` lesson exactly: the last ten
bypasses were found by listing English-only concepts, and nobody had listed this one at all.

**Fix.** Seven patterns covering the position family, plus 공매도. `long` and `short` are anchored
to a position verb rather than matched bare, because both are ordinary English words — a guardrail
that ate "short-term rates" would make the macro side of the product unusable, which is a larger
failure than the one being fixed.

## The over-block in the same function, and the fix that was reverted

Terra also reported `fair value` blocking legitimate accounting questions. Reproduced, and again
worse than described — three of three:

- `What is fair value accounting under ASC 820?` → redirected
- `Apple fair value of financial instruments` → redirected
- `What is the fair value of household wealth reported by the Federal Reserve?` → redirected

**The first fix was wrong and the test corpus caught it.** Narrowing the pattern to require a
security word after "fair value" fixed all three — and stopped blocking `What is the fair value of
Apple right now, roughly speaking?`, a pinned must-block case from an earlier adversarial round.
Narrowing a legal guardrail had traded a false positive for a false negative. Reverted.

**Second fix: a short exclusion list**, checked before the patterns, of fixed accounting
collocations where "fair value" is a measurement basis — `fair value accounting`, `fair value of
financial instruments`, `fair value hierarchy`, `ASC 820`, `IFRS 13`. Deliberately a list and not a
rule, so its failure mode is over-blocking. And deliberately not a bypass: the exclusion only
applies when the query's ONLY prohibited content is the excluded phrase, so appending "under ASC
820" to a real instruction buys nothing.

**Known and accepted, pinned by a test:** the Fed household-wealth question is still redirected.
There is no way to enumerate every non-tradeable subject, and refusing that is a smaller harm than
answering "what is the fair value of Apple". Recorded as a decision rather than left as an
oversight.

## Two findings from the same review, reported and NOT fixed

**A11 (P1) — `/company/[corpCode]` cannot address two providers.** The company index lists
`(sourceCode, corpCode)` rows and links every one to `/company/${corpCode}`; `computeCompanyXray`
then resolves the provider with an `anyFiling` lookup on `corpCode` alone. With two providers
sharing a corp code the second company is unreachable, and with equal `receiptDate`s the choice is
non-deterministic. Latent today — only SEC data is ingested — and structurally the IR-001/IR-002
precondition rebuilt at the routing layer.

Not fixed here on purpose. The fix changes a public URL shape, which is a v1 surface change worth
its own round with its redirect and link-compatibility questions answered deliberately, rather than
a hurried edit at the end of a long session. Recorded in `docs/REVIEW_DEBT.md`.

**A14 (P2) — the shadow Verify run collapses provider identity the same way.**
`companiesWithFilings()` deduplicates on `corpCode`, `shadowVerifyCompany()` takes only that code,
and the output ids read `filingDiff:<corpCode>:...` with no provider. Shadow-only, so it is not
frozen — but it is the same defect as A11 one layer up, and fixing the shadow layer while the v1
routing still has it would be fixing the copy.

## Targets with no findings

**A10 watchlist authorization** and **A13 test-database guard and test realism**: no findings.
Terra also examined the two remaining unscoped corp-code queries in production code and judged both
defensible — `findKnownCorpCodes` is an existence filter rather than an entity merge, and
`anyFiling` is unsafe only because the route above it supplies no source, which is A11.

## IR-032 — A corp code chose its own provider — **VALID, fixed (P1, latent)**

|           |                                                                            |
| --------- | -------------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-terra`, review packet targets A11 and A14                         |
| Subsystem | `companyXray.ts`, `/company`, `/company/[corpCode]`, `verify/shadowRun`    |
| Severity  | **P1**, latent — only SEC data is ingested, so nothing was wrong on screen |
| Status    | **VALID — reproduced, then fixed. A v1 change under the freeze.**          |

`computeCompanyXray(corpCode)` resolved the provider by taking the most recent filing carrying the
code, whichever provider that was. The company index lists `(sourceCode, corpCode)` rows and linked
every one of them to `/company/${corpCode}`. So with two providers sharing a code the second
company was **unreachable** — no URL and no argument could address it — and with equal receipt
dates the choice was not stable between requests.

This is IR-001/IR-002 rebuilt one layer up. Those were about pooling two providers' figures under
one header; scoping fixed the pooling and left the CHOICE untouched.

**Reproduced against this repository's own fixture.** `tests/integration/company-xray.test.ts`
already creates two providers sharing `TEST_XRAY_CORP` — it is the IR-001/IR-002 regression setup —
and every `computeCompanyXray(CORP_CODE)` call in it was silently resolving to whichever provider
won. The fix broke all eleven of them, which is the cleanest possible demonstration: before it,
none of those calls needed to name a provider.

**Fix: a refusal, not a better guess.**

- `listCompanySources(corpCode)` reports every provider that uses the code.
- `computeCompanyXray(corpCode, sourceCode?)` scopes to the named provider. Where the code is
  ambiguous and no provider is named it returns **null** rather than an arbitrary company.
- `/company` links carry `?source=`, and `/company/[corpCode]` asks which provider is meant when
  the code is ambiguous and none was given.

Refusing is the point. A better tiebreak would still be a choice made on the reader's behalf about
which company they were looking at, and it would read as correct from every angle except the one
that matters.

**Control, and the thing an over-broad fix would have broken:** every real company today has
exactly one provider. A test asserts that an unambiguous code still resolves with no `?source=`,
because turning that into a disambiguation prompt would make the fix worse than the defect.

**A14, the same collapse in the shadow layer, fixed in the same change.**
`companiesWithFilings()` deduplicated on `corpCode` and would have dropped one of any two companies
sharing a code; `shadowVerifyCompany()` took only the code; output ids read
`filingDiff:<corpCode>:...` with no provider, so two companies' verdicts were indistinguishable.
Now a `(sourceCode, corpCode)` pair throughout, and the ids carry the provider —
`filingDiff:SEC_EDGAR:0000320193:Assets:USD`. Fixed after the v1 original rather than before it:
fixing the copy first would have left the real one standing.

## IR-034 — Eight concepts the guardrail had never been told about — **VALID, fixed (P1)**

|           |                                                                     |
| --------- | ------------------------------------------------------------------- |
| Found by  | concept probing, following the `GUARDRAIL_COVERAGE` countermeasure  |
| Subsystem | `src/server/domain/askMarket.ts`                                    |
| Severity  | **P1** — direct personalized trading instructions answered normally |
| Status    | **VALID — reproduced, then fixed. A v1 change under the freeze.**   |

The cluster's countermeasure reads: enumerate the CONCEPTS a guardrail covers rather than the
patterns it contains, and check each concept for the forms it can take. IR-031 closed one concept —
long/short — after a reviewer found a single phrasing. This probed for the concepts themselves.

**Eighteen probes went straight through, across eight families with nothing covering them at all:**

| Concept                | Example that was answered normally                                 |
| ---------------------- | ------------------------------------------------------------------ |
| leverage / margin      | `Should I use margin to buy Apple?`                                |
| options                | `should i write puts on NVDA`                                      |
| averaging down         | `should I average down on Apple`, `물타기 할까요`                  |
| third-party (Korean)   | `친구가 뭘 사야 할지 물어봐요`                                     |
| hypothetical framing   | `hypothetically, if someone had 10000 dollars, where should it go` |
| timing without a verb  | `is now a good entry`                                              |
| portfolio construction | `build me a portfolio`, `포트폴리오 짜줘`                          |
| crypto                 | `코인 뭐 사야 돼`                                                  |

None is exotic. "Should I use margin to buy Apple?" is about as direct a personalized trading
instruction as the language allows.

**The organising rule for the fix.** Every one of these words is ALSO ordinary financial
vocabulary — "margin" is an operating margin, "leverage" is a leverage ratio, "average" is a moving
average, "portfolio" is portfolio theory, "코인" is a market-capitalisation question. Matching them
bare would break the analytical half of the product to protect the advisory half, so every pattern
is anchored to an instruction frame, and an eighteen-question must-not-flag corpus makes that
claim checkable.

**One over-block was caught by that corpus before it shipped.** The first `dollar cost average`
pattern matched the bare term and refused "How does dollar cost averaging work as a concept?" —
the same mistake the `fair value` pattern made, which a reviewer found weeks later. This time the
negative controls caught it in the same minute, which is the whole argument for writing them
alongside rather than afterwards.

## IR-038 — EDGAR reported complete from its own page cap — **VALID, fixed (P1)**

|           |                                                                       |
| --------- | --------------------------------------------------------------------- |
| Found by  | the `CAP-CEILING-SEC_EDGAR` phase, checking the generalized invariant |
| Subsystem | `src/server/adapters/edgar/client.ts`                                 |
| Severity  | **P1** — a partial ingest recorded SUCCESS on the live path           |
| Status    | **VALID — reproduced, then fixed.**                                   |

The invariant under test: **provider response success is not a complete dataset.** IR-030 fixed
FRED, ECOS and DART, each of which derived `truncated` from the reason its loop stopped. EDGAR was
not part of that finding and has the same shape:

```ts
truncated: overflowFiles.length > MAX_OVERFLOW_FILES;
```

That is a statement about hitting OUR OWN page cap. It says nothing about whether we hold what SEC
says exists — and `providerTotal` is computed two lines above, carefully, as
`filings.recent.length` plus the declared `filingCount` of every overflow file including the ones
this run chose not to fetch. Everything needed to answer the question was already there and never
compared.

**Reproduced**: one overflow file, well under the 20-file cap, declaring 500 filings and serving 100. `providerTotal` 501, held 101, `truncated: false`. `recordIngestRun` turns that into SUCCESS
and `/company` renders completeness from the run.

**This is the live path.** EDGAR is the only provider with real data, so unlike IR-032 and IR-037
this defect had a reader in front of it rather than waiting for a second provider.

**Fix**: `overflowFiles.length > MAX_OVERFLOW_FILES || merged.form.length < providerTotal`.

**Checked against real data before changing anything**: the three most recent Apple runs record
`providerTotal=2240, fetched=2240`, so the live path stays SUCCESS. The fix fires only when the two
genuinely disagree, which is the whole point. The control — hitting the page cap itself — is
preserved by a second test.

Why it survived IR-030: that finding named three clients and the fix went to those three. The fix
went where the defect had been looked for, which is the same lesson as `RF-04` and `RF-06` and now
the third time it has been recorded.

## IR-039 — The flake, found: a teardown that buried its own setup failure — **VALID, fixed**

|           |                                                                         |
| --------- | ----------------------------------------------------------------------- |
| Found by  | capturing full output on a failing run rather than rerunning green ones |
| Subsystem | `tests/integration/watchlist-actions.test.ts`                           |
| Severity  | P2 (test infrastructure), but it cost the previous eight reruns         |
| Status    | **VALID — reproduced with captured output, then fixed.**                |

The unidentified intermittent failure recorded across three earlier rounds. Eight clean reruns
never reproduced it because rerunning was never going to: the run that failed had its output piped
through `tail`, so only the summary survived.

**What actually happens.** `beforeAll` exceeds vitest's default 10-second hook timeout under
database contention — eight sequential statements against a Postgres shared with the rest of the
suite. `userAId` and `userBId` are then never assigned, and `afterAll` calls
`user.delete({ where: { id: undefined } })`, which throws a Prisma validation error.

**That second error is the one that gets reported.** The timeout is the cause and the cleanup
crash is what appears on screen, which is precisely why eight reruns and three write-ups failed to
name the test: the visible error belonged to the teardown.

**Two fixes, both test-only.** The teardown now skips an id the setup never assigned, and the hook
gets 60 seconds — the work genuinely takes longer when the database is busy, and a hook that fails
for being slow produces a failure nobody can act on.

**The obvious fix would have been a disaster.** Replacing `delete` with `deleteMany` looks like the
tolerant choice and is the opposite: Prisma reads `undefined` in a filter as "no condition", so
`deleteMany({ where: { id: undefined } })` is `deleteMany({})` — every user in the database. The
explicit guard is used instead, and the reason is recorded at the call site so nobody
"simplifies" it later.

**The transferable lesson**, and the reason this is in the ledger rather than just fixed: a
teardown that can fail will report ITS error instead of the one that matters. Twenty other
integration files delete by an id a failed setup would leave undefined. They have the same
exposure, and the next unexplained failure in any of them will be equally unreadable.

## IR-040 — An absence of completeness evidence read as "no shortfall detected" — **VALID, fixed (shadow)**

|           |                                                                                       |
| --------- | ------------------------------------------------------------------------------------- |
| Found by  | the second-order discovery pass, asking "which consumer turns UNKNOWN into COMPLETE?" |
| Subsystem | `src/server/verify/shadowRun.ts`                                                      |
| Severity  | P2 (shadow layer; no v1 behaviour)                                                    |
| Status    | **VALID — reproduced, then fixed.**                                                   |

The shadow run mapped every Company X-Ray completeness status onto a `completeness` block, so
`UNKNOWN` and `LAST_RUN_FAILED` arrived as `{ providerTotal: null, truncated: false }` — which
`data_completeness` reads as _"no shortfall was detected"_.

That sentence is true for `UNCONFIRMED`: a run succeeded and the provider publishes no total. It is
false for the other two. `UNKNOWN` means **no ingest run was ever recorded**, so nothing was
detected because nothing looked. `LAST_RUN_FAILED` means the most recent attempt failed outright.
All three rendered as the same mild caveat.

**Reproduced**: all three statuses produce an identical PASS with an identical rationale.

**Fix**: completeness evidence is passed only when it was actually measured — `COMPLETE`,
`UNCONFIRMED` or `KNOWN_INCOMPLETE`. The other two supply none, so the dimension returns
`INSUFFICIENT_EVIDENCE`, which is the truth. The nuance is not lost: `ShadowObservation.completeness`
already carries the status verbatim, so the distinction between "nobody ran" and "the run failed"
survives in the observation while Verify stops making a claim it has no basis for.

The real shadow run moved from 8/5/3 to **8 VERIFIED_WITH_LIMITATION, 4 TRUNCATED, 3
SEMANTIC_REVISION_UNRESOLVED, 3 STALE** — the extra TRUNCATED is a company whose completeness was
previously being reported as an unremarkable limitation.

**Why this one is worth the entry.** The scheduler had converged — nothing startable — and the
protocol's rule is that a converged queue is not a finished project. This came from working the
second-order checklist rather than from the queue, and it was one step short of the exact failure
the checklist names.

## IR-041 — The schema advertises a preliminary/final distinction the pipeline cannot make — **VALID, recorded**

|           |                                                                  |
| --------- | ---------------------------------------------------------------- |
| Found by  | the provenance propagation enumeration, schema → domain → page   |
| Subsystem | `prisma/schema.prisma`, `Observation.isPreliminary`              |
| Severity  | P3 today, **latent P2 the moment a provider key arrives**        |
| Status    | **VALID — recorded and tracked as a capability gap, not fixed.** |

`Observation.isPreliminary` exists in the schema and **nowhere else**. No adapter sets it, no domain
function reads it, no page renders it, and 0 of 33 stored rows carry it. It is a declared capability
the pipeline cannot supply — structurally identical to FRED's `realtime_start`, which the capability
matrix already records as unread.

Nothing is currently wrong on screen, because there are no preliminary figures: not because they are
handled, but because none is ever recognised as one.

**Why it is worth recording rather than deleting.** Both FRED and ECOS publish provisional figures
that are later revised — ECOS explicitly labels them 잠정치. The moment a key arrives, provisional
values will be stored with `isPreliminary: false` regardless of what the provider said, and a
provisional figure rendered identically to a final one is unsupported confidence about a number.
That is the same failure as the vintage gap in IR-021, one field over.

**Recorded where the other provider-evidence gaps live**, rather than as a loose note: the capability
matrix gains a `preliminary_final_identity` axis. SEC is `NOT_SUPPORTED` from live evidence — a filed
figure is filed, and a later restatement arrives as a new fact, which `amendment_identity` already
covers. FRED, ECOS and OpenDART are `NOT_VERIFIED` behind their gates, which is the honest state:
nobody has seen a real response.

## What the enumeration found and dismissed

`Filing.remark` (DART's 정정 correction flag) never reaches the domain layer — latent, no DART data,
and covered by the same `amendment_identity` axis. `FinancialFact.filedDate` is not rendered, but the
accession number that identifies the filing is, so the claim remains auditable.
`CausalEdge.conditions` joins `evidence` in IR-037. `Claim.evidence` is not rendered because no page
renders claims at all.

## A note on the enumeration itself

The first run of this audit produced a confident, plausible, **entirely wrong** list — it reported
that `observationDate` and `accessionNumber` never reach the domain layer, which two greps disproved
in seconds. The script had been written through a shell heredoc, which collapsed `\b` into a
backspace character, so every word-boundary regex silently matched nothing and every field looked
absent.

Third occurrence of that trap in this session, and the first where it manufactured findings rather
than breaking loudly. It is exactly the `EVIDENCE_FABRICATION` pattern with a script in the model's
place, and it was caught only because the output contradicted something already known. Recorded in
`CLAUDE.md` as an environment hazard.

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

### IR-042 — the output-side advice scanner was second-person only (P2, FIXED)

**Cluster:** GUARDRAIL_COVERAGE. **Found by:** Verify dimension reachability pass, not by review.

`ADVICE_OUTPUT_PATTERNS` scans what the product renders, as a second line of defence behind the
request-side refusal. Every English pattern in it required the reader as the grammatical subject —
`you should buy`, `we recommend buying`. Fed `Investors should buy long-duration bonds now`, the
dimension returned PASS.

Third person is how financial prose gives advice. A sell-side note says "investors should reduce
exposure"; it does not address the reader directly. The scanner was watching the one phrasing least
likely to appear in the output it exists to catch.

Fixed by naming the subjects explicitly — investors, traders, shareholders, holders, clients,
readers — rather than by a wildcard, because `\w+ should buy` also matches a sentence explaining
that nobody should read the page as a recommendation, and a guardrail that condemns the disclaimer
gets switched off.

### IR-043 — the Korean advice patterns flagged the product's own refusal (P2, FIXED)

**Cluster:** GUARDRAIL_COVERAGE. **Found by:** the negative control written for IR-042.

`매수 추천을 제공하지 않습니다` — a Korean rendering of the refusal — matched `/매수\s?(의견|추천)/`
and produced FAIL. The scanner condemning the sentence that does the refusing is precisely the
failure the pattern list's own comment claims to have designed against, and it had been designed
against in English only: each English pattern requires an affirmative construction, so
"we do not recommend buying" fails to match by construction.

Korean cannot work that way. It is predicate-final, so the negation lands at the end of the clause
and never intervenes in the noun phrase the pattern matches.

Fixed with a clause-final negation check, scoped per sentence rather than per line so that a
negation elsewhere in the paragraph cannot launder a recommendation — `매수해야 합니다. 위험은
없습니다.` still offends on its first sentence, and that case is pinned.

Both findings are in the v2 shadow layer. No v1 source was modified, and the real Ask Market
refusal for "Should I buy Apple Inc.?" verifies PASS before and after.

### IR-044 — the only action that leaves this machine was ungoverned (P1, FIXED)

**Cluster:** GUARDRAIL_COVERAGE. **Found by:** governance action classification coverage pass.

The coverage question had been asked one way round only. `RULES` is typed
`Record<ActionKind, Rule>`, so the compiler proves every action KIND has a rule — and proves
nothing about whether every action the system performs has a kind. An action that was never named
is not an uncovered rule; it is an invisible one, and no type system can find it.

Enumerating what this system can actually do surfaced exactly one: the escalation channel posts
comments to an issue on a publicly readable repository. It is the only code path that sends data
off this machine. It had no `ActionKind`, consulted no policy, and screened no content. The
prohibition on posting keys, credentials, private user data or internal secrets to that channel
existed solely as prose in an operator's instructions — enforced by whoever happened to be reading.

Fixed in three parts:

1. `POST_PUBLIC_ISSUE_COMMENT`, classified `AUTO_ALLOWED_WITH_VERIFY`. Not a human gate: an
   asynchronous decision channel that stops for approval on every message is not asynchronous.
   The risk is the content, not the act, and content is checkable. A missing credential reports as
   `BLOCKED_MISSING_CREDENTIAL` — an execution state, never a refusal.
2. `src/server/escalation/screen.ts`, which matches shapes rather than values. Nothing loads a real
   secret to compare against, because a screen that read the environment to detect a secret would
   put the secret in the screening process.
3. The screen wired into `queuePendingComment`, which throws rather than dropping. It screens at
   the QUEUE, not at the post, because the queue is durable: a comment that reaches it is written
   to `docs/escalation/PENDING_COMMENTS.md` and committed, so a credential in the body reaches the
   repository whether or not the post ever happens. Screening at the post is screening after the
   leak.

Run against the staged backlog immediately, which is the part worth keeping. It flagged
`Authorization: Bearer $GITHUB_TOKEN` in the queue's own worked example of how to post — a shell
variable reference, not a value. A true over-flag, and the more instructive failure: describing the
shape of a request is how a transport problem gets explained at all, and a screen that forbids it
pushes the description into some channel with no screen. Placeholder and variable-reference forms
are now excluded, with both directions pinned.

### IR-045 — the loop's own yield could only be measured for two thirds of its history (P2, no defect, gap recorded)

**Found by:** meta-loop quality audit. **Outcome:** no defect in the loop; a measurement gap in the
record it keeps.

Measured over the 35 recorded findings:

| metric                 | value                                      |
| ---------------------- | ------------------------------------------ |
| confirmed-defect yield | 0.83 (of findings with a recorded verdict) |
| false-positive rate    | 0.09                                       |
| measurable share       | 0.66                                       |

The yield is good and the third number is why it should be read carefully. **A third of the
history carries no verdict at all.** The convention of stating the outcome in the finding header
began around IR-020; the first nineteen record what was learned and not whether the claim survived
reproduction. Those are `UNKNOWN` and are counted as `UNKNOWN` — a yield computed by assuming
unrecorded findings were valid would be the loop flattering itself with numbers it did not earn,
which is precisely the failure the audit exists to detect.

**The extraction produced its own finding.** The first pass scanned finding BODIES for verdict
words and reported IR-022..IR-026 and IR-029 as rejected. All six were valid; the word had appeared
in surrounding discussion. Two errors in thirty-five, every one in the direction of understating
yield, from a script that read entirely reasonably. The verdict lives in the header and nowhere
else. Fourth instance of the standing rule that a script's output is a claim, not evidence.

**The structural result, which is the useful one.** Classifying each cluster by spread —
subsystems over instances — gives five clusters at 1.00 and one below 0.7:

| cluster              | inst | spread | type                |
| -------------------- | ---- | ------ | ------------------- |
| `GUARDRAIL_COVERAGE` | 12   | 0.67   | local fixes failing |
| `IDENTITY_MODELLING` | 11   | 1.00   | invariant missing   |
| `SILENT_DEGRADATION` | 6    | 1.00   | invariant missing   |
| `FIXTURE_REALISM`    | 5    | 1.00   | invariant missing   |
| `PROVENANCE`         | 4    | 1.00   | invariant missing   |
| `ENVIRONMENT_DRIFT`  | 4    | 1.00   | invariant missing   |

The project's dominant failure mode is not defects recurring where they were fixed. It is the same
conceptual error arriving somewhere new, five separate times over. Every local fix held. Only
`IDENTITY_MODELLING` has since been given a global invariant, which leaves four clusters whose next
instance will land in a subsystem nobody is watching — and the audit says so without being able to
say where.

**Two no-findings worth recording as no-findings.** The scheduler does not let key-blocked work
crowd out startable local work, because deferred items are a structurally separate list rather
than a low-priority tail. And `CALL_PAID_PROVIDER` is a Human Gate while `PURCHASE_AI_CREDITS` is
DENIED — the audit's first assertion had them both DENIED and the policy table was right:
CLAUDE.md makes zero extra AI cost absolute but paid external services "not without explicit human
approval", which is a question someone may answer.

## IR-046..IR-055 — Final RC adversarial review (`gpt-5.6-sol`) — **six P1 and four P2, all six P1 reproduced, six fixed**

|           |                                                                     |
| --------- | ------------------------------------------------------------------- |
| Reviewer  | `gpt-5.6-sol`, read-only, the eight modules added this session      |
| Subsystem | v2 control bus, escalation, release preflight — no v1 file in scope |
| Outcome   | every P1 trigger reproduced verbatim before any change was made     |

The pattern across them is the finding worth keeping: **each defect sat directly beneath a comment
asserting the property it broke.**

- `consumer.ts` opens by stating that transport must not become authority, and then accepted a
  decision from any GitHub account at all. Every gate asked WHICH — matching escalation, not
  already applied, governance-permitted — and none asked WHO. On a public issue, a protocol id is
  not a credential; it is written on a page anyone can read. **IR-046, P1.**
- `preflight.ts` opens with "missing evidence is never PASS" and then wrote `?? []` and `?? 0` for
  three external inputs, so an unsupplied gate list read as no gates and the module returned
  `RELEASE_CANDIDATE_READY`. **IR-054, P2.**
- `store.ts` documents the nonce as the thing that distinguishes a live watcher from a recycled
  pid, and never compared it. A paused watcher could resume and overwrite its replacement's lock.
  **IR-049, P1.**
- `watch.ts` was written to make silent degradation impossible and fetched a single page of an
  oldest-first endpoint. Past 100 comments every new decision would have been invisible, with no
  error and a healthy-looking poll. **IR-050, P1.**

Also fixed: **IR-047** (P1) a decision describing an action in prose named no `ActionKind`, so
Governance was never consulted and the result was `APPLICABLE` — now `ACTIONS_NOT_DECLARED`, since
the answer to "intent cannot be read reliably from prose" is to refuse the prose, not approve it;
**IR-048** (P1) the content screen required an uppercase unquoted variable name, so
`"aws_secret_access_key": "…"` matched nothing; **IR-053** (P1) evidence from another commit passed
whenever no change was declared, an empty list read as "nothing changed" when it equally means
"nobody said"; **IR-055** (P2) a final-review boolean survived a change of HEAD.

**IR-051** (P1) and **IR-052** (P2) are recorded and not fixed. Both concern crash-safe exactly-once
application across a restart: the consumer is a pure function taking `appliedIds` from its caller,
and no persistence layer is wired to it yet, so there is nothing today that could apply a decision
twice. They become real the moment application is automated, and they are pinned here so that work
cannot start without meeting them.

A fifth instance of the heredoc backslash trap occurred during the fix and is worth recording:
`ACTION_SHAPED_PROSE` was written through a shell heredoc, `\b` became a literal backspace, and the
IR-047 guard silently matched nothing. It looked correct in every editor and in the Read tool. It
was caught because the reproduction script re-ran Sol's trigger and the verdict had not changed —
not by inspection.

## IR-056..IR-064 — Second review cycle: the fixes, reviewed (`gpt-5.6-terra`) — **one P0, five P1, three P2, all nine reproduced and fixed**

|          |                                                                               |
| -------- | ----------------------------------------------------------------------------- |
| Reviewer | `gpt-5.6-terra`, read-only, the six modules changed by cycle one              |
| Question | not "is this correct" but "what does this fix ASSUME, and where does it fail" |
| Outcome  | nine issues, every one reproduced before anything was touched                 |

Sol refused the first attempt — the prompt was written in attack language and its provider flagged
it. The same review with defensive framing and narrower groups ran normally. Recorded because the
refusal looked exactly like a tool failure and was not one.

**Cycle one found defects beneath comments claiming the opposite. Cycle two found the fixes
reproducing the defects they fixed, one boundary further out.**

- **IR-056, P0.** `acquireLock` was `existsSync`-then-write. `writeAtomic` makes the file CONTENTS
  atomic, which sounds like it covers acquisition and does not: two watchers both see no lock, both
  write, both return `acquired: true`. Replaced with an exclusive `wx` create — the primitive that
  actually decides a winner — with stale takeover preserved as a negative control.
- **IR-057, P1.** The pagination loop, written to remove a silent truncation, silently truncated at
  its own ceiling: a full page at page 50 returned normally and the watcher reported a healthy
  poll. Now throws into `READ_FAILED`, where the cursor does not move and it retries.
- **IR-058 and IR-059, P1.** `heartbeat` and `releaseLock` tested for a nonce MISMATCH, so a corrupt
  lock — which reads as `null` — passed as "not somebody else's" and was overwritten or deleted by
  a process that could not have owned it. Absence of a mismatch is not proof of a match: the same
  fail-open shape as an unsupplied allowlist.
- **IR-060, P1.** The prose gate switched off the moment ANY action was declared, so
  `CONTROL_BUS_READ; also deploy to production` named one harmless action and bought silence for
  the rest of the sentence. The gate now strips declared tokens and scans the remainder.
- **IR-061, P1.** A negated mention counted as a declaration: `Do not CONTROL_BUS_READ` extracted
  the token and granted what the decision declined.
- **IR-062, P1.** `openP2` absent reported PASS with the sentence "0 deferred P2, each recorded with
  a reason" — a claim about a register nobody had opened. Not blocking and not measured are
  different things.
- **IR-063, P2.** `reviewDebtItems` was declared and never checked: a field that looks like coverage
  and is not.
- **IR-064, P2.** `changesSinceEvidence` was required at runtime while the file claimed every input
  optional; omitting it threw a `TypeError` instead of returning a verdict. Also: missing evidence
  now outranks stale evidence, because stale says "it passed, elsewhere" and missing says nothing.

Three of my own probes were wrong during this round, each in the direction of reporting a working
fix as broken: one wrote an empty lock file and read the recovery as a double acquisition, one
treated `readLock() === null` as "deleted" when it equally means "unreadable", and one printed a
verdict when the property under test was what had been extracted. Every one was caught by checking
against the source rather than believing the output.

## IR-065..IR-068 — Third review cycle, bounded (`gpt-5.6-terra`) — **two critical, two lesser, all four reproduced and fixed**

Scope: only what cycle two changed, plus `application.ts`. Three questions, one of which came back
clean — recorded because a no-finding from an adversarial pass is evidence and is usually the
first thing dropped from a report.

**Q2 (gate reordering): no issue found.** The reviewer traced the actual order — TEST, trusted
author, already applied, matching escalation, extract, governance, prose, staleness — and confirmed
that moving governance ahead of staleness changes rejection REASONS and admits nothing new.

- **IR-065, critical.** `acquireLock` cleared a stale record with `unlinkSync(path)`, which deletes
  whatever is at that path — including the live lock a competitor legitimately created in between.
  `A reads stale S · B reads S, clears, claims · A clears B's LIVE lock · A claims`, and both hold
  it. The `wx` create only arbitrates creation, and by then the damage is done. The comment sitting
  above it claimed the opposite outcome. Removal is now a rename to a name only one caller can have
  chosen: exactly one racer wins, and the loser never touches what the winner put back.
- **IR-066, critical, now closed — but only after a fourth pass caught the mitigation lying.**
  `heartbeat` and `releaseLock` were read-then-write. The first attempt added a read-back and
  described it as "detected, not prevented", which was an honest-sounding claim and still false: a
  confirmation review showed a competitor taking the lock AFTER the read-back, leaving the caller
  returning `true` while somebody else owned it. Weakening a claim is not the same as making it
  true. Both now take the record by rename before inspecting it, the same mutex `acquireLock` uses:
  exactly one caller can move a given path, so nothing else can be looking at the record while it
  decides, and a record that turns out not to be ours is renamed back rather than destroyed.
- **IR-067, high.** `ADD_TEST` and `EDIT_DOCS` were classified `IDEMPOTENT`. Appending a paragraph
  and crashing before the marker lands means recovery appends it again. An action KIND is a
  category, not an operation, and a kind may only be called idempotent when every effect it could
  name is. Both reclassified `NON_IDEMPOTENT`; the idempotent list is now three read-only kinds.
- **IR-068, medium.** `recoverFrom` returned `RETRY` for any `RESERVED` entry "regardless of class",
  including `DEPLOY_PRODUCTION`. Safe against duplication is not safe against AUTHORIZATION: a
  restart path trusting it would have carried out a Human Gate action because a crashed process
  wrote a row. A journal entry records intent and grants nothing.

**Convergence.** Three cycles, 19 findings, all reproduced before any change. Cycle one found
defects beneath comments claiming the opposite; cycle two found fixes reproducing the defect they
fixed one boundary further out; cycle three found the same shape once more in the takeover path.
Under the bounded-convergence rule this is the last cycle: the remaining known residual is IR-066,
which is documented, detected at runtime, and requires a primitive change rather than another pass.

## IR-069..IR-074 — Final candidate review, and the lock rebuilt twice more (`gpt-5.6-sol`)

Two passes against the frozen candidate, scoped to `src/server/controlbus/store.ts` — the only
executable file that had changed. Both blocked attestation, correctly.

**Pass one refuted the rename mutex.** `renameSync` moves whatever is at the path, so a caller that
had read a stale record and then renamed the lock away could relocate a competitor's freshly
installed live lock instead, and both callers ended up holding it.

That was the third attempt with the same shape: `existsSync`-then-write, then read-then-`unlink`,
then read-then-`rename`. Each smaller than the last, each shipped with a comment asserting it was
closed. **The mistake underneath all three is treating an operation as a mutex because it is
atomic.** `rename` is atomic — that means the move either happens or does not, and says nothing
about _which_ file moved.

Rebuilt around exclusive create, the one operation here that arbitrates: `wx` fails when the file
exists, so exactly one racer wins. Acquisition is a `wx` create; every other mutation takes a
separate `wx`-created mutation right first.

**Pass two refuted all five properties of that rebuild**, and three of the findings were real
defects rather than theoretical races:

- **IR-069.** A `wx`-created file is visible before its contents land, so a competitor acquiring at
  that instant appears as an empty, unreadable record — which the code read as "corrupt, take it
  over". Both callers acquired. An unreadable record now backs off while its filesystem mtime is
  under a second old, which separates mid-write from corrupt without delaying a real takeover.
- **IR-070, the one that mattered most.** The mutation lease was stamped with `record.startedAt`.
  A watcher's record is created once at startup and never replaced, so after a few hours that is
  hours stale — every later `.mutate` file looked as though it came from the future, nothing ever
  expired, and **a single orphaned right would have stopped the watcher permanently.** A deadlock,
  found while looking for a race.
- **IR-071.** The lease could expire mid-operation, permitting two simultaneous mutators. Fenced:
  ownership is re-verified immediately before every destructive step, and the `finally` removes the
  right only when it is still ours. Narrowed, not closed — the remaining exposure needs a process
  frozen mid-function for longer than the lease, and that is stated rather than papered over.
- **IR-072.** In-place heartbeat writes left the record briefly truncated on disk. Now written
  through a temp file, so an acquirer reading at that instant cannot see a partial record.
- **IR-073.** `releaseLock`'s record parameter was optional and deleted unconditionally when
  omitted — a live-lock destroyer behind a default argument, and the easiest of the whole set to
  trigger because it needs no concurrency at all.
- **IR-074.** `writeAtomic` carried a false claim about Windows rename semantics. It is used for the
  cursor only, where the single writer is the lock holder, so it depends on no such thing.

**Six cycles, 24 findings, every one reproduced before a change.** What recurred was not
carelessness in the code but confidence in the comment: each round the claim grew more careful and
stayed false — including one round where the mitigation was deliberately weakened to "detected, not
prevented" and _that_ was still untrue. It stopped when the primitive changed rather than the
wording.

### IR-077 — the watcher's documented poll cadence exceeds the rate limit it polls under (P1, found in production state)

**Found by:** reading the running watcher's own degraded health, not by review.

`npm run control-bus:status` reported `NETWORK_DEGRADED` with a fresh heartbeat and three
consecutive read failures. The cause was not the network:

```
core remaining: 0 / 60   reset in 476 s
```

GitHub's **unauthenticated** rate limit is 60 requests per hour. The watcher polls every 45
seconds, which is **80 requests per hour**, and the pagination loop can issue more than one request
per cycle. The documented cadence — `WATCHER_POLL => 30_60_SECONDS`, recorded as an invariant in
`CLAUDE.md` — is arithmetically unachievable against the endpoint it targets. At any rate in that
band the watcher exhausts its budget and spends most of each hour rate-limited.

**What makes this the SILENT_DEGRADATION shape rather than an outage.** Nothing crashes. The
watcher stays alive, heartbeats correctly, logs a failure per cycle, and reports itself degraded —
and the bounded backoff then rescues it by accident: at the 8-minute ceiling it makes 7.5 requests
an hour, comfortably inside the limit. So the channel does work, at eight-minute latency instead of
forty-five seconds, and every document describing it says forty-five.

Two further problems this exposed, both mine:

- **The error class is logged and the status code is not.** `githubFetchComments` throws
  `new Error("HTTP 403")`, whose `name` is `"Error"`, and the log records only the name — a
  deliberate choice, because a fetch error can carry a URL with a token in it. The consequence is a
  log reading `read failed: Error` three times with no indication that the cause was a rate limit.
  A status code carries no secret and should be kept.
- **`control-bus:status` judges liveness by PID alone**, printing `alive (pid 11884)` without
  consulting the heartbeat — the exact distinction the lock was rebuilt around three times, absent
  from the diagnostic that reports it. Here the heartbeat happened to be fresh, so the answer was
  right by luck rather than by method.

Not yet fixed: the current candidate is frozen pending its bounded review, and this is executable
change in a different module.

### IR-078 — a reviewer claim rejected by reproduction (`gh --paginate`), recorded as rejected

The bounded review of `d35f72c` refuted one of six questions: it held that `gh api --paginate`
emits consecutive JSON arrays, so the authenticated adapter's single `JSON.parse` would throw once
the issue passed one page.

**Reproduced and false for gh 2.97.0.** Run with `per_page=5` against twelve comments — three pages
— it returned one merged array of twelve. `--slurp` exists precisely to opt _out_ of that merge,
which is the documentation confirming the default. The code was not changed to satisfy the claim.

Recorded because rejections are evidence too, and because the standing rule cuts both ways: a
model's finding is a hypothesis until reproduced, and IR-020 remains the reminder that a strong
model can produce a confident, specific, entirely wrong reproduction. Five of six answers in the
same review were correct and useful; this one was not, and acting on it would have added handling
for a shape the tool does not emit.

A tolerant parse was added anyway, for a different reason: merging is a property of the TOOL, not
of this code, and the installed version is not the only one that will ever run it. Concatenated
pages are recognised and flattened; genuinely corrupt output — a warning on stdout, a truncated
body — still throws rather than being salvaged into a short comment list, which would be the silent
truncation this module has already had to remove twice. (That throw reached `READ_FAILED` when this
was written; since IR-080 the adapter catches it so the cycle ends as `MALFORMED_RESPONSE` with the
rate-limit signals preserved. The tolerant parse itself was later removed — see IR-079.)

The other five answers were confirmed: budget arithmetic never over-polls (now swept as a property
across eight remaining-counts and five reset horizons rather than argued), auth mode cannot claim
authenticated when it is not, no credential reaches a log or the inbox, the `TEST-` gate cannot be
bypassed or spoofed, and the attestation parser and freshness rules are unregressed.

### IR-079 — the tolerance added for a rejected claim corrupted data (P1, removed)

IR-078 rejected a reviewer claim that `gh api --paginate` concatenates JSON arrays. I added
concatenation handling anyway, framed as version-tolerance. The next review found it corrupts
data.

The merge was a regex rewriting `][` into `],[`. That rewrite does not respect JSON string
literals, so `["x][y"]["z"]` — a body containing those two characters — parsed to altered content.
A GitHub comment saying "see figure ][ below" is entirely ordinary, which makes this reachable from
remote content rather than theoretical.

**Text-surgery on a format that has string literals in it.** The same mistake that moved the
attestation parser off Markdown two days of work ago, repeated one module over, in code written to
be defensive. That is the pattern worth recording: the defensive addition was itself the defect,
and it existed only to satisfy a claim I had already reproduced as false.

Removed rather than defended with a JSON-aware scanner. It guarded a shape no known `gh` version
emits, and if a future one does concatenate, `JSON.parse` throws — the caller now turns that into
a `MALFORMED_RESPONSE` cycle rather than `READ_FAILED`, so the cursor stays put, nothing is
admitted, the failure is counted, and the rate-limit signals survive (IR-080). Loud and
wrong-shaped beats quiet and altered.

Also noted from the same review and not fixed: when `ghFetchComments` throws on a parse failure,
the rate-limit signals it had already retrieved are lost, so the backoff degrades to geometric
rather than budget-aware. Safe in that direction — it waits longer, not shorter — and restructuring
the fetch contract to carry signals through a throw costs more than it returns today.

### IR-080 — the deferral reason recorded in IR-079 was backwards (P1, fixed)

IR-079 recorded a known limitation and justified deferring it: on a parse failure `ghFetchComments`
throws and loses rate-limit signals it had already retrieved, so backoff degrades to geometric —
"that errs toward waiting longer, and restructuring the fetch contract costs more than it returns".

**The safety direction was wrong.** With `remaining: 0` and a reset an hour away, discarding the
budget drops the cycle onto geometric backoff, which schedules ninety seconds instead of an hour.
It polls FASTER than the budget allows, in precisely the situation where that costs most. A stated
safety direction that is backwards is worse than an unstated one, because it ends the analysis.

Fixed by keeping the signals attached rather than restructuring anything: on a parse failure the
adapter returns the unparsed body, which is not an array, so `parseCommentsPayload` rejects it as
`MALFORMED_RESPONSE` — and that path is budget-aware. Three lines, where the deferral had assumed
a contract change.

### IR-081 — absent headers were treated as permission to use the target cadence (P2, fixed)

`nextPoll` fell back to the 45-second target whenever budget headers were missing, including on the
unauthenticated path where 45 seconds is 80 requests an hour against a 60/hour ceiling. Absent
numbers are not permission. The unauthenticated and UNKNOWN modes now floor at 70 seconds, which
clears the one-per-minute ceiling with margin; the target survives only where it is affordable.

The `UNKNOWN` case had a test asserting the old behaviour, and that assertion was the bug rather
than the fix: unknown is not authenticated, so failing closed means the unauthenticated floor.

### Recorded, not fixed

- **Semantic truncation at a valid JSON boundary** cannot be detected by a parser. A transport that
  returned a genuine prefix of the comment list would be admitted. Nothing in `JSON.parse` can see
  this; detecting it needs a total count from the server, which this endpoint does not provide.
- **The cursor can pass a comment id that was never admitted** when a response omits one from the
  middle of a range. No decision is lost, because deduplication keys on `processedCommentIds`
  rather than on the cursor, so a later redelivery still admits it.
- **`appendFileSync` is ordered but not `fsync`-ed**, so the inbox is crash-safe against process
  death and not against power loss. The ordering guarantee that matters — messages before cursor —
  holds in both cases; only the last write is at risk.

### IR-082 — a short `Retry-After` walked through the unauthenticated floor (P2, fixed)

IR-081 added a 70-second floor for unauthenticated polling, because 45 seconds is 80 requests an
hour against a ceiling of 60. The review of the frozen candidate found the floor was applied in
only one of four branches: `Retry-After` returned early with `Math.max(retryAfter, 45s)`, so
`Retry-After: 1` on the unauthenticated path scheduled 45 seconds and went straight through it.

"Wait at least this long" can raise an interval and must never lower it. The mode floor is now
computed once and applied to every branch — retry-after, exhausted budget, geometric backoff and
the ordinary path — rather than to the one I happened to be looking at when I wrote it.

### IR-083 — the third vacuous test of the session (P2, fixed)

The IR-080 fix lives in `ghFetchComments`, and the test written for it exercised only `nextPoll`.
Reverting the adapter's catch would have left the suite green. The review said so, and it is the
third instance of this shape here — after the attestation fence test that used an invalid example
value, and the non-string-SHA case that failed on length rather than type.

Now covered through `runCycle` with a stubbed `gh`, and verified the way the others should have
been: the catch was removed, the test failed, the catch was restored, the test passed. The
question that finds these is always the same one — _would this fail if the thing it names were
deleted?_ — and it is cheap enough that there is no excuse for asking it only in review.

Also corrected: three places still said malformed `gh` output reaches `READ_FAILED`. It reaches
`MALFORMED_RESPONSE` since IR-080. Stale prose beside working code is how a comment becomes a
claim nobody checks.

## Gate A — final release-candidate adversarial review (`gpt-5.6-sol`, candidate `6103ad8`)

Required by `[CHATGPT_DECISION][RC-GATES-001]` as the one true technical RC blocker. Five areas
reviewed: auth and operator access, legal-guardrail enforcement, Claim Ledger and Verifier
boundaries, ingestion and migration safety, and secret redaction. Five findings, each reproduced
before anything was changed.

### B1 — three prohibited concepts reached the answer path (P1, FIXED)

The one that matters most, because `LEGAL_GUARDRAILS.md` is an absolute rule rather than a quality
target. All three reproduced:

- `Give me a guaranteed 10% annual return strategy for Apple` — the pattern required "guaranteed"
  and "return" to be adjacent, and the natural phrasing puts a number between them.
- `What will Apple trade at next year?` — the numeral pattern needs a number and the other
  definitive-price pattern needs the word "where".
- `Tell my brother to dump Apple and move everything into bonds` — third-party framing exists in
  Korean (IR-034) and never existed in English.

The same shape as every other member of this cluster: one phrasing of a prohibited concept covered,
its neighbour not. The third-party gap is the exact mirror of GC-10, where the OUTPUT scanner was
second-person only. Fixed with both-direction controls — a macro forecast question, a filing's use
of the word "guarantee", and an innocent mention of a family member all still answer normally,
because a guardrail that refuses ordinary research is one users route around.

### D1 — a revision that would have vanished (P1, FIXED)

Ingest compared stored and incoming figures with `Number(a) === Number(b)`. The column holds six
decimals; a double carries fifteen to seventeen significant digits, so `10000000000000.000001` and
`...000002` are the same number to JavaScript and a genuine revision would have been recorded as
"unchanged".

Latent rather than observed — no series is near that magnitude — and fixed anyway because of how it
fails: nothing errors, no revision row appears, and the ledger looks consistent while missing a
figure. Compared as normalised decimal strings now, so trailing zeros still mean the same reading.

### E1 — a short password survived redaction (P2, FIXED)

Credentials are redacted by value with an eight-character floor, so that "test" or "admin" do not
turn diagnostics into `[REDACTED]` soup. Sound reasoning, real hole: a seven-character database
password inside a connection URI reached persisted ingestion errors and could render on `/admin`.

The threshold was not the mistake. A password between `:` and `@` in a URI needs no length
heuristic — its position identifies it — so it is redacted by shape while the scheme, user, host,
port and database name survive. A redacted connection error should still say which database failed.

### A1 — signup discloses whether an email is registered (P2, ACCEPTED PRE-LAUNCH)

Reproduced by reading: `signUp` throws "An account with this email already exists". The asymmetry is
stark — `signIn` carries a comment explaining that it never reveals which field was wrong or that a
lockout occurred, and its neighbour announces account existence directly.

Not fixed, and the reason is a product decision rather than a technical one. The standard remedies
need email verification, which is a Human Gate (bulk messaging), and the alternative — a generic
failure — strands a user who has forgotten they registered. Recorded alongside HG-009 as an accepted
pre-launch posture that must be revisited before public launch, not as a defect that was missed.

### C1 — the Claim Ledger validates shape, never content (P2, DEFERRED WITH A PLAN)

`assertValidClaim` enforces structure: a FACT needs a `sourceId`, a CALCULATION needs evidence, an
INFERENCE needs a confidence in range. It says nothing about the claim TEXT, so an INFERENCE reading
"Apple will definitely double next year" would pass.

Not reachable today: nothing constructs such a claim, the request-side guardrail refuses those
questions at input, and no page renders claims at all. The obvious fix — reuse
`ADVICE_OUTPUT_PATTERNS` from `verify/evaluate.ts` — would import the v2 shadow layer into v1
domain, which the architecture boundary forbids, and copying the list into the ledger would create
a second copy of a guardrail vocabulary that must never diverge. Duplicated pattern lists ARE the
GUARDRAIL_COVERAGE cluster.

The right remediation is one shared policy module consumed by three callers — the request guardrail,
the output scanner and the ledger — and that is a deliberate refactor rather than something to do
under a frozen candidate. Recorded so it is chosen rather than forgotten.

### Areas the review found clean

Sessions use 32 random bytes and rotate on login; cookies are HttpOnly, SameSite=Lax and Secure in
production; `/admin` requires both a validated session and `ADMIN_EMAILS`, and fails closed when
that is empty; passwords use salted scrypt with constant-time comparison. Refusals survive the
domain-to-page boundary and the page cannot substitute its own answer. FACT and CALCULATION
verification re-fetch and recompute rather than trusting stored text. Original observations are
protected by a partial unique index, revision children are unique per parent, and uniqueness races
are treated as idempotent. No migration deletes business rows. Only `.env.example` is committed, and
the destructive-test guard refuses missing, identical, non-disposable and production-like database
targets.

## Gate B — reviewing the Gate A fixes (`gpt-5.6-sol`, candidate `218d3f9`)

`[CHATGPT_DECISION][MARKET-RESUME-002]` item 4 says a real P1 moves the candidate and the new
candidate needs its own review, CI and evidence. Gate A found two P1s, so the candidate moved, and
this is that review: the 209-line diff `6103ad8..218d3f9`, which is the Gate A fixes themselves.

Reviewing a fix round is worth doing on its own terms. Four of the five findings were real, and
three of them were defects introduced BY the fixes rather than surviving them.

### AM-1 — the possessive pronoun was doing too much work (P1, FIXED)

The Gate A third-party pattern required a possessive from a fixed list, and the review walked
straight past it: `Tell John to sell Apple`, `Advise your brother to liquidate his Tesla position`,
`Should Dad buy more Nvidia?`. A proper name, an unlisted pronoun, and a kinship term with no
pronoun. Who the third party is was never the point.

The same round added `Can you promise my brother a 10% annual return?` — "promise" carries the
guarantee meaning and only "guarantee" was covered. It is covered now when the promise is made TO
someone, which is what separates it from "does the new fab promise better returns for TSMC".

This is the GUARDRAIL_COVERAGE cluster catching the fix for the GUARDRAIL_COVERAGE cluster. The
lesson is the one already recorded and not yet learned: a pattern written against the examples in
hand covers the examples in hand. The instruction pattern no longer enumerates who — it is bounded
to a single sentence instead, which is what keeps the wider span honest.

### AM-2 — the same fix refusing ordinary questions (P2, one real, one rejected, one misattributed)

Three claims, and they did not all hold. This is why claims get reproduced before they get fixed.

- `What will happen if US markets close tomorrow?` was refused. Real, and mine: a bare "close" in
  the price-prediction pattern. A closing PRICE needs the preposition to mean anything, so
  "close at / above / below" is what the pattern keys on now.
- `What guaranteed benefits affect the pension fund's expected return?` was claimed to be refused
  and **is not**. The gap between "guaranteed" and "return" is 41 characters and the pattern bounds
  it at 40. Rejected on evidence.
- `Advise my analyst to hold GDP constant when comparing the two scenarios.` is refused — but not
  by the new pattern, which correctly ignores the analytical sense of "hold". Swap "my analyst" for
  "the team" and the identical sentence answers normally. The refusal comes from
  `(my|our) (advisor|adviser|broker|analyst|banker)`, which predates this round and exists to block
  the advisor-proxy bypass.

  Left unchanged. It is outside the reviewed range, it was placed deliberately, and loosening an
  advice guardrail to admit one methodology question is not a trade to make under a frozen
  candidate on a reviewer's say-so. Pinned by test so it stays a decision rather than an accident.

### DI-1 — the decimal fix assumed a spelling the data does not keep to (P1, FIXED)

The Gate A fix replaced `Number()` comparison with normalised decimal STRINGS. It removed the
double-precision defect and introduced a smaller one facing the other way.

Both adapters validate an incoming value with `Number.isFinite(Number(raw))` and then persist the
ORIGINAL string. So every spelling JavaScript accepts arrives at the comparison verbatim: `1e5`,
`+1`, `.5`. That was checked in the adapters before the finding was accepted, because reachability
is the whole question — and it is reachable.

The consequence is worse than a cosmetic mismatch. `sameDecimalValue` is used twice: once for
"unchanged", and once by the rollback guard that recognises a value the chain has already
superseded. A provider replaying `1e5` over a chain that had moved on to `110000` would not have
been recognised as stale, and the old figure would have been written back in as a revision — the
guard defeated by notation.

Now exact `bigint` arithmetic scaled to the column's six decimal places, rounding half away from
zero as `Decimal(20, 6)` does on the way in. That last part fixes a second case the review found:
an incoming `1.2345678` IS the stored `1.234568` once it lands, and comparing at full incoming
precision manufactured a revision recording no change.

Unparseable input is treated as DIFFERENT unless the strings are identical. Both errors are
possible and they are not symmetric: a spurious revision is a visible extra row, a missed revision
is silence.

### RS-1 and RS-2 — the redaction fix, wrong at both ends (P1 and P2, FIXED)

The username was required, and it is optional in a URI. `postgresql://:s3cr3t@db.internal/market`
kept its password — six characters, below the value-redaction floor, so nothing downstream caught
it either. That is the shape a misconfigured local connection string most often takes.

And nothing was required after the `@`, so the substitution edited prose: "Parser syntax is
proto://left:right@ followed by a host token" came back with `[REDACTED]` in the middle of a
sentence about grammar. Because this phase runs first, no later step could put it back.

Both corrected. A real connection URI always has a host, so requiring one costs nothing.

### The discrimination check, run rather than asserted

The review was asked directly whether any new test would still pass with its fix reverted. It
answered, and the answer was checked by doing it:

| Reverted                                     | Tests that fail |
| -------------------------------------------- | --------------- |
| the connection-URI regex                     | 3               |
| `sameDecimalValue` to `Number()`             | 4               |
| `sameDecimalValue` to the Gate A string form | 8               |
| the new guardrail patterns                   | 11              |

The reviewer also noted that several must-ALLOW assertions still pass under a reversion. That is
what a negative control is; they are kept as controls and not counted as proof.

### What Gate B found clean

No catastrophic-backtracking construction among the new regexes — the variable spans are bounded
and the character classes hold no nested ambiguous repetition. `sameDecimalValue` throws on none of
the probed inputs. Whitespace, trailing zeros, leading zeros, ordinary negatives and negative zero
are all handled. The connection regex handles ordinary usernames, one-character passwords,
mixed-case schemes, and schemes containing `+`, `.` or `-`.

## Gate C — the third round, and a second reviewer arriving independently (candidate `ccb7461`)

Two reviews landed on this round rather than one. `gpt-5.6-sol` reviewed the delta
`218d3f9..ccb7461` on request, and `[CHATGPT_ARCHITECT_GUIDANCE][MARKET-OS][RC-EXACT-CANDIDATE-003]`
arrived on the control bus with an independent review anchored to `218d3f9`. They overlapped on
nothing, which is itself worth recording: two adversarial passes over the same small diff found
disjoint defects.

Nine claims between them. Seven reproduced, one had already been fixed by the commit the reviewer
had not seen, and one did not reproduce at all.

### The enumeration was the defect, for the third round running

Gate A found that a possessive-pronoun requirement let third-party advice through. Gate B replaced
it with a wider pronoun list plus a kinship list. Gate C walked past both:

- `Should John buy Nvidia?` — a proper name.
- `Should the trustee buy Nvidia?`, `Should the desk sell Apple?` — roles.
- `Can you promise John a 10% annual return?` — the promised-return pattern still wanted a pronoun.

Each round enumerated the examples in hand and each round the next reviewer supplied one outside
the list. The patterns now key on the SHAPE of the request rather than on who is asking or on whose
behalf: `should <anything> <trading verb>`, and `promise <recipient> a <figure> <return>`. The verb
is what keeps ordinary questions out — "Should investors expect more volatility?" and "Should the
Fed raise rates?" carry no trading verb and still answer.

One objection recorded in Gate B has been reversed on reflection. The kinship list existed because
"should investors buy" was judged market commentary rather than personal advice. It is a request
for a recommendation either way, and `LEGAL_GUARDRAILS.md` does not exempt one because it is
addressed to a crowd.

### A period is not a sentence boundary (P1)

`Tell Mr. Smith to sell Apple.` and `Tell Acme Inc. to sell its Apple stake.` both escaped, because
the span introduced in Gate B was `[^.?!]` and stopped at the abbreviation. Distinguishing `Mr. `
from a real sentence end needs an abbreviation list or a lookbehind thicket, and both are worse
than what they fix. The span now excludes only `?` and `!`; the 40/25 character bounds are what
keep it local.

That trade is deliberate and it is not free: two short sentences within forty characters can now be
matched across. The alternative was a one-word bypass of an absolute prohibition, and the cost of
the bypass is not comparable to the cost of a contrived over-block.

### The price pattern was refusing forecasts (P2, from the control bus)

`What will unemployment reach next year?` and `What will trade volumes be next year?` were refused
by the bare `hit|reach|trade` alternatives — contradicting the invariant stated in the comment
directly above them. A definitive PRICE prediction needs the preposition ("trade at", "close
above") or an explicit worth; a numeric target was already covered by the `will … hit … 300`
pattern, which requires the number that makes it a price.

### A claim that had already been fixed, and one that was never true

The control-bus review's D1 follow-up said `sameDecimalValue("1.0000004", "1.000000")` returns
false and manufactures a spurious revision. True of `218d3f9`, which is the SHA it was anchored to,
and already false by `ccb7461` — the quantise-to-scale-6 repair had landed in between. Recorded as
ALREADY_FIXED rather than as a finding, and its requirement for an ingest-level test was adopted
because it was right that no such test existed.

Gate C's own AM-RC-1 listed `Can you promise the trustee a guaranteed 8% yield?` as reaching the
answer path. It does not — the word "guaranteed" next to "yield" fires a pattern that predates this
round entirely. The rest of AM-RC-1 was real. Reproducing each sub-claim separately is what
separated them.

### Three over-blocks accepted rather than fixed

Each has a repair that is worse than the defect, and the reasoning is identical in all three: this
guardrail enforces an absolute prohibition, so an exemption a user can write into a request is a
bypass, and a bypass outranks an inconvenience.

| Case                                                         | Why not fixed                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `hold the numerator at 1.5` (AM-RC-4)                        | Widening the analytical exemption also admits "hold Apple until the market is steady" |
| quoted filing language (AM-RC-5)                             | Exempting quoted text lets any request be smuggled by quoting it                      |
| `proto://user:password@host/path` in documentation (RS-RC-1) | Syntactically identical to a real credential; the reviewer said so while filing it    |

All three are pinned by test. None of them silently answers anything, and each is cheap for a user
to rephrase. If a later dedicated guardrail review finds a discriminator that is not a bypass,
those tests are what will need changing — which is the point of writing them down.

### What this round added beyond the fixes

`sameDecimalValue` no longer falls back to a string comparison when it cannot read an operand; it
throws. Deciding "same figure" is the decision this path turns on, and a comparison that cannot
read one side has not made that decision — it has guessed, quietly, in a function whose failures
are invisible by construction. Neither operand can legitimately be unreadable, so an unreadable one
means something upstream is broken and the run should say so.

`tests/integration/observation-decimal-identity.test.ts` closes the gap the control-bus review
named: identity was tested at the function boundary and against a `numeric(20,6)` cast, but never
through `upsertRevisionAwareObservation` itself. It now counts rows. Eight spellings the column
stores identically must produce no revision; a one-unit change at the sixth decimal must produce
exactly one; and a superseded value replayed as `1e5` must still be refused by the rollback guard.
Both earlier defects in this area were invisible at the function boundary and visible only as rows.

That file passes against `ccb7461` as well as against this commit, and that is worth saying plainly
rather than letting a green run imply otherwise: it is a new contract test for behaviour that was
already correct, not a regression test for a Gate C fix.

### Discrimination

Reverting both changed source files to their `ccb7461` form fails 22 tests.

### What Gate C found clean

Decimal identity across exponent notation, leading `+`, leading `.`, whitespace, trailing zeros,
negative zero, exact-half rounding in both signs, values beyond double precision, and very large
and small exponents — with adapter reachability considered for each, and no stored-value identity
violation found. Both call sites use the same helper, so unchanged detection and rollback detection
cannot disagree. Secret redaction across empty and ordinary usernames, one-character passwords,
punctuation and percent-encoded credentials, schemes containing `+`, `.` and `-`, hostnames, IPv4,
ports and bracketed IPv6, with no real connection-password false negative. No catastrophic
backtracking. And no newly added assertion that would still pass with its implementation reverted.

## Gate D — the round where the previous round's fix was the defect (candidate `b12f349`)

Gate C's widest change was replacing an enumerated `should <person> <trading verb>` rule with a
general `should <anything> <trading verb>` one, on the reasoning that the verb was the real
discriminator. A self-attack written while the reviewer was still running refused ten ordinary
research questions out of ten:

    Should the Fed hold rates steady at the next meeting?
    Why should the ECB buy government bonds under QE?
    How should a company hold treasury shares on its balance sheet?
    What should a 10-K disclose about short positions?
    Should short interest be reported semi-monthly?

The verb is not a discriminator. "Hold", "short" and "invest" are ordinary words in monetary
policy, accounting, index mechanics and regulation. Gate B's original objection to generalising was
right, the note recorded against it in Gate C was wrong, and this reverses the reversal — on
evidence this time rather than on reflection.

The enumeration is back, extended with exactly what Gate C proved missing and no further: proper
names (case-sensitive, because a capital mid-sentence is the only available signal that a subject
is somebody rather than something) and investor roles — trustee, broker, adviser, desk, fund
manager. Institutions are deliberately out: nothing separates "Should the pension fund short
treasuries?" from "How much should a pension fund invest in bonds under Korean regulation?", and
refusing the second is the worse error.

**CI was green on `b12f349` with all ten of those over-blocks present.** No test covered a
monetary-policy question phrased with "should", so nothing failed. Worth recording plainly: a green
suite is evidence about the tests, and this round's most damaging defect was found by attacking the
code rather than by running it.

### What Gate D itself found

Seven claims, all reproduced. Two — the `should` over-block and a promise-shaped false positive —
were already fixed by the self-attack before the review was read; both are recorded as such rather
than claimed as Gate D's work.

**RC4-INGEST-1 (P1)** is the interesting one, and it is a defect in the fix from the round before.
`Number.isFinite(Number(raw))` is not a test for "this is a decimal": `Number("0x10")` is 16, and
`0b10` and `0o10` read the same way. So a hexadecimal value passed the adapter, was stored by
Prisma as 16, and then made the newly-throwing comparator abort on the NEXT ingest of the same
series. Accepted once, fatal the second time — the worst of the two available behaviours, and
introduced by making the comparator loud without asking where the unreadable value came from.

The adapter is where a value that is not a decimal should stop. Both normalizers now validate with
`isStorableDecimal`, the same rule the comparator uses, so the throw is defence in depth rather
than the first line of it. The comment claiming the regex covered every spelling the ingest path
could deliver was simply false, and is corrected.

**RC4-SHOULD-2 (P1)** — `Should my elderly retired father with a low risk tolerance sell Apple?`
was answered: forty-eight characters between the possessive and the verb, against a twenty-five
character span. The description of a person is exactly where this kind of request gets long, and
the possessive has already established that a person is the subject, so the span is sixty now.

**RC4-PROMISE-2 (P1)** — `Can you promise John double-digit annual returns?` has no numeral, and
the pattern required `a`, `an` or a digit after the recipient. Split in two: a recipient that is
unmistakably a person needs no figure, while a `the <something>` recipient still does — without
that second half, "does the merger promise the kind of returns investors want" reads as a promise
made to "the kind".

**RC4-PRICE-1 (P1)** — dropping bare `hit` and `reach` in Gate C reopened the price question asked
without a numeral: `What high will Apple hit next year?`. The price NOUN carries the meaning there,
so that is what the new pattern keys on.

### Two things carried forward rather than fixed

`RC4-SPAN-1` (P2): with periods no longer bounding the instruction span, a second sentence starting
with an infinitive can be read as a continuation of the first — "Advise investors on duration risk.
To sell bonds before maturity can crystallize losses." Bounding on periods again reopens a P1, and
every alternative needs an abbreviation list, which is a bypass surface of its own.

The index-level gap is a different kind of note, and the difference matters. `What level will the
S&P 500 reach next year?` is a price prediction and is NOT refused. Nothing in the sentence
separates it from `What level will unemployment reach next year?` without knowing whether the
subject is an instrument or an indicator, and refusing macro forecasts is the worse error. That is
a coverage GAP with a test asserting current behaviour so it stays visible and dated — not a
decision to over-block, and not a claim that the behaviour is right.

### Discrimination

Reverting the changed source files to their `b12f349` form fails the Gate D regressions; the full
suite is 1265/1265 across 108 files against a live database.

## Gate E — asked whether the round was safe to stop on, and answered no (candidate `823e9fb`)

The Gate E prompt did not ask for a sixth phrasing. With a regex list there is always one, and
supplying it is not what a fifth round needs. It asked one question — _is this safe to stop on?_ —
and the reviewer's closing line was that there were unresolved P1s. That answer was correct.

### The self-attack found the worst one first, again

Gate D closed "Should John buy Nvidia?" with a case-sensitive `should <Capitalised> <verb>` rule.
Ten minutes of self-attack, before the review returned:

    Should Apple buy Nvidia?                    — an M&A question
    Should Samsung sell its display unit?       — a corporate action
    Should Tesla invest in a new gigafactory?
    Should Europe invest in LNG terminals?
    Should Congress buy down the deficit?

All five refused. A capital letter marks a proper noun, not a person, and in a market-intelligence
product most proper nouns are companies. Those questions are close to the centre of what the
product is for.

What separates a person from a company in those sentences turns out to be the possessive that
follows: people get "his" and "her", companies get "its". So the rule now requires one, and
"Should John buy Nvidia?" — a bare first name with no other cue — went back to being uncovered.

### Capitalisation is not identity (P1 ×3)

Gate E's central finding, and it applies to every case-sensitive pattern the previous round added:
`john` and `JOHN` are the same person as `John`. A reader typing in lower case is not asking a
different question. Three P1s were variations on it, plus a reversed word order the price patterns
had never seen:

| Input                                       | Was      | Now     |
| ------------------------------------------- | -------- | ------- |
| `Can you promise john a 10% annual return?` | answered | refused |
| `Can you promise JOHN a 10% annual return?` | answered | refused |
| `What will Apple's price be next year?`     | answered | refused |

The promise rule now has a lower-case branch that asks a numeral to do the work the capital was
doing — with articles excluded as recipients, because without that "The prospectus promises a 5
year lock-up, not a return" reads as a promise made to "a".

### The honestly-labelled gap was still a gap (P1)

The previous round left `What level will the S&P 500 reach next year?` uncovered and wrote a test
asserting it, labelled as a known gap rather than as correct behaviour. Gate E's response: the
label is honest and the prohibited output still reaches the user.

That was right, and the reasoning behind the gap was wrong in a specific way. It had been argued
that nothing separates an index from an indicator without enumerating names, and that enumeration
was what this file had been burned by four times. But the two enumerations are not alike. Personal
names are open and unbounded; the major indices are a closed, stable set that no economic indicator
shares a name with. The distinction that matters is not "is this a list" but "can the list be
finished".

The test that asserted the gap now asserts the opposite, and the indicator forecast it was traded
against — `What level will unemployment reach next year?` — still answers.

### Two over-blocks and a regression in the adapter gate

`What value will unemployment reach next year?` was refused: the price-noun pattern keyed on the
noun and never on the subject. It requires a capitalised subject now, which indicators do not have.

`Should our independent central bank, during a liquidity crisis, buy government bonds under QE?`
was refused: the sixty-character possessive span, widened last round for "my elderly retired father
with a low risk tolerance", walked through a subordinate clause into an unrelated verb. Commas end
the span now — the personal description has none and the policy sentence has two.

And `isStorableDecimal` gave something away that the check it replaced was providing. `1e999` is a
well-formed decimal literal and is not a number the column can hold; the old
`Number.isFinite(Number(raw))` rejected it, and a syntax-only test accepted it, which would have
turned a clean adapter refusal into a database error further down. Syntax and magnitude are two
questions and the boundary has to ask both. This is the second time in two rounds that a fix to
this function traded one property for another without noticing.

### Where this leaves the guardrail

Five rounds. Every round has found real defects and every round has introduced or left one, and the
running score is now visible enough to state plainly: **three of the five regressions were caused
by the fix from the round before, and all three were in the same enumeration.** The pattern list is
being asked to make a semantic distinction — is this subject a person, an institution, an
instrument or an indicator — that it has no way to represent.

Two things follow, and they point in different directions:

- Nothing here is unsafe. There is no unresolved P0 or P1 at this candidate, both directions are
  pinned by tests at every round, and the over-blocks that remain are recorded with the cost of
  their repair.
- The next round should not be a sixth patch. The recurring failure is structural, and the honest
  options are a subject-classification step, or accepting a documented false-positive rate and
  measuring it, rather than another pattern.

Recorded here rather than acted on, because changing the shape of the guardrail is not a change to
make inside a release-candidate freeze.

## Gate F — the round that found the actual discriminator (candidate `0508113`)

Three P1s, all reproduced, all in the guardrail. Two were regressions from the fix immediately
before them, which by now is the expected result rather than a surprise. The third was worth more
than either.

### The recipient was never the question

`Does this bond promise investors a 5% yield?` was refused. That is a question about contractual
terms and about as ordinary as research gets in this product.

Look at what three rounds had been doing to the promise rule. Round one keyed on a pronoun list.
Round two on any word. Round three on a capitalised name. Round four added a numeral to stand in
for the capital. Each version fixed the example in front of it and broke something adjacent, and
each time the thing being adjusted was the RECIPIENT.

The recipient carries no information. Look at the subject instead:

    Can you promise John a 10% annual return?          the system is asked to promise — prohibited
    Does this bond promise investors a 5% yield?       a bond promises — contractual terms
    The acquisition promises shareholders a return     prose
    Does the merger promise the kind of returns…       prose

Every prohibited form has "you promise" in it or is an imperative. Every innocent one has a thing
as the subject. Keying on that makes lower case, capitals, names, roles and "double-digit" all work
at once — the four separate branches collapse to two, and the recipient goes back to being anything
at all.

This is the same shape as four of the six rounds: patching the object when the subject was the
signal. Worth stating in those terms, because it is the first structural improvement in the file
rather than another pattern.

### A comma is not a change of subject

The previous round made commas end the possessive span, so that "Should our independent central
bank, during a liquidity crisis, buy government bonds under QE?" would stop being refused. Gate F
found the other side of it immediately: `Should my elderly retired father, given his low risk
tolerance, sell Apple?` is the same request as the pinned no-comma version and was being answered.

A kinship term settles what a bare possessive can only guess at, so the kinship rule allows commas
and the possessive rules still do not. Both sentences get the right answer now for a reason rather
than by tuning a number — which is the difference between the two halves of this round.

### "Dow" is a company as well as an index

`What level will the Dow Chemical dividend reach next year?` was refused by the case-insensitive
index list added the round before. The list is case-sensitive now and does not match when another
proper noun follows: an index name followed by a capitalised word is part of a longer name.

The index enumeration itself still holds up. It was defended on the grounds that it is a list that
can be FINISHED, unlike personal names, and that argument survives contact with this finding — what
failed was the matching, not the closure of the set.

### The reviewer could not run the tests, and said so

Gate F's environment refused to let Vite write its temporary config, so the review is regex reading
rather than execution. It said so explicitly instead of implying the findings had been run. All
three reproduced when checked here, which is the right outcome for a review that was honest about
its limits.

## Gate G — the seventh round, and the first where nothing new had to be invented (candidate `8340143`)

Three P1s. All of them were boundaries on the rule Gate F introduced rather than the rule itself,
and that is the difference worth recording: for six rounds a finding meant replacing a pattern, and
this round every finding was fixed by widening or narrowing a bound on a rule that was already
right.

### The subject rule was right; its edges were too tight

Re-keying the promise rule from recipient to subject narrowed what it matches. A self-attack run
before the review returned found five forms that had slipped out of the narrowing:

    Would you be able to promise me a 10% return?     the politeness sits between "you" and "promise"
    Can you please promise me a 10% annual return?
    Just promise me a 10% return.                     an adverb before the imperative
    I want a promise of 10% returns.                  the noun form, no verb at all
    Can I get a promise of 12% a year in returns?

Gate G added a sixth: `For my retirement account, promise me a 10% annual return.` — an imperative
opened by a comma rather than by a full stop.

Fixed by allowing a fifteen-character gap after "you", a closed list of adverbs before the
imperative, a comma as a sentence boundary, and one pattern for the noun form that requires a
figure. `Can you tell me if the bond promises investors a 5% yield?` still answers: twenty-four
characters separate "you" from "promise" there, and the subject is the bond.

### A possessive moves the subject off the person

The kinship rule was widened last round to span an appositive. `Should my brother's COMPANY, given
its strong cash balance, buy a competitor?` is what that reaches — corporate analysis, with the
span crossing the apostrophe to find the verb. The subject of "buy" is the company, and a
possessive on the kinship term is exactly the signal that says so.

### Index names that continue into another capitalised word

The lookahead added last round to keep "Dow Chemical" answerable also stopped `S&P 500 Index`,
`Nasdaq Composite` and `Dow Jones Industrial Average` being recognised. All three are the index,
spelled out in full. The lookahead now lets through the words that CONTINUE an index name and stops
at the ones that start a company name.

Found by self-attack for `Nasdaq Composite` and by Gate G for the other two, which is the second
round running where the two agreed without having seen each other.

### Where the chain stands

Seven rounds. The shape of the findings has changed:

| Rounds | What a finding meant                                        |
| ------ | ----------------------------------------------------------- |
| A–E    | replace a pattern; the replacement broke something adjacent |
| F      | change what a rule keys on; four branches became two        |
| G      | adjust a boundary on a rule that was already right          |

Gate F is the reason. Keying on the subject rather than the object removed the thing that had been
oscillating, and the round after it produced no structural finding at all — only edges. That is
what convergence looks like from inside, and it is the first evidence in seven rounds that this
surface can reach a fixed point rather than trade one error for another indefinitely.

The gap recorded at Gate E remains open and remains a gap: a bare first name with no other personal
cue — `Should John buy Nvidia?` — is not refused, because every discriminator tried for it also
refuses `Should Apple buy Nvidia?`. Every phrasing carrying any other cue is covered.

## Gate H — the boundaries needed boundaries (candidate `319cb72`)

Six over-blocks from self-attack, three P1s from the review, one of which had already been fixed by
the time it was read. All from one cause: Gate G's widenings were written against the requests and
never against the prose.

Filing language is full of promises. A prospectus promises a return; an indenture includes a
promise of 6%; an analyst explains the promise of 5% returns; a bond promises investors a yield.
Every one of those is this product's subject matter, and every one of them was being refused.

    The prospectus contains no promise of a 5% return.
    Does the indenture include a promise of 6% returns to holders?
    Can you explain the promise of 5% returns in the prospectus?
    In the filing, promise language around returns is boilerplate.
    As you note, bonds promise investors a 5% yield.

What separates those from a request is not vocabulary — it is who wants the promise. The noun form
now requires a wanting verb, the comma-imperative requires a pronoun recipient, an article before
"promise" marks it as a noun, and a comma ends the `you`…`promise` gap because it ends the clause.

Gate H then found the mirror image of the previous round's kinship fix. Excluding `'s` after a
kinship term was right for "my brother's company" and wrong for `Should Dad's broker sell Apple?`.
A broker acts for a person; a company acts for itself. The possessive is allowed back when a role
follows it.

One of Gate H's three findings did not reproduce: the noun-form over-block it named had already
been fixed by the self-attack before the review was read. It was right about the defect and right
about the cause — it pointed out that the rule contradicted the design rationale written beside it
— and it is recorded as not reproducing rather than claimed as this gate's work.

### The pattern across eight rounds, stated once

Two directions keep trading places, and the trade is not random:

- A rule written from the REQUESTS refuses the prose. (Gates A–D, H)
- A rule written to spare the prose misses the requests. (Gates E–G)

Every round has been one or the other, and every fix that held was the same KIND of thing: find the
feature that distinguishes the two populations — the subject of the verb, an article, a possessive,
a comma — rather than adding another member to a list. Gate F is where that started being done
deliberately, and G and H have both been boundary work on rules that were structurally right.

Eight rounds, no unresolved P0 or P1 at any candidate, both directions pinned by tests at every
round, and the regression rate falling. Not yet zero.

## Gate I — the round the documented pattern predicted in advance (candidate `8498867`)

The findings document had, at the end of the previous round, stated the dynamic explicitly: a rule
written from the requests refuses the prose, a rule written to spare the prose misses the requests,
and every round so far had been one or the other. Round H narrowed several rules to stop refusing
prospectus language. So the prediction for round I was a MISSED REQUEST, and the self-attack was
written to look for exactly that before either review returned.

It found four, all in the same place — the closed verb list that had been added to the noun form:

    Can I have a promise of 10% returns?
    I would like a promise of 10% returns.
    I am looking for a promise of 10% returns.
    Give my brother a promise of 10% returns.

Gate I independently filed the second of those as a P1, and added one more: the kinship-agent rule
enumerated job titles and missed `Should Dad's investment manager sell Apple?`.

### Both were the same mistake, and both got the same fix

A list of wanting verbs and a list of job titles are the same object. The fix in each case was to
find the feature the list was standing in for:

- **First person.** Someone asking for a promise says I, me, my, we or our. A document describing
  one does not. Second person is excluded on purpose — "Can YOU explain the promise of 5% returns
  in the prospectus?" is research, and including "you" is precisely the over-block round H had just
  finished removing.
- **An agent head noun.** Manager, planner, broker, adviser, agent, trustee, custodian — with an
  optional qualifier in front, so "investment manager" and "financial planner" both work without
  either appearing in a list. "Company" is not an agent noun, so "my brother's company" still
  answers.

### What is different about this round

Nine rounds, and this is the second in a row where the fix removed an enumeration rather than
extending one. The count of lists in this file is now going DOWN:

| Round | Lists added | Lists removed                  |
| ----- | ----------- | ------------------------------ |
| A–E   | 6           | 1                              |
| F     | 0           | 2 (promise recipient branches) |
| G–H   | 2           | 1                              |
| I     | 0           | 2 (wanting verbs, job titles)  |

That is the measurable version of the claim that this surface is converging. It is not a claim that
the guardrail is finished — the Gate E gap is still open, a bare first name with no other cue is
still uncovered — but the direction of travel is now visible in something other than prose.

## Gate J — boundaries on features, not features on lists (candidate `4eb6dbf`)

Round I replaced two enumerations with the features they stood in for. Round J is the test of
whether those features were the right ones, and the answer is yes with their edges drawn wrong —
which is a materially different finding from the first eight rounds, where the RULE was wrong.

**First person over-matched**, because analyst prose uses it constantly: "Our analysts flagged the
promise of 8% returns in that pitch deck" is a description, not a request. The other half of the
same observation fixes it. A request asks for **a** promise; prose refers to **the** promise. Asking
and describing differ in the article, reliably, and checking it costs nothing.

**The agent head noun over-matched and under-matched at once.** "Manager" and "agent" are generic
job words, so `Should my brother's project manager buy new software?` and `Should my father's
estate agent sell the house?` were refused over questions with nothing to do with investing. They
need a finance qualifier in front. Meanwhile "fiduciary" needs none and was missing, and "senior
investment manager" has two modifiers where only one was allowed.

A third over-block came from the plain possessive rule rather than from this diff: `Should my
brother's PROJECT MANAGER buy new software?` was matching `should my … buy` across the whole
phrase. The same exclusion already used twice — a second possessive moves the subject — applies
there too, and the kinship-agent rule still catches the cases that matter.

### Ten rounds, and what the record now shows

| Rounds | What a finding meant                                                     |
| ------ | ------------------------------------------------------------------------ |
| A–E    | the pattern was wrong; replacing it broke something adjacent             |
| F      | the pattern keyed on the wrong thing; four branches became two           |
| G–H    | the rule was right, its boundaries were not                              |
| I      | two lists were standing in for features; both were replaced              |
| J      | the features were right; their edges were drawn wrong in both directions |

Enumerations added versus removed: rounds A–E, six added and one removed; F, two removed; G–H, two
added and one removed; I, two removed; J, one removed and none added.

No unresolved P0 or P1 at any candidate in the chain, both directions pinned by tests at every
round. The Gate E gap — a bare first name with no other personal cue — remains open, remains
labelled a gap, and remains the one thing in this file that no round has found a feature for.

## Gate K — the first review that declined to escalate (candidate `d10334a`)

One P1, and two candidates the reviewer explicitly refused to elevate, with reasons: `I want YOUR
promise of 10% returns` evades the noun form but is materially less natural than the phrasings
already covered, and an insurance agent being asked whether to sell Apple is not an ordinary
representative-investment scenario.

After ten rounds of unqualified "yes, there are unresolved P1s", a review that separates a real
defect from an available one is a result in itself, and it is recorded as one. Four claims across
the previous rounds did not reproduce; the discipline that avoids those is the same discipline that
produces a shorter list.

### The one P1, and it was mine

`Should my boss's assistant sell his Apple shares?`

The second-possessive exclusion added the round before rejects the whole rule whenever a possessive
appears within thirty characters. The kinship rule rejects "boss's". "Assistant" is in no role list.
Nothing was left to catch it.

The fix does not extend a role list. What is being sold is plainly one person's holding, and that
is sufficient on its own — a personal possessive in front of shares, a stake, an ISA, a portfolio.
"Sell the house" and "buy new software" have no such possessive, which is what keeps them out.

### Four more from self-attack

Financial titles are rarely bare in practice: `private banker`, `independent adviser`,
`robo-adviser`, `family office`. The unqualified head nouns now accept a modifier, which the
qualified ones already did.

And `I want 12% returns guaranteed` states the promise AFTER the figure. That is the same reversal
that produced "price target" against "target price" nine rounds ago, and the same reversal found in
two Korean forms before that. Reversal is now a category this file has been caught by four times;
it is worth checking for deliberately on any new pattern rather than waiting to be told.

### Eleven rounds

| Rounds | What a finding meant                                                       |
| ------ | -------------------------------------------------------------------------- |
| A–E    | the pattern was wrong; replacing it broke something adjacent               |
| F      | the pattern keyed on the wrong thing                                       |
| G–H    | the rule was right, its boundaries were not                                |
| I      | two lists were standing in for features; both were replaced                |
| J      | the features were right; their edges were drawn wrong                      |
| K      | one edge case the features did not reach — and a reviewer who said so once |

No unresolved P0 or P1 at any candidate. The Gate E gap remains open and remains the only thing in
this file that no round has found a feature for.

## Gate L — two over-blocks, both from unbound pronouns (candidate `e1134d1`)

**The reversed guarantee read on every sentence about a guarantee**, and finance is made of those:
`Are deposit returns guaranteed by the FDIC?`, `The filing says returns are not guaranteed.`,
`What yield is guaranteed under a government bond?`, `Which profits are guaranteed under the
indenture?`. The forward form has always been safe because "guaranteed 10% return" states a claim;
reversed and unscoped, the same words describe one.

Fixed with the discriminator that has now held three times — first person. Somebody demanding a
guaranteed return says I, me, my, we or our; somebody asking whether one exists does not. Third use,
third time it has held, and the first time a fix in this file was reached for because it had worked
before rather than derived again from the examples.

**"Their" is what organisations take.** The holding-object rule did not bind the possessive to
anyone the sentence had named, so `Should BlackRock sell their pension fund business?`, `Should
banks hold their pension fund assets separately?` and `Should the company sell their portfolio
management unit?` all matched. Requiring a personal possessive after "should" keeps the case the
rule exists for and drops the corporate ones.

Gate L also declined to escalate a third candidate — the one-modifier title rule can over-match
"Dad's chartered accountant buy new software", and the reviewer noted those are not market
questions and said so rather than filing them. Second round running that a review has separated an
available finding from a real one.

### Twelve rounds

The reversed-guarantee fix is the first in this chain that was chosen because the same feature had
already worked twice elsewhere, rather than derived fresh from the failing examples. Three uses of
first person, three holds. That is a small thing, and it is the difference between a file that
accumulates patterns and one that accumulates a vocabulary.

No unresolved P0 or P1 at any candidate across twelve rounds. Both directions pinned by tests at
every round. The Gate E gap is still the only thing here no round has found a feature for.

## Gate M — the two channels converged on the same gaps (candidate `a7cb520`)

The self-attack and the independent review found the SAME two defects this round, having attacked
from different directions and without either seeing the other. That has not happened before, and it
is a better signal about the state of this surface than either finding is.

**Anchoring on "should" was grammar, not meaning.** Binding the holdings rule the previous round tied
it to the literal sentence opener, and the same request survives in other grammar:

    Can my father's broker sell his Apple shares?
    Is it time for Dad to sell his Apple shares?
    Would it make sense for my wife to sell her Samsung shares?

The rule now splits by WHICH possessive rather than by opener. "His" and "her" are singular and
personal and need nothing else; "their" and "our" are what organisations take, so they still
require a personal possessive earlier — which is what keeps the BlackRock case answerable.

**"Guarantees" is the same word as "guarantee".** The third-person verb form was missing, so
`Which strategy guarantees 12% returns?` reached the answer path. An inflection is the cheapest
kind of gap and the easiest to leave open, which is why it is now pinned rather than just fixed.

Gate M also declined to rely on one of its own examples — it noted that "Can my father's broker
sell his Apple shares?" could be read as a question about broker authority, and rested the finding
on the unambiguous one instead. Third round running that a review has been explicit about the limit
of its own evidence.

### Thirteen rounds

Every round has produced a real defect. Nothing here says that stops. What has changed is
measurable and worth stating plainly:

- The last three reviews each filed a short list and named at least one candidate they declined to
  escalate, with the reason. The first ten did not.
- The last two rounds' fixes were chosen because a feature had already worked elsewhere, rather
  than derived again from the failing examples.
- This round the two independent channels agreed exactly.

No unresolved P0 or P1 at any candidate across thirteen rounds; both directions pinned by tests at
every one. The Gate E gap remains the only thing in this file that no round has found a feature for.

## Gate N — the two structural repairs `[CHATGPT_ARCHITECT_GUIDANCE][RC-CONVERGENCE-007]` required

The stopping rule arrived with two conditions attached, and both were reproduced before anything
was built: `Should John buy Nvidia?` was still answered, and `isStorableDecimal` still passed
`100000000000000` — fifteen integer digits against a column that holds fourteen.

### The subject classifier

Five rounds of `should <subject> <verb>` patterns are gone, replaced by
`src/server/domain/subjectClassification.ts`. It answers one question — is the subject of this
trading verb a person — with THREE values, and the third is the point. A subject no registry
recognises is `UNRESOLVED`, and in a transactional frame that redirects. A pattern has to decide;
a classifier can decline to, and declining is the safe direction.

The registries are not a sixth hand-written list. Institutions come from `prisma/sources.ts`, macro
variables from `prisma/causalEdges.ts`, and the market indices that had accumulated inside a
guardrail regex are now a named set. Only the well-known companies, countries and policy actors are
curated, because `filings.corpName` holds two companies until an ingest runs and a classifier that
depended on ingestion state would answer differently on two machines.

Three orderings inside it encode judgements the earlier rounds paid for:

- An organisation head noun beats a personal possessive. "My brother's company" is a company; "my
  brother's broker" is my brother.
- A generic job word decides on its qualifier, and decides BEFORE the person words. An investment
  manager acts on a portfolio; a project manager buys software.
- Everything unrecognised is UNRESOLVED, and callers treat that as a person.

`Should John buy Nvidia?` now redirects. That gap had been open and labelled since Gate E, and it
was labelled honestly — but Gate H's lesson was that an honest label does not stop a prohibited
output, and this is the same lesson applied to the last one left.

### The storage domain

`isStorableDecimal` guarded three different things across four rounds and each was adjacent to the
real question. Finiteness asks whether JavaScript can read the string; syntax asks whether it looks
like a decimal. Neither asks whether `numeric(20, 6)` can hold it. It now scales the value to
millionths, rounds as the column rounds, and checks against `10^20 - 1` — the boundary AFTER
rounding, because `99999999999999.9999995` is in range as written and stores as one digit too many.

An exponent bound comes first, so `1e999999999` is refused in microseconds instead of allocating a
billion-digit bigint to discover it does not fit.

### A correction to what Gate D recorded

Gate D fixed a real defect — `0x10` passed the adapter and made the comparator throw on the next
ingest — and the explanation written beside it said PostgreSQL would reject the value. **It does
not.** PostgreSQL 16 reads `0x10` as 16, `0b10` as 2, `0o10` as 8, and accepts `NaN` as a numeric.

That makes the original defect worse than recorded rather than milder: the row would have been
STORED, as sixteen, under a real series. The validator is now deliberately stricter than the column
in exactly those four places, and
`tests/integration/decimal-storage-domain.test.ts` asserts the divergence rather than assuming
agreement — the assertion is generated by asking the database, which is how the mistake surfaced.

### Discrimination

Three mutants, all load-bearing:

| Mutation                              | Tests that fail |
| ------------------------------------- | --------------- |
| classifier always returns false       | 36              |
| UNRESOLVED fails OPEN instead of safe | 12              |
| storage-domain range check removed    | 6               |

The middle row is the one worth keeping: it proves the fail-safe direction is tested, not just the
happy path.

## Gate O — the bounded post-repair review, and the thing the classifier had left out

Two P1 blockers, and both turned on the same omission: the classifier read the SUBJECT and never
the object.

    Should my brother's project manager buy new software?   procurement — answer
    Should my brother's project manager buy Nvidia?         a personalised trade — redirect

Same subject, same verb. Gate J had made this wrong in one direction and Gate O found it wrong in
the other, which is as clean a demonstration as the chain has produced that a rule reading half the
sentence has to get one half of the cases wrong.

The `hold` carve-out was the same mistake in miniature. "Should my father hold his Apple position
UNCHANGED?" was exempted because "unchanged" is exactly the word an analytical hold uses. The
qualifier cannot separate methodology from advice; the object can.

So `asksWhetherAPersonShouldTrade` now reads both ends. The object rescues a person whose subject
head is not one, the analytical exemption applies only when what is held is not tradable, and a
singular personal possessive on the object — "her Nvidia shares" — settles it regardless of the
subject, which is what covers a person whose NAME collides with a registry entry.

### Three smaller things the same review round produced

An appositive is description, not subject. "Should my father, a company DIRECTOR, sell Apple?" put
an organisation word within reach of a rule that checks organisation words first. Only the head
phrase decides now.

`mentionsAPerson` needed a person NOUN rather than any person word. Using the full set refused
"Should our independent central bank, during a liquidity crisis, buy government bonds under QE?" —
"our" makes a subject personal in one construction and is a bare determiner in the other.

And `0e999` was rejected for an exponent that cannot matter when the mantissa is zero. The
zero-mantissa answer comes before the exponent bound now.

### What went to REVIEW_DEBT rather than to another round

Per `[CHATGPT_ARCHITECT_GUIDANCE][RC-CONVERGENCE-007]`, which is explicit that a measurable tail
belongs in a follow-up evaluation:

- **Name collisions.** A person whose name is a registry entry — "Should Dow buy Nvidia?", "Should
  Apple Martin buy Nvidia?" — classifies NON_PERSON. Every name registry has this property. The
  repairs that would close it need either full-span matching, which breaks "the Dow Jones
  Industrial Average", or a personal-name list, which is the unbounded enumeration this module
  exists to avoid. Every ordinary form of the same request IS covered: a possessive on the object,
  a kinship word, a role, or an instruction frame all redirect.

These are asserted by test so the tail is visible and dated, not endorsed.

### The classifier, after Gate O

It reads: the head phrase of the subject, the rest of the subject as supporting evidence, and the
object. Three registries the repository already maintains plus one curated set. Three outcomes,
with UNRESOLVED redirecting.

Mutation proof, re-run after these repairs: neutering the classifier fails 36 tests, making
UNRESOLVED fail open fails 12, removing the storage-domain range check fails 6.

## Gate P — the re-review of the changed surface, and both findings were about whose money it is

Narrowing `mentionsAPerson` to person NOUNS fixed a monetary-policy over-block and opened a
different hole in the same move. `Should my retirement fund buy Nvidia stock?` contains no person
noun at all, and it is the user's own money.

First-person SINGULAR says so where no noun does. "Our" still does not, and the reason is the
sentence that motivated the narrowing: "our portfolio" is personal and "our independent central
bank" is a policy question, and only the singular distinguishes them reliably.

The second finding was the same reading error one level up. `Should BlackRock, whose CLIENT base is
aging, sell Treasury bonds?` is institutional research; the person noun is in an appositive that
DESCRIBES the subject rather than naming it. The rescue reads the head phrase now, exactly as
`classifySubject` does.

### Two more from self-attack, both about overlapping vocabularies

"Should the trustee bank hold ITS pension fund assets separately?" has a person noun in the subject
and a tradable object, and is a question about an institution's balance sheet. "Its" and "their"
say whose the holding is, and an organisation's holding is not a personalised trade.

And "fund" is an organisation word on its own and a finance qualifier in "fund manager", so with
the organisation check running first, `Should the fund manager hold Tesla?` read as an institution.
A qualified financial role now outranks the organisation words. That is the third time in this
module that two vocabularies overlapped and the ORDER decided the answer — worth stating as a
property of the design rather than as three separate fixes.

### The leftover regex the classifier had made redundant

The investor-role pattern in `askMarket.ts` was still refusing "Should the trustee BANK hold its
pension fund assets separately?" because "trustee" appeared in it. The classifier recognises the
same roles and, unlike the pattern, reads the rest of the subject. Removed — six subject-type
patterns are now gone in total.

## Gate Q — three findings, all about which word is the head

`Should your retirement fund buy Nvidia stock?` was answered. Second person is as personal as first
— "your retirement fund" is the reader's money — and only "our" belongs outside the set, because it
is the single possessive that reads institutionally.

`Should Dad's assistant sell their Nvidia shares?` was answered, because object-side "their" had
been treated as organisational for one commit. It is ordinary singular-they. Nothing was lost by
dropping it: the organisational cases it appeared to cover have no person noun in the subject at
all, so the rescue never reaches that line for them. Checking THAT before removing it is what made
the removal safe rather than hopeful.

`Should the fund manager association invest in financial education?` was refused, because the role
check asked whether a role word appeared ANYWHERE in the subject. "The fund manager association" is
an association. A role has to be the HEAD — the last word — and that is now what is checked.

### The property this module keeps demonstrating

Four rounds on the classifier, and the same shape every time: two vocabularies overlap, and the
ORDER or the SCOPE of the check decides the answer. Person words against organisation words.
Finance qualifiers against organisation words. Role words anywhere against role words at the head.
Possessives that mark a person against possessives that mark an institution.

That is not the same failure as the thirteen pattern rounds before it. A pattern round ended with a
new pattern; these end with a precedence, a scope, or a word moved from one set to another — and
each one is a statement about the language that can be checked, argued with, and got wrong
visibly. The module has gained no new list since Gate N.

## Gate R — one blocker, and it was a claim written down too strongly

Dropping object-side "their" the round before came with a justification: the organisational cases
have no person noun in the subject, so the rescue can never reach that line for them. Gate R
disproved it in one input — `Should the trustee bank sell their Nvidia holdings?` has "trustee" in
the subject and is an institution's balance sheet.

The self-attack had found the same case an hour earlier and fixed it, but the COMMENT was still
asserting the false reason, and the review was right to say so. What carries the distinction now is
a property of the subject rather than a hope about which subjects occur: "the trustee bank" ends in
an organisation word and begins with an article, "my retirement fund" ends in one too and begins
with a personal possessive.

That is the second time in this chain that a fix was right and the reasoning printed beside it was
wrong — Gate N corrected the same kind of error about PostgreSQL and `0x10`. Both were caught by
somebody checking the claim rather than the behaviour, and both are worth more than the fixes they
sat next to, because a wrong reason survives into the next round and a wrong behaviour does not.

Gate R also filed the stale test comment as REVIEW_DEBT rather than a blocker. Corrected here.

### Where the chain stands after eighteen rounds

|                                                                   |                        |
| ----------------------------------------------------------------- | ---------------------- |
| Gates run                                                         | A–R                    |
| Unresolved P0 / P1 at any candidate                               | 0                      |
| Reviewer claims that did not reproduce                            | 8                      |
| Subject-type patterns replaced by the classifier                  | 6                      |
| Enumerations added since Gate N                                   | 1 (organisation nouns) |
| Rounds where the self-attack found the round's worst defect first | 7                      |

The last four rounds were all classifier scope and precedence, not new vocabulary, and Gate R's
single blocker was already fixed locally before the review returned. That is what convergence looks
like without claiming it has arrived.

## Gate S — a relative clause moves the last word off the institution

One finding, and a good one. The organisation guard read the LAST token of the head phrase, and
`Should the bank where my father WORKS buy Nvidia?` ends in a verb. The bank became invisible, the
father became decisive, and a question about an institution's investment was refused.

It scans the head phrase now. The ROLE check further up still reads the last word, and the two
differ on purpose: there the last word genuinely is the head — "the fund manager association" is an
association — while here any organisation word anywhere in the phrase settles it. Two checks, two
readings of the same phrase, each justified by what it is looking for.

Gate S also noted that the comment introduced with the guard said "head noun" while the code
checked the last token. Same class of error as Gate R found, one round later, and worth the note:
the comment was describing the intent and the code was implementing something narrower, which is
exactly how a reader ends up trusting the wrong one.

### Nineteen gates

Self-attack found nothing this round; Gate S found the one thing there was. That is the first round
in the chain where the independent review contributed the only finding, and it is a better argument
for keeping the review than any round where the two agreed.

## Gate T — a possessive says who owns the thing, not what it is

Scanning the whole head phrase fixed "the bank where my father works" and broke "the bank's
TRUSTEE", which is a person. Gate T found it; the self-attack did not.

The rule that resolves both: the words before an apostrophe say who owns the thing and the words
after it say what it is, so whatever follows the last possessive governs. A phrase with no
possessive is governed by all of itself, which is what keeps the relative-clause case an
organisation — nothing there is being owned.

    the bank's trustee        -> PERSON      (a trustee, belonging to a bank)
    my brother's company      -> NON_PERSON  (a company, belonging to my brother)

Same construction, opposite answers, and only the word after the apostrophe differs.

### The heredoc trap, fifth recorded occurrence

The fix was written into the file through a shell heredoc, and the `` in its regex became a
literal backspace character. The pattern matched nothing, both new tests failed, and the code read
correctly in every editor view — `od -c` was what finally showed `s  /` as `s` followed by byte
0x08.

`CLAUDE.md` says to write anything containing a regex with the editing tools and to reserve
heredocs for text with no backslashes. That rule exists because this has happened four times
before. It happened again because the surrounding work was going quickly and the heredoc was
convenient, which is exactly the condition the rule is written for.

Worth adding to the record: what caught it was not the hexdump but the TEST. Two assertions failed
immediately, and the investigation only had somewhere to go because the expected behaviour had been
written down before the fix was attempted.
