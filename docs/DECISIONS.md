# Decisions Log

Append-only. Each entry: date, decision, reason, alternatives considered.

## 2026-08-15 — Modular monolith over microservices for V1

**Decision**: Single Next.js + TypeScript app (frontend + backend API routes), one Postgres DB.
**Reason**: Team is one AI developer + one human; microservices add operational overhead with
no scaling benefit yet. Matches master-prompt architecture principles (§13).
**Alternatives**: Separate API service from day one — rejected as premature.

## 2026-08-15 — Prisma as ORM

**Decision**: Use Prisma over raw SQL or a query builder for schema + migrations.
**Reason**: Strong TypeScript type generation reduces financial-data type errors; migration
tooling is mature; fits "stability, testability, simplicity" priority order.
**Alternatives**: Drizzle (lighter, considered acceptable alternative — revisit if Prisma proves
too heavy for AI-context-efficiency in later milestones).

## 2026-08-15 — npm as package manager

**Decision**: Use npm, not pnpm/yarn.
**Reason**: Environment has npm pre-verified available; avoids introducing an unverified
toolchain dependency.

## 2026-08-15 — Roadmap order follows master-prompt default (M00-M28)

**Decision**: Keep the default milestone order from the master prompt unless a concrete
dependency issue forces reordering.
**Reason**: No conflicting technical constraint identified yet during M00.

## 2026-08-15 — Prisma 7 driver-adapter pattern (no `url` in schema.prisma)

**Decision**: Connection string lives only in `prisma.config.ts` (CLI/migrations) and is passed
explicitly via `@prisma/adapter-pg` in `src/server/db/client.ts` (runtime). `datasource.url` is
not set in `prisma/schema.prisma`.
**Reason**: Prisma 7 removed support for `datasource.url` in the schema file; this is the
supported replacement, not a workaround. See https://pris.ly/d/config-datasource.
**Alternatives**: None — this is required by the installed Prisma version.

## 2026-08-15 — M01 DB schema initial scope

**Decision**: M01 ships a schema skeleton (Source, Series, Observation, DataConflict, Claim)
sufficient to validate the hallucination-resistant pipeline end-to-end with a real Postgres
instance, deferring the full source registry / seed data and additional domain tables (events,
causal graph edges, filings, etc.) to their respective milestones (M02, M07, M13, M15-M17).
**Reason**: Keeps M01 scoped to "core architecture + database" as roadmapped; avoids building
schema for features not yet designed in detail.

## 2026-08-15 — Shared revision-aware observation upsert extracted after the 2nd adapter

**Decision**: `src/server/domain/observationIngest.ts` centralizes the
insert/revise/unchanged logic every adapter's `ingest.ts` needs, instead of each adapter
reimplementing it.
**Reason**: FRED (M03) and ECOS (M04) needed byte-for-byte identical revision-tracking logic;
duplicating it a second time made a third copy (DART/EDGAR, M05-M06) look inevitable, so this
crossed from "three similar lines" into a real shared invariant worth protecting in one place.
**Alternatives**: Leave duplicated per-adapter — rejected, this is exactly the kind of
correctness-critical logic (docs/DATA_POLICY.md financial-data checklist) that should not drift
between copies.

## 2026-08-15 — ECOS missing-value handling is conservative, not verified against a live API

**Decision**: `src/server/adapters/ecos/normalize.ts` treats any non-finite `DATA_VALUE` as
missing (skipped, never coerced to 0), rather than matching a specific documented marker.
**Reason**: Network access to ecos.bok.or.kr is blocked in this dev environment, so the exact
missing-value convention could not be confirmed against a live response — only inferred from
third-party documentation/tutorials. A conservative "any non-numeric = missing" rule cannot
silently fabricate a financial value even if the real marker differs from what was assumed.
**Follow-up**: Revisit once a real `ECOS_API_KEY` and a live response are available (Human
Gate — see docs/DATA_POLICY.md); logged in `docs/REVIEW_DEBT.md`.

## 2026-08-15 — Filing model added for M05 (not forced into Series/Observation)

