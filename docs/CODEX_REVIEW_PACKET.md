# Codex Review Packet

Prepared because no Codex session has been available in this development environment at any
point across the M00-M28 build-out. This packet exists so that whenever a Codex session (or any
independent reviewer) becomes available, review can start immediately without re-deriving
context. It is not a substitute for the review — `docs/REVIEW_DEBT.md`'s M01-M22 row stays
`PENDING` until an actual independent review happens.

**Review path**: `codex-cli` (via `npx @openai/codex`) requires an interactive ChatGPT login
(`npx @openai/codex login`), which this remote/cloud development environment cannot complete —
confirmed 2026-08-16 (`npx @openai/codex login status` → "Not logged in", no OpenAI API key
configured or used, per `CLAUDE.md`'s zero-extra-cost rule). This is an environment limitation,
not a product defect, and is not a reason to build workarounds. **The defined final-review path
is: run this packet's procedure (§12) from a local development machine where a human has already
completed `codex login` with their own ChatGPT account.** Nothing else in this document changes
based on where Codex runs — only §12's login precondition differs from a hypothetical
already-authenticated cloud session.

## 0. THIS IS A RE-REVIEW — read this section first, then §12

A local-Codex review already ran once against this branch and returned **REVISE** with 3 P0/HIGH
blockers. All 3 have been fixed, each with a dedicated real-Postgres regression test that did not
exist before. This section is a scoped index so a re-reviewer doesn't need to re-read the whole
repository — go straight to the 3 files/tests below, confirm each BEFORE failure mode is actually
closed, then decide whether anything else in the diff needs a look.

**Diff to review**: `git diff 9b34f8bb6be120dacd381fe22577870f40d6e5fa..HEAD`
(`9b34f8b` was the exact head the first review ran against; HEAD is currently
`3fd6533192ab6e76d994d9484633d53b3b87248d`).

**⚠ The scope is wider than it was, and one item below has already proved to be wrong once.**
Earlier versions of this packet pointed at the fix-round commit `8f4f76c` alone. Do not use that
range. A subsequent local-verification round (2026-08-17) found that the B3 fix **was itself
defective**, and found four further defects that the cloud test environment had reported as
green. Read §0.1 before §0's B1-B3.

Full packet still applies for anything not covered here (§1-11 below are unchanged architecture
context); §2's SHAs and §9's test count are updated for this round.

## 0.1 ROUND 2 — what changed after the first fix round, and why you should be sceptical of it

Between the first fix round and now, development moved from a cloud sandbox to a local machine
with a real PostgreSQL 16.10, a real browser, and real outbound network — none of which the
sandbox had. Running the existing, already-"passing" work on real infrastructure falsified four
green results. The relevant fact for a reviewer: **a 209/209 green suite was accurate about the
environment that produced it and wrong about the product.** Weight the test evidence in this
packet accordingly, and prefer reading the code over trusting a passing test name.

### R1 — B3's fix was defective and has been re-fixed (highest-priority item in this review)

The B3 fix below is correct about the partial unique index and the ON CONFLICT insert. It was
wrong about how it found the revision chain's "latest" row: `orderBy: { retrievedAt: "desc" }`.
Prisma maps `DateTime` to Postgres `timestamp(3)`, so an original and its revision written in
the same millisecond carry identical timestamps and Postgres may return either first. On the
unlucky ordering the code compared the incoming value against the ORIGINAL, decided a revision
was needed, attempted to attach a second child to a parent that already had one, and — after
exhausting all 20 retries against the same ambiguous read — surfaced a raw P2002.

Note what this means for the B3 evidence below: the three concurrency tests all passed, and the
bug was **not concurrency-only**. A plain sequential re-ingest of already-revised data
reproduced it (`fred-ingest` "is idempotent"). The concurrency tests were aimed at the wrong
axis of the problem.

Now fixed structurally: the tail is the row no other row points at via `revisionOf`. The
4-column unique constraint guarantees at most one child per parent, making the chain a linked
list with exactly one tail, so the answer no longer depends on timestamp resolution. A chain
with no tail (a cycle) throws explicitly rather than looping.

- **Where**: `src/server/domain/observationIngest.ts`, `findRevisionChainTail()`.
- **Try to break it**: is there any path that writes an `Observation` with `isRevision = true`
  without going through this function, which could fork the chain and produce two tails? The
  code takes the deterministically-newest tail in that case rather than throwing — is that the
  right call, or should a forked chain be a hard error?

### R2 — Two Windows process-spawn defects, one of which hid a regression test

- `tests/integration/auth-migration-upgrade.test.ts` — the B1 regression test — spawned `npx`.
  That is ENOENT under the bare name on Windows and EINVAL as `npx.cmd` (Node's CVE-2024-27980
  mitigation refuses to spawn a `.cmd` without a shell). The suite died in `beforeAll`, before
  its first assertion. **The B1 migration upgrade-safety guarantee was therefore unverified on
  that platform while reporting as a passing file.** Now invokes Prisma's CLI entry point
  directly via `process.execPath`.
- `scripts/run-ingest-jobs.ts` spawned `npm` (`npm.cmd` on Windows). Worse failure mode:
  `spawnSync` returns `status: null` rather than throwing, so every job would have been reported
  as an ordinary FAILED job instead of never having started.
- **Try to break it**: are there other `spawn`/`execFile` call sites assuming a POSIX binary
  name? Are there other tests whose `beforeAll` can fail in a way that reads as skipped?

### R3 — Real SEC schema drift (both EDGAR adapters were unverified against live data)

`scripts/verify-edgar-live.ts` (new) checks both EDGAR adapters against real data.sec.gov. First
run found SEC returns `fy: null, fp: null` on some companyfacts rows — facts republished for a
`frame` under a later restating filing. Both adapter types and both `financial_facts` columns
were non-nullable, so a real ingest would have failed on the first such row. Apple alone has 20
across the six tracked concepts.

Widened rather than dropped, because the fact is fully sourced — value, period, form and
accession number are all real — and only the label is absent. Deriving a fiscal year from
`periodEnd` was rejected outright: that stores an inference in a column readers treat as
reported data.

- **Where**: `prisma/migrations/20260817120000_financial_fact_nullable_fiscal_label/`,
  `src/server/adapters/edgar-xbrl/{types,normalize}.ts`, `src/server/domain/askMarket.ts`.
- **Evidence**: 55/55 live contract checks, real ingest of 1000 filings and 1099 facts, then a
  re-ingest returning 0 inserted / all unchanged.
- **Try to break it**: is there any consumer that still assumes a non-null `fiscalYear`? Does
  `/ask` render the null case in a way that could be mistaken for a reported value?

### R4 — Silent pagination truncation in all three keyed adapters

FRED, ECOS and OpenDART each fetched the first page and treated it as the whole answer, while
the field that says otherwise (`count`, `list_total_count`, `total_page`) was received and
ignored. DART is the clearest: one request with `page_count=100`, and Samsung Electronics files
well over 100 disclosures a year. Nothing failed and nothing warned — the database held a
partial series that read as complete, feeding every downstream What Changed / Macro Regime /
Historical Analog calculation.

Each client now has a paginating variant, walks until the provider's own total is satisfied, and
returns `truncated` plus that total so an incomplete result announces itself. Loops are bounded.

- **Where**: `src/server/adapters/{fred,ecos,dart}/{client,ingest}.ts`,
  `tests/adapters/pagination.test.ts`.
- **Note**: this was found by reading the adapters against their own documented response shapes,
  not by a live run. FRED/ECOS/OpenDART remain **LIVE_KEY_PENDING** — the free keys do not exist
  yet, and `scripts/verify-{fred,ecos,dart}-live.ts` are written and waiting. Treat the
  pagination fix as correct-by-construction, not as live-verified.
- **Try to break it**: the page-cap constants are arbitrary. Under what real query does a bounded
  loop still silently under-fetch? Is `truncated` actually consumed anywhere that matters, or is
  it a field nobody reads?

### R5 — Watchlist now has a real request path (new attack surface since your last review)

M19's Watchlist domain module had zero callers, so its per-user scoping had never been exercised
through an HTTP request. It now has one: `src/server/actions/watchlist.ts` and `/watchlist`.
This is genuinely new surface and deserves review attention rather than a skim.

Design decisions worth challenging: `userId` comes only from the validated session cookie, never
the form. No action accepts a `WatchlistItem.id` — removal is addressed by `(itemType, itemRef)`
resolved together with the session user's id, so there is no direct object reference to tamper
with. A self-audit found and fixed an unused exported server action (a "use server" export is a
reachable endpoint whether or not a page calls it), an unbounded per-user row count, and an
upsert that could surface a raw P2002 under concurrent submission.

- **Try to break it**: can any input reach the domain layer without passing `parseItemType`? Does
  the 500-item cap have a bypass via concurrent submissions racing the count check? Is
  `revalidatePath` enough, or can a stale render leak another user's rows?

### R6 — DART date validation was missing the impossible-date guard

`rcept_dt` was validated with `\d{8}` only, which proves the shape and not the date: `20260230`
passes and `Date.UTC` silently rolls it to Mar 2, storing a filing under a date DART never
reported. FRED and ECOS received `assertValidCalendarDate` in the 2026-08-16 P1 pass; DART was
missed. Now covered.

### R7 — the R1 bug was ALSO in the read path, deciding what users see

Worth reading immediately after R1, because it is the same mistake in the layer that matters
most. `getRecentObservationPair` — which feeds What Changed, Macro Regime, Ask Market and Today —
resolved "which row wins for this observation date" with `orderBy: retrievedAt desc` plus
`distinct`, and its docstring asserted that this respected revisions. It does not, for the same
`timestamp(3)` reason as R1: an original and its revision written in the same millisecond are
byte-identical on that column, so Postgres may return either and `distinct` keeps whichever came
first.

Ingesting a revision immediately after its original is the normal path, so this was not an edge
case, and the wrong answer was non-deterministic rather than consistently wrong. For a product
whose central claim is that displayed numbers trace to a source, showing a superseded value as
current is close to the worst available failure, and it leaves no trace — 1.00 instead of 1.50 is
a perfectly plausible number.

A sweep of every Observation read found two more independent instances of the same query:
`economicCalendar.ts` (renders `lastObservedValue`) and `historicalAnalog.ts` (z-scores every
point, so one superseded value skews the whole comparison). Three call sites, three independent
instances.

- **Where**: `src/server/domain/revisionChain.ts` (pure tail-finding, now shared with the ingest),
  `seriesReadings.ts`'s `getRecentObservationPair` and `getObservationsOneRowPerDate`.
- **Regression test**: `tests/integration/series-readings-revisions.test.ts` writes original and
  revision with IDENTICAL `retrievedAt`, which is the state the old code could not resolve and
  which re-running would never reliably surface.
- **Try to break it**: `claimVerification.ts` looks observations up by exact id from a claim's
  evidence, which should be immune — is it? Is there any remaining path that reads an Observation
  value without going through `revisionChain.ts`?

### R8 — provider API keys were reaching logs, the database, and /admin

`HttpTimeoutError` embeds the request URL in its message; ECOS puts its key in a PATH segment,
FRED and DART in a query parameter. Already bad as console output, and made materially worse by
the new ingest-run persistence: one upstream timeout would have written a live key into
`ingest_runs.error` and rendered it on the authenticated /admin page.

`redactSecrets` redacts the actual configured credential values wherever they appear — exact
rather than pattern-based, so it covers path segments, query parameters and echoed headers alike,
including a provider added later that nobody wrote a pattern for — plus known credential
parameter names as a second layer.

- **Try to break it**: is there a path where a credential reaches a log or the database without
  passing through `redactSecrets`? Prisma error messages on a failed connection, for instance.

### R9 — a third instance of read-then-write treated as atomic

After the observation chain (R1) and the watchlist upsert (R5), the EDGAR/DART/XBRL ingests all
did `findUnique` → `create`. Confirmed real before fixing: the old pattern run four ways
concurrently rejected 3 of 4 with P2002. Sequential runs never hit it, which is why it survived,
and a real scheduler is one Human Gate away. `insertIfAbsent` now treats a lost race as
"already there" and counts it as `unchanged` rather than `inserted` — an inflated insert count
is quieter than a crash but still a false report.

### R10 — third-party input interpolated into a URL

`filings.files[].name` came from SEC's response and was placed straight into a request URL. Path
traversal or an absolute URL in that field would send the request elsewhere. Now constrained to
the filename shape SEC documents.

### R11 — observability, and the honest limits

`truncated` was a field nothing read — the packet asked about this directly under R4. Ingest runs
are now persisted (`IngestRun`, additive migration) and surfaced on /admin as fetched vs. the
provider's own total. SUCCESS / PARTIAL / FAILED are kept distinct, because collapsing PARTIAL
into SUCCESS is how a partial dataset comes to read as a whole one.

Two things were deliberately NOT done, and should be reviewed as decisions rather than omissions:

- Re-ingesting 2240 filings runs in 2.7s despite a per-row `findUnique`. The N+1 is real, the
  workload is not, so it was measured and left alone.
- `Observation.releaseDate` is still never populated. FRED's `realtime_start` looks like the
  missing release date and is not one — under default parameters FRED returns the vintage as of
  today, so a 1990 observation arrives stamped with today's date. Mapping it would fill a
  provenance column with a confident, checkable, wrong answer. See `docs/REVIEW_DEBT.md`'s M08.

### Current verification state (2026-08-17)

264/264 tests against a real local PostgreSQL 16.10, `npm run e2e` 24/24 in a real browser,
59/59 live EDGAR contract checks, all 13 migrations applied cleanly to a genuinely fresh
database, lint/typecheck/format/production build clean. Nothing in this packet is self-declared
APPROVE, and no provider other than SEC EDGAR is claimed live-verified.

**The single most useful thing a reviewer can do with this packet**: note that R1, R5, R7 and R9
are four instances of one mistake — a read-then-write, or a read-and-pick, treated as atomic or
as ordered when the ordering key cannot bear the weight. Three were found only after the first
one was fixed and its shape was known. If a fifth exists, it is likely in code none of R1-R11
touched.

### B1 (was P0/HIGH) — Auth migration upgrade safety

- **BEFORE**: `prisma/migrations/20260816001500_auth/migration.sql` did
  `ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL, ADD COLUMN "passwordHash" TEXT NOT NULL`
  with no `DEFAULT` — Postgres rejects this against any `users` table with pre-existing rows, so
  the migration could only ever succeed against an empty table. M19 (Watchlist) shipped before
  M22 (Auth), so a real deployment could have pre-existing `User` rows via `WatchlistItem` FKs.
- **AFTER**: staged migration (nullable → legacy backfill with a synthetic, unguessable identity
  and a non-credential sentinel hash → `NOT NULL`); `signIn()` rejects `isLegacyAccount` users
  before ever calling `verifyPassword` on the sentinel.
- **Regression test**: `tests/integration/auth-migration-upgrade.test.ts` (new) — real Postgres,
  applies pre-auth migrations, inserts a pre-auth-schema `User`+`WatchlistItem` fixture, applies
  the rest, asserts survival/FK-integrity/legacy-flagging/constraint-enforcement. Plus a
  `signIn()` legacy-rejection case in `tests/integration/auth.test.ts`.
- **Changed files**: `prisma/schema.prisma`, `prisma/migrations/20260816001500_auth/migration.sql`,
  `src/server/domain/auth.ts`.
- **Try to break it**: does any code path still construct a `User` row without going through the
  migration's backfill or `signUp()`? Does `signIn()` truly short-circuit before touching
  `passwordHash` for a legacy row, or could a code change accidentally reorder those checks?

### B2 (was P0/HIGH) — Claim verification structural redesign

- **BEFORE**: `claimVerification.ts` decided FACT `VERIFIED` via
  `claimText.includes(String(observation.value))` — `"3.5"` is a substring of `"13.50"`, so an
  evidenced observation with a wrong value could false-positive as verified.
- **AFTER**: exact-text reconstruction from re-fetched DB rows via shared builders
  (`buildFactClaimText`/`buildChangeClaimText`, used by both the creation and verification paths
  so they can't drift), plus explicit series/source identity checks, chronological-order checks,
  and full recomputation of CALCULATION's absoluteChange/percentChange/bpsChange.
- **Regression tests**: `tests/integration/claim-verification.test.ts`'s new "H2 adversarial
  regressions" block (9 cases) — the exact `3.5`/`13.50` collision, false claimText vs. true
  evidence, wrong `evidence.seriesId`, cross-series CALCULATION, reversed current/previous, and
  tampered absolute/percent/bps changes.
- **Changed files**: `src/server/domain/claimVerification.ts`, `src/server/domain/claimStore.ts`,
  `src/server/domain/whatChanged.ts`.
- **Try to break it**: is there any numeric formatting edge case (locale, trailing zeros, decimal
  precision) where the reconstructed text could legitimately differ from the stored text for a
  truly-correct claim, causing a false `VALUE_MISMATCH`? Is there any claim shape that skips the
  final `claim.claimText !== expectedText` check entirely?

### B3 (was P0/HIGH) — Concurrent observation ingestion race — ⚠ SEE R1: THIS FIX WAS DEFECTIVE

**Read §0.1's R1 before this section.** What follows describes the first fix round as it was
written. The partial-unique-index and ON CONFLICT parts are still accurate; the "latest row"
lookup described here was wrong and has since been replaced. The three regression tests cited
below all passed against the defective version.

- **BEFORE**: `upsertRevisionAwareObservation()` did `findFirst` then `create` — the old
  `@@unique([seriesId, observationDate, isRevision, revisionOf])` constraint does not block two
  concurrent "original" inserts, because Postgres treats `NULL` as distinct from `NULL` and every
  original row has `revisionOf = NULL`.
- **AFTER**: a NULL-free partial unique index (`observations_series_date_original_unique` on
  `(seriesId, observationDate) WHERE isRevision = false`) plus an atomic
  `INSERT ... ON CONFLICT ... DO NOTHING RETURNING id` for "become original," and a bounded
  optimistic-retry loop (catching Prisma `P2002`) for "become a revision."
- **Regression tests**: `tests/integration/observation-ingest-concurrency.test.ts` (new) — (A) 8
  concurrent same-value writers → exactly 1 original; (B) 6 concurrent different-value writers →
  exactly 1 original plus a verified acyclic revision chain; (C) a direct duplicate-original
  insert bypassing the app layer → rejected by the DB constraint itself. Stable across 6 repeated
  runs.
- **Changed files**: `prisma/schema.prisma`, new migration
  `prisma/migrations/20260816090000_original_observation_unique/migration.sql`,
  `src/server/domain/observationIngest.ts`.
- **Try to break it**: is `MAX_REVISION_RETRIES = 20` actually sufficient under higher contention
  than the 6-8-way tests exercise? Is there any insert path into `observations` (a script, a
  seed, a different domain function) that bypasses `upsertRevisionAwareObservation()` entirely
  and could still race?

### P1s fixed alongside (not blockers, but touched in this diff)

Ask Market guardrail bypass phrasing (`src/server/domain/askMarket.ts`), a `fetch` timeout on
every external adapter client plus a subprocess timeout on `scripts/run-ingest-jobs.ts`
(`src/server/adapters/httpTimeout.ts`, new), and impossible-calendar-date rejection in FRED/ECOS
date parsing (`src/server/adapters/dateValidation.ts`, new). Full detail in
`docs/DECISIONS.md`'s 2026-08-16 P1 entries — lower priority for re-review time, worth a glance
only if B1-B3 look clean.

## 1. Architecture summary

Market OS is a modular-monolith Next.js 16 (App Router) + TypeScript app, PostgreSQL via Prisma
7 (driver-adapter pattern — no `datasource.url` in `schema.prisma`; connection string only in
`prisma.config.ts`/`src/server/db/client.ts`). Vitest for unit/integration tests (integration
tests run against a real local Postgres, `fileParallelism: false`). Playwright for real-browser
E2E (`scripts/e2e-full-walkthrough.ts`, `npm run e2e`).

Core pipeline (see `docs/ARCHITECTURE.md`): SOURCE DATA → NORMALIZATION → FACT → CALCULATION →
INFERENCE → PRESENTATION. Every FACT/CALCULATION claim traces to a stored `Observation`/`Filing`/
`FinancialFact` row with `sourceId`/`retrievedAt`. `Claim` rows carry `claimType`
(`FACT|CALCULATION|INFERENCE`), `evidence` (JSON pointing at the underlying row(s)), and are
independently re-verified by `src/server/domain/claimVerification.ts`'s `verifyClaim()` (re-reads
the DB, doesn't trust the claim's own text).

No product-runtime LLM/paid-API calls exist anywhere in the codebase. All FACT/CALCULATION
computation is deterministic arithmetic. This is a deliberate, load-bearing architectural
constraint (`CLAUDE.md`'s zero-extra-AI-cost rule), not an oversight — see the "critical
invariants" section below.

## 2. PR / commit scope

- PR: `jyun121388-spec/market-os#1`, branch `claude/market-os-development-7vnicg` → `main`.
- **BASE SHA**: `df56ace3ab27c2a7cb6bf52e95153d4a8dd06f7e` (tip of `main` at branch creation —
  `main` has had no other commits since, so this is still `main`'s current tip as of
  2026-08-16).
- **HEAD SHA**: `8f4f76ca74e01f1b9541a7f7295521f3eda08803` (tip of
  `claude/market-os-development-7vnicg` as of 2026-08-16 — the fix round for the first Codex
  REVISE verdict, applied on top of the previously-reviewed `9b34f8b`).
  **Before running the review, re-verify this is still the actual head** — `git ls-remote
origin claude/market-os-development-7vnicg` or the PR page — in case a newer commit landed
  after this packet was last updated. If the head has moved, update this line (and re-run
  `npm run verify`/`npm run e2e` locally to confirm the new head is still green) before treating
  the review as covering the real current state.
- **This is a RE-REVIEW.** See §0 above for the scoped fix-round diff
  (`9b34f8b..8f4f76c`) and the exact BEFORE/AFTER/test/files for each of the 3 blockers the first
  review found. The full history below (35+ commits from an empty repo through M00-M28 plus
  post-M28 follow-up) is still accurate background, just not what changed in this round.
- 160+ files changed, ~21k lines added across the full history
  (`git diff --stat df56ace3ab27c2a7cb6bf52e95153d4a8dd06f7e...9b34f8bb6be120dacd381fe22577870f40d6e5fa`);
  28 files changed in the fix round alone
  (`git diff --stat 9b34f8bb6be120dacd381fe22577870f40d6e5fa...8f4f76ca74e01f1b9541a7f7295521f3eda08803`).
- Full commit history and reasoning for every non-obvious decision: `docs/DECISIONS.md`
  (chronological, append-only, ~37 entries).

## 3. Critical invariants (things a reviewer should specifically try to break)

1. **No fabricated financial data.** A FACT claim with no source is a bug per
   `docs/ARCHITECTURE.md`. Adapters never coerce a missing/non-numeric value to 0 — see
   `src/server/adapters/ecos/normalize.ts`'s `skippedMissing` handling.
2. **Revisions are never silently overwritten.** `src/server/domain/observationIngest.ts`'s
   `upsertRevisionAwareObservation()` inserts a new row with `isRevision`/`revisionOf` rather
   than mutating history.
3. **No fabricated composite scores.** Macro Regime (`macroRegime.ts`) reports per-series
   readings, never a single 0-100 "regime score." ETF X-Ray has a schema-level guardrail test
   (`tests/etfSchemaGuardrail.test.ts`) proving no score/rating field can exist.
4. **Correlation never becomes causation.** `CausalEdge.counterexamples` is a required (not
   optional) `String` column — the schema itself rejects an edge with no acknowledged limitation.
5. **No personalized investment advice.** `src/server/domain/askMarket.ts`'s
   `detectPersonalizedAdviceRequest()` is the enforcement point — try to phrase a buy/sell/
   allocation/guaranteed-return request that evades it (see §7 below for specific attack
   prompts worth trying).
6. **Session tokens are unpredictable, not just unique.** `src/server/domain/auth.ts`'s
   `createSession()` generates the token via `crypto.randomBytes(32)`, explicitly overriding
   Prisma's `@default(cuid())` (see the M26 DECISIONS.md entry for why `cuid()` alone isn't
   sufficient for a bearer token).
7. **No user can see another user's data.** Every `Watchlist`/session query is scoped by
   `userId` at the domain-function boundary — but note (§8 below) there is currently no
   user-facing page wired to the watchlist domain module, so this invariant is currently only
   testable at the function level, not via a real HTTP request.

## 4. Financial-data risks worth independent scrutiny

- **Unit/timezone correctness**: `src/server/adapters/{ecos,dart}/normalize.ts` parse date-only
  source values as UTC midnight (`Date.UTC(...)`), explicitly to avoid server-timezone
  dependence — see `tests/adapters/{ecos,dart}-normalize.test.ts`'s "KST calendar-date
  boundaries" test groups for the specific edge cases already covered (Korean New Year's Eve/Day,
  leap day). `src/server/domain/whatChanged.ts`/`seriesReadings.ts` distinguish percent change
  from basis-point change (`bpsChange` only computed when `unit === "percent"`).
