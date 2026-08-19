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