**Decision**: OpenDART disclosures are stored in a new `Filing` model
(sourceId/corpCode/corpName/stockCode/reportName/receiptNo/receiptDate/remark/raw), not shoehorned
into `Series`/`Observation`.
**Reason**: A filing is a discrete document/event keyed by a source-issued receipt number, not
a numeric time-series data point — the revision-vs-overwrite logic that Series/Observation
exists for doesn't apply the same way (DART amendments arrive as new filings with their own
receipt number, not a same-date value change). Forcing it into Observation would require a
fake/null `value` and lose the actual document metadata (report name, filer, remark flags).
**Alternatives**: Store filings as Observations with a sentinel value — rejected as exactly the
kind of "fabricate a value to fit the schema" move the financial-data invariants prohibit.

## 2026-08-15 — OpenDART API shape built from documentation, not a verified live response

**Decision**: `src/server/adapters/dart/types.ts` documents the list.json shape (status/
message envelope, corp_code/rcept_no/rcept_dt/... fields, status "013" = no data) based on
third-party documentation and general knowledge of this long-stable public API, since direct
network access to opendart.fss.or.kr is blocked in this dev environment (confirmed via
WebFetch, same as ecos.bok.or.kr).
**Reason**: Same reasoning as the ECOS decision above — build the adapter now so the schema and
pipeline are validated end-to-end, but be explicit that field-level correctness is unverified
rather than silently presenting it as confirmed.
**Follow-up**: Revisit once a real `DART_API_KEY` and a live response are available (Human
Gate); logged in `docs/REVIEW_DEBT.md`.

## 2026-08-15 — Integration tests must never `deleteMany()` on a shared table without a scope

