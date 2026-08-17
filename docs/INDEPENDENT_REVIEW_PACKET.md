# Independent Review Packet — current HEAD

Supersedes the scope described in `docs/CODEX_REVIEW_PACKET.md` §0/§12. That document remains
useful for architecture context (§1–§11) and for the history of the first review round, but its
review range is obsolete and should not be used to bound a review.

| Field           | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Branch          | `claude/market-os-development-7vnicg`                                   |
| Review range    | `9b34f8b..ec83e39`                                                      |
| Scope           | **66 commits, 127 files, ~12,445 insertions / 611 deletions**           |
| Last reviewed   | `9b34f8b` — still the only commit an independent reviewer has ever seen |
| Reviewer status | **UNBLOCKED 2026-08-18** — see `docs/AI_REVIEW_RUNTIME_STATE.md`        |

**Range updated 2026-08-18.** The previous header bounded the review at `394933d`; 19 further
commits have landed since, including an entire interim hardening round and the v2 architecture
contracts. Reviewing the old range would miss all of it.

**Everything after `9b34f8b` is author-reviewed only.** A local model was calibrated as an interim
stand-in and disqualified — it reported defects in correct code on every blind sample and never
once cleared a clean control (`docs/LOCAL_AI_CALIBRATION.md`). Nothing in this range has had
independent review of any kind. Do not treat the volume of testing as a substitute: several of the
defects listed below had passing tests at the time they were wrong.

## Read this first

The first independent review returned REVISE with three P0s. All three were fixed. **One of those
fixes (H3) was itself defective and has since been re-fixed structurally.** A reviewer should
treat the previous round's conclusions as unverified rather than settled.

Since then, development moved from a cloud sandbox to a local machine with a real PostgreSQL
16.10, a real browser, and real network egress. That move, plus real SEC data in the database,
surfaced 20+ further defects — **none of which had a failing test, and several of which had
passing ones.**

Two patterns account for nearly all of them:

1. **Identity and ordering keys that cannot bear the weight put on them.** A read-then-write
   treated as atomic; a read-and-pick treated as ordered; a uniqueness key narrower than the real
   identity of the thing it constrains.
2. **Silence where there should be a signal.** Code that stores or displays less than it should
   while reporting success.

The most productive detection method was not reading code. It was looking at real numbers and
asking whether they were plausible:

| Number seen                                  | What it actually meant                        |
| -------------------------------------------- | --------------------------------------------- |
| 1000 filings for Apple                       | SEC's cap, not a count — 55% of history lost  |
| "933 inserted, 168 unchanged" on an empty DB | 168 facts silently discarded per ingest       |
| 2240 filings, 933 facts, **0** joinable rows | two adapters used different company ids       |
| 244 net-income rows vs 13 revenue rows       | ASC 606 tag transition unhandled              |
| Revenue **+232.9985%** QoQ                   | nine-month figure compared to a quarterly one |

---

## Highest-value attack targets, in order

### A1 — Filing Diff semantic comparability (`src/server/domain/filingDiff.ts`)

The worst defect found: it compared a nine-month figure ($364.357B) against a three-month figure
($109.417B) from the **same filing** — same period end, same accession — and reported +232.9985%
revenue growth. Confident, plausible, entirely fabricated, and displayed as a computed change.