- **Live-shape verification gap**: FRED/ECOS/DART/EDGAR adapters were built against documented
  API shapes from training knowledge, NOT verified against live responses — this dev sandbox
  blocks egress to every financial-data-provider domain tested (confirmed via WebFetch probes,
  logged per-adapter in `docs/REVIEW_DEBT.md`). This is the single largest category of
  unverified risk in the codebase. A reviewer with live network access to any of these providers
  could meaningfully de-risk this by running `npm run ingest:<adapter>` against a real API key
  and diffing actual vs. expected shapes.
- **No cross-source `DataConflict` detection wired to a live pair of overlapping sources** — the
  `DataConflict` model and manual-insert path are tested, but no adapter currently compares its
  own value against a second source covering the same real-world variable (needs ≥2 tracked
  overlapping sources first — see `docs/REVIEW_DEBT.md`'s M08 row).

## 5. Auth/security risks worth independent scrutiny

- `src/server/domain/auth.ts`: scrypt (N=16384, r=8, p=1 — Node's documented interactive-login
  recommendation), per-user salt, `crypto.timingSafeEqual` comparison, generic "Invalid email or
  password" error (no enumeration signal, verified by test), 5-failed-attempt/15-minute lockout
  (process-local `Map`, not distributed — see `docs/REVIEW_DEBT.md`'s M26 row for the known
  limitation).
- `src/server/actions/auth.ts`: session cookie is `httpOnly`, `secure` in production,
  `sameSite: "lax"`. CSRF is not separately implemented — relies on Next.js Server Actions'
  built-in same-origin enforcement (reviewed, not independently re-verified against this exact
  Next.js version's behavior by a second party).
- A `security-review` skill pass (independent finder + verifier Claude sub-agents, not Codex) ran
  against the full diff and found zero high-confidence findings — see `docs/DECISIONS.md`'s
  "Ran the security-review skill" entry for exactly what was checked and the one candidate
  finding that was verified as a false positive. Treat this as a first pass, not a substitute.

## 6. Ask Market / legal guardrail architecture

`src/server/domain/askMarket.ts` is the enforcement point for `docs/LEGAL_GUARDRAILS.md`'s hard
prohibitions. It is a deterministic MVP (topic search, not free-text NLP) — see its module
docstring for the full scoping rationale. The pattern list (`ADVICE_REQUEST_PATTERNS`) is the
single most safety-critical piece of code added this pass: a false negative here (a personalized
advice request that isn't detected) would let a buy/sell-shaped question through to a plain
factors response, which is _not_ itself giving advice (the factors response never contains a
recommendation), but is a gap in the "always redirect" requirement. A 2026-08-16 fix round
(P1 recommendation from the first Codex review) closed several bypasses that used to slip
through — see `docs/DECISIONS.md`'s P1 entry — but this is still not exhaustive. Recommended
specific test inputs for a reviewer, in addition to `tests/askMarket.test.ts`'s existing 14 cases:

- ~~Indirect phrasing: "would now be a wise time to add to my position"~~ — **closed 2026-08-17.**
  Anchoring on the action plus a possessive object (`add to … my position`) rather than on the
  `should i …` question form.
- ~~Third-person framing: "is Samsung Electronics a buy right now"~~ — **closed 2026-08-17.**
  Only the "…right now" variant had been caught, incidentally, by the proximity rule; the bare
  "is X a buy" form needed its own pattern.
- Also closed in the same pass, each a phrasing a real user would plausibly type: "price target"
  (the reverse word order of the already-covered "target price", and an explicitly prohibited
  output), 목표가/목표주가, bare "Should I invest?" with no object, "Should I take profits / cut
  my losses", "Hold or sell?", entry/exit timing ("is now a good time to get in"), position
  sizing ("how much of my portfolio"), "best stocks to buy", and Korean 익절/손절/들어가도
  될까요/비중 조절. See `tests/askMarket.test.ts`.
- Non-English languages other than Korean remain **not handled at all** — a real, acknowledged
  gap, not hidden: the pattern list is English + Korean only. Note this is the honest limit of a
  deterministic pattern approach, and it is one of the arguments for the M21 LLM decision rather
  than something to keep patching.
- **Try to break it**: the detector is deliberately biased toward false positives, so the more
  interesting attack is the other direction — find an analytical question it now wrongly
  redirects. `tests/askMarket.test.ts` holds seven such controls sharing vocabulary with the
  patterns ("target", "hold", "exit", "position", "buying"); more would be welcome.
- Numeric price targets without "will": "1400 KRW/USD by Q2" (currently NOT caught — the pattern
  requires the word "will"; this is a real gap worth flagging).

## 7. Provenance architecture

`Claim.evidence` (JSON) always points at a specific `Observation.id` (or pair, for CALCULATION).
`verifyClaim()` re-reads that Observation from the DB and checks both that the claim text
contains the actual stored value AND that `claim.sourceId` matches the observation's source —
not just that `evidence` is shaped correctly. This was independently re-verified this session (a
"Pre-Release Audit" pass, see `docs/DECISIONS.md`'s M28 entry) by running `verifyClaim()` against
every real `Claim` row in the dev database, including deliberately-broken fixtures — all
correctly VERIFIED or correctly rejected with the right failure code.

## 8. Important files (highest review priority, in order)

1. `src/server/domain/auth.ts` + `src/server/actions/auth.ts` — credential/session handling.
2. `src/server/domain/askMarket.ts` — legal guardrail enforcement.
3. `src/server/domain/claimStore.ts` + `claimVerification.ts` — the anti-hallucination core.
4. `src/server/domain/observationIngest.ts` — revision-safety for every adapter.
5. `prisma/schema.prisma` — data model, especially `CausalEdge.counterexamples` (required),
   `Etf`/`EtfHolding` (no score field), `Claim` (claimType/evidence).
6. `src/server/adapters/*/normalize.ts` — the actual parsing logic for each data source.

## 9. Test commands

```
service postgresql start                         # local Postgres 16 must be running
export DATABASE_URL='postgresql://market_os:market_os_dev@localhost:5432/market_os?schema=public'
npm run verify                                    # format + lint + typecheck + test + build
npm run dev                                       # then, in another shell:
npm run e2e                                       # real-browser E2E walkthrough
```

209/209 automated tests passing as of this packet's writing (up from 184 — 25 new regression
tests added in the fix round: 1 migration-upgrade, 1 legacy-signin, 9 H2 adversarial, 3 H3
concurrency, 3 Ask Market bypass, 3 httpTimeout, 6 impossible-date).

## 10. Known limitations (not hidden, see docs/REVIEW_DEBT.md for the full list)

- M21 Ask Market: deterministic topic-search safe mode only; free-text conversational Q&A
  requires a live LLM and remains `BLOCKED_HUMAN_GATE`.
- Most external adapters (FRED/ECOS/DART/EDGAR) are unverified against live responses (egress
  blocked in this dev sandbox).
- No distributed rate limiting (process-local only).
- Watchlist domain module exists and is tested but has no wired-up user-facing page yet.
- ETF/Real Estate/some other milestones ship schema + algorithm only, no live ingestion adapter
  (issuer holdings files and Korean real-estate data portals are not stable documented public
  APIs the way FRED/ECOS/DART/EDGAR are — see the respective DECISIONS.md entries for why a
  guessed-format adapter was rejected as too fabrication-prone).

## 11. Specific questions for the reviewer to attack

1. Can `detectPersonalizedAdviceRequest()` be evaded with phrasing that a reasonable person would
   still recognize as a buy/sell request? (See §6 for known gaps already identified.)
2. Does `verifyClaim()` have any path where a claim's `evidence` could reference a row from a
   _different_ series/source than `claim.sourceId` claims, without being caught?
3. Is there any path where `Observation.value` could be written without going through
   `upsertRevisionAwareObservation()`, bypassing revision tracking?
4. Does the session-lockout `Map` in `auth.ts` have a memory-growth concern under sustained
   attack (many distinct emails, never cleared)? (Believed low-risk given it's an explicitly
   excluded DOS category per this session's own security-review pass, but worth a second look.)
5. Any XSS surface in how `askMarket.ts`'s results (which include externally-sourced `corpName`,
   `concept`, `mechanism` strings) are rendered in `src/app/ask/page.tsx`? (React auto-escapes
   text content by default and no `dangerouslySetInnerHTML` is used anywhere in the codebase —
   confirmed via grep — but worth independent confirmation.)

## 12. How to run the review (local machine, logged-in Codex only)

Precondition: a human has run `npx @openai/codex login` on their own machine with their own
ChatGPT account and it succeeds (`npx @openai/codex login status` reports logged in). This
cannot be done from an unattended/headless session — it requires an interactive browser OAuth
flow. Do not attempt this with an API key instead; that is a different, paid cost category and a
Human Gate per `CLAUDE.md`.

```bash
git clone https://github.com/jyun121388-spec/market-os.git
cd market-os
git checkout claude/market-os-development-7vnicg
git rev-parse HEAD   # confirm this matches §2's HEAD SHA above; if not, update the packet first

npx @openai/codex login status   # must show logged in before proceeding
```

**This is a re-review.** Scope it to the fix-round diff first (§0 above), then the same
release-critical surface as before if time allows (most of the repo is unremarkable adapter/
domain code already covered by tests — the packet's §3/§4/§5/§6 sections are the actual risk
surface):

```bash
npx @openai/codex exec \
  --sandbox read-only \
  "This is a RE-REVIEW: a prior run of this exact review returned REVISE with 3 P0 blockers. \
Read docs/CODEX_REVIEW_PACKET.md section 0 first — it has the exact BEFORE/AFTER/regression-test/ \
changed-files for each of the 3 blockers (auth migration upgrade safety, claim verification \
substring collision, concurrent observation ingestion race) as fixed in commit \
8f4f76ca74e01f1b9541a7f7295521f3eda08803. Verify each fix actually closes the failure scenario \
the original blocker described — do not just check that code changed. \
Diff prior head 9b34f8bb6be120dacd381fe22577870f40d6e5fa against new head \
8f4f76ca74e01f1b9541a7f7295521f3eda08803 for the fix-round changes specifically. \
If time allows, also re-check the broader release-critical surface: src/server/domain/auth.ts, \
src/server/actions/auth.ts, src/server/domain/askMarket.ts, src/server/domain/claimStore.ts, \
src/server/domain/claimVerification.ts, src/server/domain/observationIngest.ts, \
prisma/schema.prisma, and src/server/adapters/*/normalize.ts \
(full diff base df56ace3ab27c2a7cb6bf52e95153d4a8dd06f7e). \
Output your findings as a single JSON object matching the schema in \
docs/CODEX_REVIEW_PACKET.md section 13, and nothing else." \
  > reviews/market-os-final-review.json
```

`--sandbox read-only` is required — the review must not modify the working tree. If the exact
flag name differs in the installed `codex-cli` version, use whatever equivalent read-only/
no-write sandbox mode that version documents (`npx @openai/codex --help`); never grant write or
network-execute access for this review run.

If the CLI does not support piping structured JSON output directly, run it interactively instead
and manually save the model's final JSON response into `reviews/market-os-final-review.json` in
the schema below — the schema is what matters, not the exact invocation mechanics.

## 13. Result file: `reviews/market-os-final-review.json`

```json
{
  "reviewer": "codex-cli",
  "reviewer_version": "<output of `npx @openai/codex --version`>",
  "reviewed_at": "<ISO 8601 timestamp, real, not fabricated>",
  "base_sha": "9b34f8bb6be120dacd381fe22577870f40d6e5fa",
  "head_sha": "8f4f76ca74e01f1b9541a7f7295521f3eda08803",
  "verdict": "APPROVE | REVISE",
  "summary": "<one paragraph — reviewer's overall assessment>",
  "blockers": [
    {
      "id": "B1",
      "severity": "P0 | P1",
      "file": "src/server/domain/askMarket.ts",
      "line": 0,
      "description": "<concrete defect, not a style preference>",
      "exploit_or_failure_scenario": "<specific input/state -> wrong output or real risk>",
      "recommended_fix": "<what should change, not required to be exact code>"
    }
  ],
  "non_blocking_notes": ["<P2/P3 observations that don't need to block APPROVE — optional>"]
}
```

`blockers` MUST be empty for a `verdict: "APPROVE"` result. `verdict: "REVISE"` requires at
least one entry in `blockers` — that's what makes it a REVISE and not just notes. Every blocker
must have a concrete `file`/`line` and a real failure scenario, not a hypothetical "could be
improved" — this repo's own review culture (see `docs/DECISIONS.md`, `docs/TEST_STRATEGY.md`)
treats vague findings as noise, not signal.

## 14. If verdict is `REVISE`: how blockers get fixed

For each entry in `blockers`, in severity order (all P0s before any P1):

1. Reproduce the finding — read the cited `file`/`line`, confirm the `exploit_or_failure_scenario`
   is real against the actual code (not a misreading of it).
2. Classify: if it's a real defect, fix it with the minimal correct change (no unrelated
   refactoring, per this project's own AGENTS.md/CLAUDE.md discipline). If, on reproduction, the
   finding is NOT actually valid (a false positive), record why in `docs/DECISIONS.md` with the
   same reasoning-out-loud standard used for the `security-review` skill's false positive this
   session — do not silently drop it.
3. Add or update a regression test that would have caught the real defect, where testable.
4. Re-run the full relevant verification for whatever was touched: `npm run verify` at minimum;
   `npm run e2e` if auth/admin/ask flows were touched; the specific adapter's test file if a
   `normalize.ts` was touched.
5. Commit each fix with a message citing the blocker id (e.g. `Fix B1: ...`), push to
   `claude/market-os-development-7vnicg`.
6. Once all blockers are addressed (fixed or documented as false positives), update
   `reviews/market-os-final-review.json`'s blockers with an `outcome` field per entry (`"fixed"`
   | `"false_positive"` | `"deferred_to_review_debt"`) and re-run §12 against the new HEAD SHA —
   update this packet's §2 HEAD SHA first.
7. This is the same fix loop CLAUDE.md's Development Loop already describes
   (TEST → FIX → RETEST → CODEX REVIEW) — nothing new here, just Codex substituting for the
   "self-review" step this session used in its absence.

## 15. If verdict is `APPROVE`: how status updates

1. Update `docs/REVIEW_DEBT.md`'s M01-M22 row: status changes from `PENDING` to `DONE`, citing
   `reviews/market-os-final-review.json`'s `reviewed_at`/`head_sha` as evidence.
2. Update `docs/RELEASE_READINESS.md`'s "Codex critical review" row: `CODEX_REVIEW_PENDING` →
   `VERIFIED`.
3. Update `docs/PROJECT_STATE.md`'s `CURRENT`/`STATUS` fields to record
   **`RELEASE_CANDIDATE_CODEX_APPROVED`** as the project's terminal technical status — this is a
   distinct, stronger status than the prior `RELEASE_CANDIDATE_READY` (which had Codex review as
   `CODEX_REVIEW_PENDING`). Cite the review file path and head SHA.
4. Add a `docs/DECISIONS.md` entry recording the approval, the reviewer version, and a one-line
   summary of what was checked — same pattern as every other entry in that log.
5. Commit these doc updates (`git commit -m "Record Codex APPROVE: reviews/market-os-final-review.json"`),
   push.
6. The three Product/Human Gates (full LLM-based Ask Market, production deployment, payment
   activation) are unaffected by this — Codex approval closes the _technical_ review gate only.
   `RELEASE_CANDIDATE_CODEX_APPROVED` still means "ready modulo Product/Human decisions," not
   "shippable to production without human sign-off."