**Decision**: Every integration test file operates only on rows it owns (its own `Source.code`,
or a `where` scoped to that source's id) — never a bare `deleteMany()` across an entire table.
**Reason**: `tests/integration/schema.test.ts` originally wiped all `Source` rows in its
`beforeAll`, which worked while it was the only integration suite but broke once
fred-ingest/ecos-ingest/dart-ingest/edgar-ingest tests started persisting their own Source rows
in the same live database (FK violation from `filings` once M05 added that table). Fixed by
giving schema.test.ts its own dedicated source code (`TEST_SCHEMA_SOURCE`) and scoping all its
cleanup queries to that source's id.
**Follow-up**: Apply this rule to every new integration test file going forward — it's a
correctness requirement, not a style preference, given `fileParallelism: false` means all
suites share one live database sequentially.

## 2026-08-15 — Event clustering is a deterministic keyword-overlap heuristic, not an LLM call

**Decision**: `src/server/domain/eventClustering.ts` decides whether a new mention belongs to
an existing Event using Jaccard similarity over a stopword-filtered keyword set, within a
configurable time window — no LLM/API call is involved.
**Reason**: CLAUDE.md's zero-extra-AI-cost rule and docs/AI_RESOURCE_POLICY.md's "prefer
deterministic calculations over LLM-generated reasoning" both point the same direction: event
membership is a decision that needs to happen for every ingested mention (potentially high
volume), so it must not depend on a paid or usage-metered model call. A simple, inspectable
heuristic also makes the pipeline's behavior testable and auditable, matching the
hallucination-resistant architecture's spirit even outside the FACT/CALCULATION/INFERENCE
claim path specifically.
**Alternatives**: Embedding-similarity clustering — deferred; would need either a local
embedding model (not currently part of the stack) or a paid API, neither justified yet at this
milestone's scope. Revisit if the keyword heuristic proves too coarse once a real news source
is wired in.
**Follow-up**: M07 in this session ships schema + clustering + tests using fixture-style
mentions; no live news/metadata source is integrated yet (none was in scope/reachable to
verify in this environment) — see docs/CURRENT_TASK.md.

## 2026-08-15 — Claim Ledger wired to a real caller in M08, not left as unused code

**Decision**: Added `src/server/domain/claimStore.ts` (`createClaim`, backed by
`assertValidClaim`; `createFactClaimFromObservation`) as the one real write path for `Claim`
rows, with integration tests proving an unsourced FACT claim is rejected before it ever reaches
the database.
**Reason**: `assertValidClaim` (M01) had no caller anywhere in the codebase outside its own
unit test — a real instance of CLAUDE.md's Completion Standard warning ("validation exists →
verify the production path invokes it"). M09 (Claim Ledger + verification pipeline) will need
this immediately; shipping it now means M09 builds on a fully-wired minimal version instead of
a half-built one.
**Follow-up**: `createFactClaimFromObservation` is deliberately narrow (Observation → FACT
only). CALCULATION and INFERENCE claim construction belongs to the milestones that actually
produce those (M11 Macro Regime Engine for CALCULATION; M21 Ask Market for INFERENCE) — no
speculative support added ahead of a real caller.

## 2026-08-15 — Claim verification checks evidence against the DB, not just its own shape

**Decision**: `src/server/domain/claimVerification.ts`'s `verifyClaim` re-reads the evidenced
Observation from the database and checks both that the claim text contains the actual stored
value and that `claim.sourceId` matches the observation's source — not just that `evidence`
looks well-formed.
**Reason**: A claim with syntactically valid evidence that doesn't actually match the
underlying data is exactly the kind of "hallucination-shaped-like-a-fact" CLAUDE.md's
guardrails exist to catch. Checking shape alone (does `evidence.observationId` exist as a key)
would pass a claim whose text was fabricated or attributed to the wrong source.
**Alternatives**: Trust `evidence` once written by `createClaim` — rejected; the point of a
separate verification pass is to catch cases where evidence and text drift apart (e.g. a future
bug in claim construction, or a claim inserted by a path that bypasses claimStore.ts).
**Follow-up**: Scoped to FACT claims with an `observationId` only, matching the one real
producer that exists (M08). Extend to Filing-evidenced claims and CALCULATION/INFERENCE once
those have real producers — see the M08 entry above for why speculative support isn't added
early.

## 2026-08-15 — What Changed uses plain `Number` arithmetic, not a decimal library

**Decision**: `src/server/domain/whatChanged.ts` converts `Observation.value` (Prisma
`Decimal`, `NUMERIC(20,6)`) to a JS `Number` for the delta/percent/bps calculation, rounding to
6/4/2 decimal places respectively.
**Reason**: The values in scope (macro rates/indices, not high-frequency trade prices) fit
comfortably within `Number`'s safe precision at 6 decimal places; introducing a decimal library
(e.g. decimal.js) is not yet justified by any observed correctness problem. `verifyClaim`
recomputes independently from the same evidenced Observations and compares within a 1e-6
tolerance, so any future precision drift would surface as a VALUE_MISMATCH rather than pass
silently.
**Alternatives**: decimal.js/big.js for exact decimal arithmetic — revisit if/when a feature
needs currency-cents-level precision or very large-magnitude series where `Number` precision
could plausibly matter (flag in a future DECISIONS entry if that happens, don't silently
upgrade without noting why).

## 2026-08-15 — Macro Regime Engine reports per-series readings, never a fabricated composite score

**Decision**: `src/server/domain/macroRegime.ts`'s `computeRegimeSnapshot()` returns, per axis,
the latest deterministic value/change/direction for each mapped series — not a single 0-100 (or
any other) "regime score" per axis.
**Reason**: docs/ARCHITECTURE.md's "LLM does not invent scores" principle extends to
deterministic code too: combining a policy rate, a volatility index, and a commodity price into
one number requires a real weighting methodology, which doesn't exist yet. Inventing one now
just to have a single number would be exactly the kind of unsupported-but-confident-looking
output the project's guardrails exist to prevent — a fabricated composite is no more honest for
being computed by code instead of an LLM.
**Alternatives**: A simple average/percentile composite — rejected for now as arbitrary;
revisit only with a documented methodology (e.g. citing an established macro framework) if a
future milestone genuinely needs one number per axis for presentation.

## 2026-08-15 — Expanded TRACKED_FRED_SERIES from 4 to 11 series for M11 axis coverage

**Decision**: Added UNRATE, INDPRO (Growth), M2SL, WALCL (Liquidity), VIXCLS (Risk), BAA10Y
(Credit), DCOILWTICO (Commodity) to `TRACKED_FRED_SERIES`, all free FRED series with stable,
well-known series IDs.
**Reason**: The Macro Regime Engine's 8 planned axes were previously supported by only
Rates/USD/Inflation via the original 4 series (+ 1 ECOS rate); shipping the engine without
expanding coverage would have meant 5 of 8 axes permanently reporting NOT_TRACKED. No live
ingestion has run against these yet in this dev environment (no FRED_API_KEY configured here —
Human Gate), so real values are still pending; `computeRegimeSnapshot()` correctly reports
NOT_TRACKED/INSUFFICIENT_DATA rather than fabricating readings until ingestion actually runs.

## 2026-08-15 — M12 Economic Calendar scoped down to cadence projection (no consensus data)

**Decision**: `src/server/domain/economicCalendar.ts` projects each series' next expected
observation date from the median historical interval between its own past observation dates.
It does NOT implement consensus/surprise/actual-vs-expected from docs/PRODUCT_SPEC.md's full
Economic Calendar spec.
**Reason**: `api.stlouisfed.org` (FRED, including its Releases API which gives real release
dates) is egress-blocked in this dev environment, confirmed via WebFetch — same pattern as
ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov. FRED's Releases API doesn't provide
forward-looking consensus estimates even when reachable; a genuine consensus source is
typically paid. Rather than either blocking the milestone entirely or guessing at specific
FRED `release_id`-to-series mappings without being able to verify them (which would risk
displaying wrong release dates as if confirmed — exactly what the Claim Ledger's provenance
requirements exist to prevent), this milestone ships an honestly smaller feature: a
deterministic cadence projection from data the app has already verifiably ingested itself, with
the gap explicitly logged rather than silently presented as the full spec.
**Alternatives**: Block M12 entirely pending a reachable consensus source — rejected, since a
real (if partial) feature is buildable now and "next expected release" is still genuinely
useful. Guess at FRED release_id mappings from training knowledge — rejected as unverifiable
and too easy to get subtly wrong for financial-calendar data.
**Follow-up**: Revisit once `api.stlouisfed.org` is reachable (to use the real Releases API for
actual release dates) and/or a legitimate free consensus-estimate source is identified; logged
in `docs/REVIEW_DEBT.md`.

## 2026-08-15 — CausalEdge.counterexamples is required, not optional

**Decision**: `prisma/schema.prisma`'s `CausalEdge` model makes `counterexamples` a required
`String`, not `String?`, and `confidence` a `LOW|MEDIUM|HIGH` enum rather than a numeric score.
**Reason**: docs/LEGAL_GUARDRAILS.md and docs/ARCHITECTURE.md both require correlation to never
be presented as confirmed causation. Making the limitation field optional would rely on every
future edge-author remembering to fill it in; making it required means the database itself
rejects an edge that doesn't acknowledge at least one limitation. A numeric confidence (e.g.
"73% confidence") would imply a precision that doesn't exist for qualitative macro reasoning —
an enum keeps the honesty proportional to what's actually known.
**Alternatives**: Optional counterexamples with a code-review convention to always fill it in —
rejected; conventions get forgotten, schema constraints don't.