Now requires the same period **length** and a **different** period end, or reports
INSUFFICIENT_DATA. Length is bucketed to whole months because fiscal quarters are not a fixed
number of days (Apple's run 89–98).

**Attack**: Is month-bucketing right for a 52/53-week fiscal year? Should a restatement of the
same period (same length, same end, different accession) be comparable — it currently is not,
because ends must differ. Is that correct, or is original-vs-restated a diff a user wants? Can
any path still produce a comparison across differing units or currencies?

### A2 — Fact identity (`prisma/migrations/20260817230000_*`, `edgar-xbrl/`)

A fact's identity includes `periodStart`. The old key omitted it, silently discarding 168 facts
per ingest. Enforced now as **two partial unique indexes** because `periodStart` is NULL for
instant concepts and a NULL in a unique key stops enforcing anything.

**Attack**: is any other unique constraint in `schema.prisma` narrower than the real identity of
what it constrains? Can two genuinely distinct facts still collide? Can a `frame` field
distinguish rows the key treats as identical?

### A3 — Revision chain (`src/server/domain/revisionChain.ts`, `seriesReadings.ts`)

H3's original fix used `orderBy: retrievedAt desc` on a `timestamp(3)` column — an original and
its revision written in the same millisecond are indistinguishable. **The same mistake existed
independently in three read paths**, deciding which number users see.

**Attack**: is there any path that writes an Observation with `isRevision = true` without going
through `upsertRevisionAwareObservation`, which could fork a chain? On a forked chain the code
takes the deterministically-newest tail rather than throwing — right call, or should it be hard?

### A4 — Completeness vs. success (`fred/`, `ecos/`, `dart/`, `edgar/` clients)

All four adapters treated page one as the whole answer. Each now pages to the provider's own
total and reports `truncated`, persisted to `IngestRun` and surfaced on `/admin`.

**Attack**: page-cap constants are arbitrary. Under what real query does a bounded loop still
under-fetch silently? Is `truncated` consumed anywhere that changes behaviour, or only displayed?

### A5 — Company identity (`edgar/normalize.ts`, `edgar-xbrl/normalize.ts`)

Filings stored SEC's padded CIK; XBRL stored the unpadded tracked constant. Zero joinable rows.
Both pad explicitly now, and the backfill migration is scoped to SEC_EDGAR because DART corp
codes are 8-digit identifiers in a different namespace.

**Attack**: is that scoping right? Can `Series.externalId` diverge the same way between adapters?

### A6 — Destructive-test database safety (`tests/support/testDatabaseGuard.ts`)

Fail-closed. `DATABASE_URL` set without `TEST_DATABASE_URL` refuses; same-database refuses;
non-disposable name refuses; production-like name refuses.

**Attack**: can the guard be bypassed by a setup file, a direct `prisma` import in a script, or a
test that constructs its own client? `auth-migration-upgrade.test.ts` creates and drops its own
database — is that derivation safe under the guard?

### A7 — Secret redaction (`src/server/adapters/redactSecrets.ts`)

`HttpTimeoutError` embedded the request URL; ECOS carries its key in the URL **path**. Persisting
ingest-run errors would have written a live key into `ingest_runs.error` and rendered it on
`/admin`. Redaction applies at the error constructor and again at persistence.

**Attack**: is there a path where a credential reaches a log or the database without passing
through `redactSecrets` — a Prisma connection error, an unhandled rejection, a provider echoing
the key in a response body?

### A8 — CALCULATION provenance (`src/server/domain/claimVerification.ts`)

`verifyFactClaim` always compared `claim.sourceId` to its evidence; `verifyCalculationClaim` did
not, and the claim text does not mention the source — so a change attributed to the wrong
provider verified as VERIFIED.

**Attack**: what else differs between the two verifier paths? They were written separately and
this was not the only asymmetry worth looking for.

### A9 — Ask Market guardrails (`src/server/domain/askMarket.ts`)

14 bypasses closed, including "price target" (only "target price" was covered) and two the
previous packet had itself documented as open.

**Attack**: the detector is biased toward false positives, so the more interesting direction is
the opposite — find an analytical question it now wrongly redirects. Seven controls exist. Also:
prompt injection, roleplay, quoted-advisor framing, mixed Korean/English.

### A10 — Watchlist authorization (`src/server/actions/watchlist.ts`)

`userId` comes only from the validated session cookie. No action accepts a `WatchlistItem.id` —
removal is addressed by `(itemType, itemRef)` resolved with the session user's id, so there is no
direct object reference to tamper with.

**Attack**: can input reach the domain layer without `parseItemType`? Does the 500-item cap have
a bypass via concurrent submissions racing the count check (known best-effort — documented)?

---

### A11 — Multi-source identity and provenance (added 2026-08-18)

**The dominant defect class in this range, and the least externally reviewed.** Four confirmed
defects, all the same shape: a business identifier is unique only _within_ a provider, and code
treated it as global.

- `financial_facts` has two unique indexes, both beginning `sourceId`. `Series` is unique on
  `(sourceId, externalId)` and never on `name`. The schema states the rule; four read paths ignored it.
- IR-001 `askMarket.findCompanyFacts` and IR-002 `computeCompanyXray` queried on `corpCode` alone.
  X-Ray displayed one `sourceCode` in its header while pooling filings, ticker, figures and filing
  list across every provider sharing that corp code.
- IR-007 / IR-008 are the mirror image: queries correctly scoped, but the **output** dropped the
  source, so `/ask` and `/today` rendered figures with no attribution at all.

Attack these specifically:

1. Is any remaining query keyed on `corpCode`, `externalId`, `receiptNo` or `accessionNumber`
   without `sourceId`? I found two intentional (`anyFiling` source selection, `findKnownCorpCodes`
   existence check) — **argue with both**.
2. `/company/[corpCode]` is routed on corp code alone, so with two providers sharing one the second
   is unreachable. Recorded as a known limitation. Is that acceptable, or a latent data-integrity bug?
3. Does any displayed `sourceCode` belong to a different provider than the values beside it?
4. `computeFilingDiff` receives `anyFiling.sourceId`. Is that provably the right source for every
   concept in `conceptUnits`?

### A12 — Ask Market guardrail completeness (extends A9)

49 bypasses closed across three passes; 21 in this range alone. The generalisable finding: **a
pattern added in one language, word order or format, and not the other.** `목표가` was covered while
`가격 목표` was not; `수익 보장` while `보장된 수익률` was not — the same word-order bug already fixed
once for English.

- `tests/askMarketAdversarial.test.ts` pins 21 bypasses and 18 legitimate questions.
  **The over-block cases matter as much**: 라면 is instant noodles as well as "if it were";
  `투자되어` is passive; 물가/수출 are macro series, not assets.
- Injection patterns were deliberately **not** added — `askMarket` makes no model call, so there
  is no instruction hierarchy to override. Challenge that reasoning if you disagree.
- Find bypasses these 60+ patterns still miss, and over-blocks that would refuse a real macro question.

### A13 — Test-database fail-closed guard and test realism

- `tests/support/testDatabaseGuard.mts` is applied at **config load** so an unsafe configuration
  throws before any connection opens. Rules run in a specific order — `sameTarget` before the
  name checks. Attack the ordering.
- `docs/EVOLUTION_LEDGERS.md` records the dominant test weakness: **fixtures containing one of
  something the real world has many of** — one duration, one CIK representation, one provider.
  Four separate defects trace to it. Which test families still have that shape?
- Which tests prove a helper but never exercise the actual request path? The Watchlist domain
  module once had zero callers, so cross-user isolation had never been tested through a request.

### A14 — v2 architecture contracts (design only, no implementation)

`docs/META_ARCHITECTURE_V2.md` and its five companions. **No code exists**; zero v1 source files
were touched. Review as design:

- Are the promotion criteria genuine negative controls, or do they only test for false negatives?
- Does the Reality Fabric contract miss a reality state that this project has already encountered?
- Is `EntityLink` (explicit cross-provider linking, never an implicit join) sufficient to prevent
  a recurrence of IR-001/IR-002 at v2 scale?

## Exact commands

```bash
export TEST_DATABASE_URL="postgresql://postgres:devpassword@127.0.0.1:55432/market_os_test?schema=public"
npm run test          # 302 tests
npm run e2e           # needs `npm run start`; 30 checks against the production build
npm run verify:live:edgar   # 67 live contract checks; needs EDGAR_USER_AGENT
npx prisma migrate deploy
```

## Invariants a fix must not break

- No fabricated financial values. Missing data is reported as missing, never inferred.
- A computed change compares only semantically comparable facts.
- Every FACT/CALCULATION claim traces to a stored source record.
- No personalized buy/sell/allocation/target output from Ask Market.
- No score, rating or valuation on any company surface.
- Secrets never reach logs, the database, or rendered output.
- Tests never touch a non-disposable database.

## Known external gates (not review findings)

`HG-001` push auth · `HG-002/3/4` FRED/ECOS/OpenDART keys · `HG-005` independent review
· `HG-006` LLM runtime funding · `HG-007` production deploy · `HG-008` payments.
See `docs/HUMAN_GATE_QUEUE.md`.
