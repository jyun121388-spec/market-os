# Interim Review Findings

Findings raised while Codex included usage is exhausted (HG-005, resets 2026-08-22). Everything
here is **interim**: local AI failed calibration (`docs/LOCAL_AI_CALIBRATION.md`), so nothing in
this file has had independent cross-model review. Every entry is marked for the Codex audit.

Review base: `a0eb92a` · Current HEAD: `f6ebb5b` · Branch `claude/market-os-development-7vnicg`

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