## 2026-08-15 — M13 seeded with 7 textbook mechanisms, no path-finding/traversal logic yet

**Decision**: `prisma/causalEdges.ts` ships 7 well-established, single-hop transmission
mechanisms (oil→inflation→rate expectations→bond yields; US-KR rate differential→USD/KRW→Korea
import inflation; yield curve inversion→recession probability; VIX→credit spreads). No
multi-hop path-finding between arbitrary variables is implemented.
**Reason**: docs/CURRENT_TASK.md scoped M13 as schema + curated seed data, not a traversal
algorithm — no real consumer needs multi-hop paths yet (that's M21 Ask Market). Building
traversal now would be speculative work ahead of a real caller, the same pattern avoided in
M08/M09's Claim Ledger build-out.
**Follow-up**: Add `getPath(from, to)` (or similar) when M21 actually needs to present a causal
chain to a user, not before.

## 2026-08-15 — Historical Analog Engine: single-series trailing-change similarity, period-based not calendar-month-based

**Decision**: `src/server/domain/historicalAnalog.ts` computes similarity by comparing a
series' current "trailing change over N observations" against the same metric at every
historical point (z-score-normalized distance, deterministic), then reports actual subsequent
changes N/3N/6N observations later at each matched historical point. Results are labeled
"observations ahead," not literal "1M/3M/6M," unless the series' own frequency is monthly.
**Reason**: docs/PRODUCT_SPEC.md's "1M/3M/6M" framing assumes monthly-cadence analysis; several
currently-tracked series are daily (DGS10, VIXCLS, DCOILWTICO, ...). Labeling a daily series'
"next 3 observations" as "3 months" would be a factually wrong claim about time, exactly the
kind of subtle inaccuracy the financial-data invariants exist to catch — better to be correct
and slightly less on-brand-with-the-spec than to mislabel units.
**Reason (data availability)**: This dev environment's database has very little real historical
data (no FRED_API_KEY configured — Human Gate — so no real multi-year backfill has run). This
milestone ships the algorithm with full test coverage against seeded synthetic historical data,
proving the math is correct; real usage with meaningful sample sizes awaits real ingestion.
Every result carries a required `sampleSize` and `limitations` string (mirroring
CausalEdge.counterexamples) — a small sample size is surfaced, never hidden.
**Alternatives**: A multi-variable regime-state similarity (matching M11's 8 axes) — deferred
as materially more complex for a first version; single-series analog is a real, useful,
independently-shippable increment that a multi-variable version can build on later.

## 2026-08-15 — M15 Company X-Ray built against SEC EDGAR's XBRL companyfacts API shape

**Decision**: Confirmed via WebFetch that `data.sec.gov/api/xbrl/companyfacts/...` is
egress-blocked in this dev environment (same as its submissions endpoint used in M06). Rather
than treat this as a hard block on M15, applied the same discipline already used for
M04-M06/M12: build the adapter against the well-documented, stable, extensively-known XBRL
companyfacts response shape (parallel-array-free, per-concept `units.USD[]` arrays with
`val`/`end`/`fy`/`fp`/`form`/`accn`), with fixture-based tests, and log the live-shape
verification gap in `docs/REVIEW_DEBT.md` rather than blocking or attempting to parse raw
filing HTML/PDF (which risks fabricating structured numbers from unstructured text — explicitly
rejected as an alternative).
**Reason**: XBRL structured facts are a fundamentally more tractable and lower-risk data source
than parsing filing documents by hand — the whole point of the SEC's XBRL mandate is that these
values are already machine-readable and tagged, not free text requiring interpretation.
**Scope**: A `FinancialFact` model + EDGAR adapter for a small set of core concepts (Revenues,
NetIncomeLoss, OperatingIncomeLoss, Assets, Liabilities,
CashAndCashEquivalentsAtCarryingValue) — not the full "Company X-Ray" feature set (risk
factors, management-language changes require filing _text_, not XBRL facts, and are explicitly
out of scope for this pass). DART/Korean structured-financials equivalent is a separate future
sub-scope, not attempted here.
**Follow-up**: Revisit field-shape verification once `data.sec.gov` is reachable with a real
environment; extend concept coverage and add a DART financial-statement adapter as separate
follow-on work.

## 2026-08-15 — M16 Filing Diff split into a shipped numeric half and an explicitly blocked text half

**Decision**: `src/server/domain/filingDiff.ts` ships `computeFinancialFactDiff`/
`computeFilingDiff` — deterministic deltas between the two most recent `FinancialFact` rows for
a concept, reusing the same change-calculation approach as `seriesReadings.ts`. New/removed
risk factors and management-language-change detection (the "text diff" half of
docs/PRODUCT_SPEC.md's Filing Diff) are NOT implemented.
**Reason**: The numeric half is real, tested, and buildable today on data M15 already ingests
(including verified restatement history). The text half needs actual filing document text
(HTML/PDF), which no adapter in this project has ever fetched — DART (M05), EDGAR filings
(M06), and EDGAR XBRL (M15) all stored metadata or structured facts, never document bodies.
Building a text-diff feature without real filing text would mean either fabricating a diff or
building an entirely new, materially larger capability (document fetching + parsing + diffing)
disguised as a small extension of what exists.
**Follow-up**: A filing-text-fetching adapter (fetching + storing raw filing HTML/text,
distinct from Filing's current metadata-only scope) is required before the text-diff half can
be attempted; logged in `docs/REVIEW_DEBT.md` as blocked on that prerequisite, not forgotten.

## 2026-08-15 — M17 ETF X-Ray scoped to schema + guardrail enforcement only, no ingestion

**Decision**: Confirmed via WebFetch that both candidate free ETF-holdings sources
(ssga.com/SPDR, ishares.com) are egress-blocked in this dev environment. Unlike M04-M06/M15
(government/regulatory APIs with strong, stable, well-documented shapes from training
knowledge), ETF holdings-file formats vary by issuer and change over time — there is no single
well-established public shape to build against with the same confidence used for FRED/ECOS/
DART/EDGAR. Building an adapter against a guessed, unverifiable, issuer-specific CSV/XLSX
format would carry materially higher fabrication risk than the prior "build against documented
API shape" pattern.
**Decision (what ships instead)**: An `Etf`/`EtfHolding` schema (index, expense ratio, issuer,
holdings with ticker/weight/sector/country — the facts docs/PRODUCT_SPEC.md calls for) plus a
structural guardrail test proving the schema and any future computed output can never carry a
recommendation-style field (score/rating/suitability), mirroring the enforcement approach used
for `CausalEdge` (M13). No real ingestion, no adapter, no fixture data claiming to be a real
issuer's holdings.
**Reason**: Shipping a fabricated-looking adapter against a guessed format would be worse than
shipping nothing — it would look like real data-ingestion capability while actually being
unverifiable guesswork, which is exactly what the project's anti-hallucination guardrails exist
to prevent. The schema and guardrail are real, useful groundwork regardless of when a real
source becomes available.
**Follow-up**: Build the real adapter once either (a) ssga.com/ishares.com/a similar issuer
source becomes reachable in a real deployment environment, or (b) a well-documented, stable
public ETF data API is identified (unlike issuer holdings pages, which are essentially website
scraping targets, not APIs) — logged as BLOCKED in `docs/REVIEW_DEBT.md`.

## 2026-08-15 — M18 Real Estate Intelligence scoped to schema + deterministic median-based analysis, no ingestion

**Decision**: Confirmed via WebFetch that `www.data.go.kr` (Korea's public data portal, which
would front MOLIT's real-transaction-price API) is egress-blocked, consistent with every other
Korean/US financial-data-adjacent domain tested this session (ecos.bok.or.kr,
opendart.fss.or.kr, data.sec.gov, api.stlouisfed.org, ssga.com, ishares.com — all blocked). This
container blocks essentially all financial-data-provider domains as a systemic constraint, not
an intermittent one; further per-domain probing for this milestone was skipped once the pattern
was already this consistent, to avoid spending effort re-confirming an established fact.
**Decision (what ships instead)**: A `RealEstateTransaction` model (individual transaction
records — region, deal type, property type, area, price, deal date — matching MOLIT's actual
실거래가 data shape from general knowledge of this well-known public dataset) plus a
deterministic domain module computing median price-per-area change between two time windows
(median, not a two-point delta, since individual real-estate transactions have high per-unit
variance — a single outlier sale shouldn't swing a "24h change"-style calculation the way it's
fine to for a liquid market series). No ingestion adapter; tested against seeded fixture data.
**Reason**: Same reasoning as M12/M17 — ship the honestly smaller real feature (schema + tested
algorithm) rather than block the milestone or fabricate transaction data.
**Follow-up**: Build the real MOLIT/data.go.kr adapter once reachable in a real deployment
environment; logged as BLOCKED in `docs/REVIEW_DEBT.md`.

## 2026-08-15 — M19 Watchlist ships with a minimal placeholder `User` model, not deferred to after M22

**Decision**: Added a minimal `User` model (id, createdAt only — no email/password/auth fields)
now, so `WatchlistItem` can have a real foreign key rather than a bare unvalidated string
`userId`. Full authentication (email, password hashing, sessions) is still M22's job, added on
top of this same table later.
**Reason**: `docs/ROADMAP.md` orders Watchlist (M19) before Auth (M22), and Watchlist
fundamentally needs a concept of "whose list is this." Two options: (a) a bare `userId: String`
field with no referential integrity, to be replaced later, or (b) a minimal real `User` table
now that M22 extends. (b) avoids a later migration that has to rewrite every WatchlistItem row's
identifier format, and a bare id-only User table is not "throwaway auth scaffolding" — it's the
same table M22 will add columns to, not a table M22 will delete and replace.
**Alternatives**: Reorder M22 before M19 — rejected; M22's actual scope (real auth flows,
sessions, security review) is much larger than what M19 needs, and blocking Watchlist on all of
that would be a bigger reordering than the roadmap's stated dependency reasoning justifies.
**Follow-up**: When M22 is built, add auth fields to this same `User` model rather than creating
a second one; record any schema changes there in a new DECISIONS.md entry at that time.

## 2026-08-15 — M20 ships a real page, and buildMorningBrief() is read-only (no Claim writes)

**Decision**: M20 builds an actual Next.js page (`src/app/today/page.tsx`) rendering a server-
side `buildMorningBrief()` composition function — not just another untested data module. Also:
`buildMorningBrief()` never calls `computeSeriesChange()` (which persists a new CALCULATION
claim on every call); instead it reads the same underlying data
(`getRecentObservationPair`/`computeChange` from `seriesReadings.ts`) purely for display,
writing nothing.
**Reason (real UI)**: Every milestone through M19 was data/domain-logic only, with zero real UI
beyond the M01 scaffold page. CLAUDE.md's completion standard ("verify the actual user path,
not just code existing") applies here directly — a Morning Brief that only exists as an
untested function nobody renders isn't actually the "Today / Morning Intelligence" feature.
**Reason (read-only)**: A page can be loaded arbitrarily many times (by one user refreshing, by
crawlers, eventually by many users). If it persisted a new Claim row on every render, the Claim
Ledger would fill with duplicate, redundant CALCULATION claims for the same underlying data —
semantically wrong (a claim should represent a computed fact worth recording, not a page-view
side effect) and a real scaling problem. `computeSeriesChange()` remains the right function for
an actual ingestion/scheduled-job context (M25 background jobs); the brief reuses its
lower-level building blocks instead.
**Alternatives**: Cache/memoize computeSeriesChange results — deferred; no caching layer exists
yet (that's also M25), and read-only computation is fast enough at current data volumes not to
need it yet.

## 2026-08-15 — M21 Ask Market is BLOCKED_HUMAN_GATE: product-runtime LLM calls are a different cost category than development

**Decision**: M21 (Ask Market's INFERENCE layer) is not started. Flagged as
`BLOCKED_HUMAN_GATE` rather than built against any LLM API.
**Reason**: Every milestone through M20 needed no runtime LLM call — FACT/CALCULATION claims
are entirely deterministic (adapters + arithmetic). INFERENCE claims (Ask Market's actual
purpose) require calling an LLM live, for every real user question, at product runtime. That is
categorically different from this development session's own LLM usage (Claude Code driven by
the user's Max 20x subscription): a deployed backend answering end-user questions needs its
own API credentials and incurs its own per-token cost against whatever provider serves it — the
Max subscription authenticates _this coding session_, not a running production service. CLAUDE.md
is explicit that any paid API/service activation is a Human Gate, and that "if a task is
blocked on a Human Gate, switch to the next independent task instead of stopping all work" —
this is exactly that situation, not a judgment call to route around unilaterally (e.g. by
quietly wiring in a free-tier key, or by faking INFERENCE claims with template text pretending
to be model output).
**What's actually needed to unblock**: A human decision on (a) which LLM provider/plan to use
for product-runtime inference, (b) how its cost is funded (a separate paid plan, a free tier
with real rate limits, etc.), and (c) the credential itself (a real secret — also independently
a Human Gate per CLAUDE.md's "never commit secrets" / "real credentials are a HUMAN GATE" rules).
**Follow-up**: Once unblocked, verifyClaim (M09) should be extended to support INFERENCE claims
in the same milestone, and dedicated legal-guardrail tests (the "삼성전자 지금 살까?" redirect
requirement) must ship with the first real Ask Market implementation, not after it.
**Meanwhile**: Continuing to M22 (Auth / User System), which has no LLM dependency.

## 2026-08-16 — M22 Auth: from-scratch email+password, opaque server-side sessions

**Decision**: Built `src/server/domain/auth.ts` from scratch (Node's built-in `crypto.scryptSync`
for password hashing, no third-party auth library) rather than adopting next-auth/Auth.js.
Sessions are opaque bearer tokens (`Session.id` doubles as the token) validated by DB lookup —
no JWT, no signing secret, revocation is just deleting the row.
**Reason**: Smallest dependency/attack surface, easiest to reason about in a later security
review (M26), and consistent with this project's pattern of preferring deterministic, self-owned
code over external libraries where the scope is manageable (see the M07 event-clustering
decision for the same philosophy). A third-party auth library often pulls in OAuth-provider
integrations that are themselves potential Human Gates (external service registration) even
when unused.
**Correctness details worth noting**: `signIn` returns the identical error message
("Invalid email or password") whether the email doesn't exist or the password is wrong — no
user-enumeration signal. `scryptSync` (not the promisified async `scrypt`) is used because the
promisified callback form hit a TypeScript overload-resolution error with the options object;
sync is acceptable here given login/signup is a low-volume path, not a hot loop.
**Verification**: Confirmed the full real flow with Playwright driving an actual browser against
`npm run dev` (not just unit/integration tests) — signup creates a session and redirects to
`/today` showing the logged-in email; logout clears the cookie and redirects to `/login`; a
wrong password is rejected with the correct error while staying on the login page. `playwright`
was added as a devDependency (the browser binary was already pre-installed in this environment)
since `curl` cannot drive a Next.js Server Action directly (it requires the client-side action
reference the browser's JS runtime provides) — this is also useful going forward for M27
Production QA's E2E requirements.
**Follow-up**: When M21 (Ask Market) is eventually unblocked, its pages should use
`getCurrentUser()` from `src/server/actions/auth.ts` the same way `/today` does.

## 2026-08-16 — M23 ships a minimal plan field + entitlement helper, no billing integration

**Decision**: Added `User.plan` (`FREE | PRO` enum, default `FREE`) and
`src/server/domain/entitlements.ts` (`hasEntitlement(userPlan, requiredPlan)` — a pure function
— plus `FEATURE_PLAN_REQUIREMENTS`, currently empty since no feature is paid-gated yet, and
`canUseFeature(user, featureKey)` built on top of it). No real payment processor, no
`Subscription`/billing model, no checkout flow — actual payment activation remains a Human Gate
per docs/ROADMAP.md.
**Reason**: This mirrors the M19 precedent (`User` model added minimally ahead of full Auth,
extended later rather than replaced): no feature currently requires a paid tier, so a full
billing system would be speculative work with nothing real to gate. What's real and useful now
is the extension point — a `plan` column that exists on every user row, and a tested,
correct comparison function — so that whenever a first paid feature is designed, gating it is
"add one entry to `FEATURE_PLAN_REQUIREMENTS`," not a schema migration plus new logic built
under time pressure.
**Alternatives**: Skip this milestone entirely until a real paid feature exists — considered,
but rejected since the marginal cost of the `plan` field + pure comparison function is small
and it avoids a later migration that has to backfill a plan value onto every existing user row.
**Follow-up**: Wire `canUseFeature` into an actual feature once the human decides which one
should be paid-gated first — until then, `FEATURE_PLAN_REQUIREMENTS` stays empty by design,
not by oversight.

## 2026-08-16 — M24 Admin/Monitoring scoped to an internal pipeline-health view, no external service

**Decision**: `src/server/domain/systemHealth.ts`'s `computeSystemHealth()` reads exclusively
from data already in the DB — per-source last-ingest timestamp (max `retrievedAt` across
Observation/Filing/FinancialFact/Etf/EventMention) and the unresolved `DataConflict` count — and
`src/app/admin/page.tsx` renders it, gated by `getCurrentUser()` (redirect to `/login` if
unauthenticated). No error-tracking/uptime/APM service is integrated.
**Reason**: "Monitoring" typically implies an external service (Sentry, Datadog, uptime
pingers), which is a Human Gate the moment it's paid — even "free tier requires a card" counts
per CLAUDE.md. What's honestly buildable without one is exactly this: an internal view of
pipeline health derived from data the app already owns. Gating is "any authenticated user," not
a role system — a role/permission model would be speculative for a single-operator product with
no admin/non-admin user distinction defined anywhere else in the schema.
**Verification**: Confirmed with Playwright against a real `npm run dev` session — unauthenticated
`/admin` redirects to `/login`; a signed-up user sees the "Pipeline Health" heading, their email,
a FRED source row, and either "never" or a formatted last-ingest date. 147/147 tests pass (61
unit, 86 integration), full verify chain (format/lint/typecheck/test/build) green.
**Alternatives**: A scheduled health-check background job feeding this view — deferred to M25
(Performance/Cache/Background Jobs), which is the milestone that actually owns background job
infrastructure; this milestone's view computes on-demand at page-load, which is correct for
current traffic and data volume.
**Follow-up**: Add real alerting (email/SMS/push on ingest failure) only once a concrete delivery
mechanism is chosen — bulk email/SMS is itself a Human Gate per CLAUDE.md.
