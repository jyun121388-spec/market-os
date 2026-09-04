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

## 2026-08-16 — M21 partially unblocked: a deterministic, zero-LLM-cost "Ask Market" safe mode ships; free-text conversational Ask Market stays BLOCKED_HUMAN_GATE

**Decision**: Shipped `src/server/domain/askMarket.ts` and `/ask` (auth-gated, like `/today` and
`/admin`). It is a topic search, not natural-language Q&A: given a query string, it (1)
deterministically detects personalized buy/sell/allocation/guaranteed-return/price-target
phrasing (English + Korean, patterns taken directly from `docs/LEGAL_GUARDRAILS.md`'s hard-
prohibitions list) and shows a fixed redirect message when detected, and (2) looks up and
renders already-verified FACT/CALCULATION data (matching `Series`, `CausalEdge`, and
`FinancialFact`/`Filing` rows) as structured "factors" — no prose is synthesized, nothing is an
INFERENCE claim. The redirect and the factors are not mutually exclusive: a detected advice
request still shows whatever factors matched, exactly matching `LEGAL_GUARDRAILS.md`'s "Required
behavior" section ("must be answered by redirecting to analysis... never a direct buy/sell
answer").
**Reason this is safe to ship without further human input**: `docs/PRODUCT_SPEC.md`'s full Ask
Market vision ("natural-language Q&A... segmented into FACT/CALCULATION/INFERENCE") requires a
live LLM call per user question at product runtime — a real per-token cost against whatever
provider serves it, which is exactly the Human Gate the original M21 entry (above) identifies and
which still has no human decision on provider/funding/credentials. This safe-mode MVP makes zero
LLM/paid-API calls of any kind, at build time or runtime — it is pure deterministic pattern
matching and direct reads of the Claim Ledger / FinancialFact / CausalEdge tables, the same
architecture pattern used by `morningBrief.ts` (M20) and `staleness.ts` (M28 follow-up). It does
not "route around" the Human Gate; it is simply outside its scope, because it never needs an LLM.
**What remains genuinely blocked**: Free-text natural-language questions ("what's going to happen
to tech stocks this year", "explain this filing in plain English") cannot be answered without an
LLM interpreting arbitrary text — no deterministic pattern set can do that. `docs/REVIEW_DEBT.md`
keeps M21 listed as `BLOCKED_HUMAN_GATE` for that reason, now scoped precisely: the safe-mode
topic-search MVP is DONE; free-text conversational Q&A is what's still pending a provider/
funding/credential decision.
**Topic matching**: `mentionsEachOther()` reuses `eventClustering.ts`'s `extractKeywords`
tokenizer (same stopword/Unicode handling, avoiding a second implementation) with a containment-
ratio match (overlap ÷ smaller-token-set-size ≥ 0.6) layered on top of a plain substring check —
handles a query embedded in a sentence ("Should I buy Demo Semiconductor now?") matching a
shorter or differently-suffixed stored name ("Demo Semiconductor Inc") in either direction. A
symmetric Jaccard similarity (as used for event clustering) was deliberately NOT reused here: the
two strings being compared are usually very different lengths (a short entity name vs. a full
sentence), and a symmetric measure would unfairly penalize that difference — a containment ratio
is the right shape for this specific asymmetry.
**Verification**: `tests/askMarket.test.ts` (11 pattern-detection cases, including the exact
LEGAL_GUARDRAILS.md example and known false-positive traps like "bond buying program"),
`tests/integration/ask-market.test.ts` (factor lookup, redirect-with-factors, NOT_FOUND-never-
fabricates), and a live Playwright check against `npm run dev`: unauthenticated `/ask` redirects
to `/login`; a factual query shows company facts with no redirect banner; a buy-request query
shows the redirect banner AND the same factors; an unmatched query shows an explicit "no data"
message rather than fabricating anything. 184/184 tests pass, full verify chain green.
**Alternatives considered**: A rules-engine "template response generator" that composes short
sentences from the factor data (closer to feeling like an answer) — rejected as scope creep for
this pass; the current structured-list rendering is honest about being data, not a written
answer, and adding sentence templates doesn't change the underlying LLM-free architecture, so it
can be added later without revisiting this decision.

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

## 2026-08-16 — M25 Performance/Cache/Background Jobs: in-process TTL cache + subprocess job runner, no deployed scheduler

**Decision**: `src/server/domain/cache.ts` ships a generic `TtlCache<T>`/`withCache()` helper
(process-local `Map`, not Redis/a shared cache), applied to `computeSystemHealth()` with a
30-second TTL. `scripts/run-ingest-jobs.ts` (`npm run jobs:ingest-all`) sequences the existing
`ingest:fred`/`ingest:ecos`/`ingest:dart`/`ingest:edgar`/`ingest:edgar-xbrl` npm scripts as
separate subprocesses, logging per-job start/success/failure/duration and a summary, continuing
past a failed job rather than aborting the run, and exiting non-zero if any job failed. No
cron/queue service (Vercel Cron, a hosted queue, etc.) is wired up.
**Reason**: An unattended production scheduler only makes sense once something is actually
deployed to run unattended — deploying is itself a Human Gate per CLAUDE.md until a human
approves it, so building against a specific scheduler now would be speculative infrastructure
for a deployment topology that doesn't exist yet. What's genuinely useful and buildable today:
(a) a cache primitive that removes real redundant work on the one read path (`/admin`) that
recomputes five aggregate queries per page load, and (b) a runnable script that already replaces
"manually type five `npm run ingest:X` commands in order" with one command a human (or a future
scheduler) can invoke — real progress toward "background jobs" without inventing a fake
scheduler abstraction with nothing to schedule against.
**Why a process-local cache, not Redis**: This app runs as a single Next.js dev/prod process
today; a shared cache implies a specific multi-instance deployment shape not yet decided. A
process-local `Map` is correct for the current topology and trivially replaceable later — the
`TtlCache`/`withCache` interface doesn't leak its in-memory implementation to callers.
**Why subprocesses, not in-process sequential calls**: Each `ingest:*` script creates and
disconnects its own Prisma client and can throw on a missing API key (`FRED_API_KEY`/
`ECOS_API_KEY`/`DART_API_KEY`/`EDGAR_USER_AGENT` — all Human Gates per docs/DATA_POLICY.md, not
configured in this dev environment). Running them in-process would mean one job's uncaught
throw or disconnected Prisma client could break the next job in the same process; subprocess
isolation means a failed job is just a logged failure, and the run continues.
**Verification**: `npm run jobs:ingest-all` was actually invoked in this environment — all five
jobs correctly fail with their existing, specific "API key/User-Agent not set — Human Gate"
errors (expected, since no real keys are configured here), the runner logs each failure without
crashing, prints a summary table, and exits 1 (confirmed via a separate `echo $?` check, not
just log inspection). `tests/cache.test.ts` (11 tests, fake-timer-based hit/miss/expiry/clear
coverage) and the updated `tests/integration/system-health.test.ts` (added a
`clearSystemHealthCache()` test-only escape hatch, called after seeding, so integration tests
assert on fresh DB state rather than a stale cache entry) both pass. 155/155 tests total, full
verify chain green.
**Alternatives**: A real cron/queue integration (Vercel Cron, BullMQ + Redis, etc.) — deferred,
logged in docs/REVIEW_DEBT.md as blocked on the production-deployment Human Gate, not skipped
silently.
**Follow-up**: Once production deployment is approved, wire `scripts/run-ingest-jobs.ts` (or an
equivalent) behind whatever scheduler the deployment platform provides, rather than rewriting
the job sequencing logic — it's already deployment-agnostic.

## 2026-08-16 — M26 Security Hardening: session tokens now explicitly random, plus a minimal login-lockout

**Decision**: Two concrete fixes to `src/server/domain/auth.ts`, found via a self-review pass
(no Codex session available in this environment — see docs/REVIEW_DEBT.md's M01-M22 row, still
PENDING): (1) `createSession` now generates the session's `id` explicitly via
`randomBytes(32).toString("hex")` instead of relying on the schema's `@default(cuid())`; (2)
`signIn` now tracks failed attempts per normalized email in a process-local `Map` and locks out
further attempts (including a subsequently-correct password) for 15 minutes after 5 failures
within that window, resetting on any success. A `resetLoginAttemptTracking()` test-only export
was added for test isolation.
**Reason (session token)**: The `Session.id` column doubles as the bearer token itself (see the
M22 decision above) — its security property needs to be "hard to guess," not merely "unique."
Prisma's `cuid()` default is designed for the latter (collision resistance across a distributed
system), not the former (resistance to a targeted enumeration/guessing attack against a secret).
Relying on it for a security-sensitive token conflated two different properties that happened to
both be satisfied by convenience rather than by design. `crypto.randomBytes(32)` gives 256 bits
of cryptographic randomness, which is the standard practice for bearer tokens.
**Reason (login lockout)**: Nothing previously limited how many password guesses an attacker
could make against one account — `verifyPassword`'s `scryptSync` cost factor slows each attempt
but doesn't cap the total number over time. A minimal per-email counter (in-memory, matching
M25's "no external service unless genuinely needed" pattern — a distributed rate limiter needs
its own infrastructure decision, deferred) closes the unlimited-guessing gap for the realistic
threat (one attacker targeting one known account) without adding a new dependency. Both the
locked-out case and the wrong-password case return the identical "Invalid email or password"
message — a distinct "you're locked out" message would itself leak that the email exists.
**Scope explicitly NOT changed**: Cookie flags (`httpOnly`/`secure` in production/`sameSite:
lax`, in `src/server/actions/auth.ts`) were reviewed and found already correct — no change
needed. `scryptSync`'s parameters (N=16384, r=8, p=1) match Node's own documented interactive-
login recommendation — no change needed. CSRF: Next.js Server Actions enforce a same-origin
check on the request by default (comparing the `Origin` header against the deployment's allowed
origins) — this is framework-level protection already in effect, not something this project
implements itself; verified by reviewing Next.js's own Server Actions security documentation
rather than assumed.
**Not addressed this milestone**: Distributed/IP-level rate limiting (credential stuffing across
many accounts, or many IPs against one account) is out of scope for a single-process in-memory
counter — would need shared infrastructure (Redis, a WAF/edge rate limiter) which is exactly the
kind of "no new paid/hosted service" boundary M25 and this milestone both respect. Logged as
follow-up, not silently ignored.
**Verification**: Added `tests/integration/auth.test.ts` cases: session token matches
`/^[0-9a-f]{64}$/`; 5 failed attempts lock out even a subsequently-correct password; a reset
clears the lockout. Verified live with Playwright against `npm run dev`: signup issues a
64-char hex session cookie with `httpOnly: true, sameSite: Lax`; 5 wrong-password attempts then
a 6th attempt with the CORRECT password is still rejected with "Invalid email or password".
157/157 tests pass, full verify chain green.

## 2026-08-16 — M27 Production QA: one persistent E2E walkthrough, honest RELEASE_CHECKLIST audit

**Decision**: `scripts/e2e-full-walkthrough.ts` (`npm run e2e`) is a committed, real-browser
Playwright script exercising the full real user path in one continuous session — unauthenticated
`/admin` redirect, signup, session-cookie shape, authenticated `/admin`, logout, wrong-password
rejection, the M26 five-attempt lockout, and an expired-session redirect — replacing this
session's prior pattern of writing throwaway verification scripts and deleting them after each
milestone. `docs/RELEASE_CHECKLIST.md` was updated with an honest per-item audit against actual
current state rather than left as an aspirational template.
**Reason (persistent E2E)**: Every milestone from M20 onward re-verified real user flows with a
one-off script, written and discarded each time — real coverage that left no trace for the next
session to re-run or extend. M27 (Production QA) is exactly the milestone whose job is to make
that a durable asset instead of repeated throwaway work.
**Reason (honest checklist audit)**: `docs/RELEASE_CHECKLIST.md` had never been touched since
its creation — an unchecked checklist is not evidence of anything. Auditing it item-by-item
against real state surfaced two genuine blockers to RC status: M21 Ask Market doesn't exist
(BLOCKED_HUMAN_GATE, not a scoping choice), and no Codex security review has happened (no Codex
session available this entire session). Two items were also newly identified as simply not
started (timezone/KST-boundary tests, user-facing stale-data marking) rather than silently
left unchecked with no explanation.
**Verification**: `npm run e2e` run for real against `npm run dev` this session — all 12
assertions passed (redirect, signup, cookie shape, admin content, logout, wrong-password,
lockout, expired-session redirect). Test user and its sessions cleaned up after the run
(the script's own `cleanupTestUser()`, called in both a success and failure path via `finally`).
157/157 unit/integration tests still pass, full verify chain green.
**Alternatives**: Migrate to `@playwright/test` as a proper test runner with its own config —
considered, but rejected as unnecessary infrastructure for this pass; the existing `playwright`
library + a plain `tsx` script matches every other real-invocation script in this project
(`scripts/print-*.ts`, `scripts/ingest-*.ts`) and needed no new devDependency or config file.
Revisit if E2E coverage grows enough that assertion/retry ergonomics become a real pain point.

## 2026-08-16 — M28 Release Candidate: honest BLOCKED status, not a forced completion

**Decision**: M28 does not declare a Release Candidate. `docs/RELEASE_CHECKLIST.md` is updated
to its final M28 state: every criterion achievable without a human decision or external tooling
is closed, and the two genuine blockers (M21 Ask Market — BLOCKED_HUMAN_GATE; Codex security
review — no Codex session available at any point across this entire session) are stated plainly
as the reason RC status isn't reached, not worked around.
**What M28 actually did**: Ran a real cross-feature Claim Ledger audit — `verifyClaim` against
every one of the 11 real `Claim` rows in the dev database (a mix of legitimate and
deliberately-broken fixtures from `claimVerification.test.ts`), confirming every legitimate
claim VERIFIED and every broken one was correctly rejected with the right failure code; also
confirmed all 34 `Observation` rows have non-null `sourceId`/`retrievedAt` (provenance holds with
real data). Clarified, with a citation to `docs/ARCHITECTURE.md`'s actual wording ("every
material **AI-authored** claim... is backed by a stored row"), that Today Brief/Macro Regime
correctly not persisting a Claim per view (M20's decision) is architecturally correct, not a
gap — the Claim Ledger is for AI-authored assertions, and raw Observation display already
carries its own source-attributed provenance. Logged two smaller open items (timezone/KST-
boundary tests, user-facing stale-data marking) as `REVIEW_DEBT` rather than building them under
time pressure at the tail of a long session without a concrete motivating failure case.
**Reason for not forcing completion**: CLAUDE.md's Definition of Done requires "Codex review
done or logged as Review Debt" — it does not require inventing a substitute for a review that
genuinely hasn't happened. Marking M28/the roadmap "complete" while M21 and the security review
remain open would misrepresent the project's actual state to whoever reads `PROJECT_STATE.md`
next — exactly the kind of "confident-looking but unsupported" output this project's own
anti-hallucination principles exist to prevent, applied to project status itself, not just
financial data.
**What unblocks the remaining roadmap**: (1) A human decision on M21's LLM provider/funding/
credentials — see the M21 DECISIONS.md entry for exactly what's needed. (2) A Codex session
becoming available in this environment, to run the security-critical review flagged since M22.
Both are named, tracked (`docs/REVIEW_DEBT.md`), and ready to act on the moment either becomes
available — this is a stopping point for genuine Human Gates, not an abandoned task.

## 2026-08-16 — Post-M28: closed the two non-blocking REVIEW_DEBT items (timezone/KST, stale-data marking)

**Decision**: With M21 and the Codex review still genuinely blocked, picked up the two smaller
items M28 had logged as open (per CLAUDE.md's "switch to the next independent task" rule) rather
than idling. Both are now closed.
**Timezone/KST**: Audited every date-only parser (`ecos/normalize.ts`, `dart/normalize.ts`) —
both were already correctly timezone-independent (`Date.UTC(...)`, with an existing comment
explaining why), so no parsing bug existed. Added dedicated boundary tests (Korean New Year's
Eve/Day, a leap day, year/quarter boundaries) so a future refactor that swapped in a
local-timezone `Date` constructor would fail loudly. Separately, auditing the actual rendered
output (not just parsing) surfaced a real bug: `/today` and `/admin` called `.toLocaleString()`
on a `Date` inside a Next.js **Server Component** — this resolves using the server process's own
local timezone/locale, not the viewing user's browser, meaning the same data would render a
different clock time depending on where the app happens to be deployed. Fixed with an explicit
`formatTimestampUtc()` helper (`src/lib/formatDate.ts`) that always renders UTC with an explicit
"UTC" suffix — deterministic regardless of deployment region. Whether end users should eventually
see KST instead of UTC (this product's primary market) is a real product decision, not made here
— logged as a note in the helper's own docstring, not silently decided.
**Stale-data marking**: Added `src/server/domain/staleness.ts` — `evaluateStaleness()` compares a
series' days-since-last-observation against 3x its own historical median update interval
(reusing `economicCalendar.ts`'s existing cadence projection, M12, rather than a second
calculation). A series with fewer than 2 historical observations can't project a cadence and is
marked `UNKNOWN`, never `FRESH` — the module never claims freshness it can't support. Wired into
`buildMorningBrief`'s `whatChanged` entries and a visible "STALE" badge on `/today`.
**Why 3x median interval, not a fixed day count**: A fixed threshold (e.g. "7 days") would
misclassify a quarterly series as permanently stale and a sub-daily series as never stale. Scaling
to each series' own cadence means a daily series is flagged after ~3 days without an update and a
quarterly series after ~9 months — proportional to what "on schedule" actually means for that
series, without needing a fixed table.
**Verification**: New unit tests (`tests/formatDate.test.ts`, `tests/staleness.test.ts`,
boundary-date additions to the ECOS/DART normalize tests) plus a real integration test seeding a
genuinely-stale and a genuinely-fresh series through `buildMorningBrief`. Also verified by hand
against a live `npm run dev` server: seeded a real stale series into the dev database, confirmed
the "STALE" badge rendered on `/today` via a real HTTP request, then cleaned up the seeded rows.
173/173 tests pass, full verify chain green.

## 2026-08-16 — Ran the `security-review` skill against the full branch diff (not a Codex review)

**Decision**: With M21 and the Codex critical review still blocked, and no more scoped
non-blocking product work identified, ran the `security-review` skill — an independent
find-then-verify sub-agent pipeline — against the full diff of this branch vs. `main` (the
entire codebase, since this branch started from an empty repo). Result: zero high-confidence
findings. One candidate (`/admin` has no admin-role check, only a valid-session check) was
raised by the finder pass and eliminated by the independent verifier pass at confidence 2/10 —
the page exposes only operational metadata (source names, ingest timestamps, conflict counts),
no PII/secrets, and the access model is `docs/DECISIONS.md`'s own documented M24 decision, not
an oversight.
**Areas the finder pass specifically checked and found sound**: `auth.ts`/`actions/auth.ts`
(scrypt + salt, `timingSafeEqual`, `crypto.randomBytes(32)` tokens, generic error messages,
httpOnly/secure/sameSite cookies, DB-backed revocation, lockout); every adapter client
(hardcoded HTTPS hosts, no SSRF surface); `scripts/run-ingest-jobs.ts` (fixed-argument-array
`spawnSync`, no shell injection); all Prisma usage (parameterized throughout, no raw SQL
concatenation); no secrets/PII logging anywhere in `src`/`scripts`.
**Why this does NOT close the Codex-review REVIEW_DEBT row**: This skill runs Claude sub-agents,
not Codex — a different model/tool, and CLAUDE.md's Definition of Done specifically names Codex
review as the required check for this project (see docs/AGENTS.md, docs/TEST_STRATEGY.md). Using
a different tool and declaring the requirement satisfied would be exactly the kind of "technically
did something, call it done" move this project's own honesty principles exist to prevent. Logged
as real, valuable, additional coverage — not a substitute — in the M01-M22 REVIEW_DEBT.md row.
**Why this doesn't change the M28 BLOCKED status**: `docs/RELEASE_CHECKLIST.md`'s "Security
review complete" and "Codex critical review complete" items still require an actual Codex
session — this pass adds confidence but doesn't change either checkbox.

## 2026-08-16 — Fixed all 3 P0 blockers from the first real Codex REVISE verdict, plus 3 P1s

**Decision**: A human ran the local-machine Codex review path defined in
`docs/CODEX_REVIEW_PACKET.md` §12 and relayed the verdict: **REVISE**, with 3 P0/HIGH blockers
(H1/H2/H3 below) and 3 recommended P1/MEDIUM items. Per explicit instruction, Claude (not Codex —
Codex quota is limited) implemented every fix directly, with real-PostgreSQL regression tests for
each, rather than trusting the "184 tests pass" count as a success criterion — success is defined
by whether Codex's exact failure scenarios reproduce and are now blocked.

**H1 — Auth migration upgrade safety (was: migration only tested against an empty DB)**
BEFORE: `prisma/migrations/20260816001500_auth/migration.sql` did
`ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL, ADD COLUMN "passwordHash" TEXT NOT NULL`
with no `DEFAULT`. Postgres rejects that against any table with existing rows — this could only
ever succeed against an empty `users` table, an unsafe assumption given M19 (Watchlist) shipped
before M22 (Auth) and could have real pre-existing `User` rows via `WatchlistItem` FK references.
AFTER: rewrote the migration as 3 staged steps — (1) add `email`/`passwordHash` nullable plus a
new `isLegacyAccount BOOLEAN NOT NULL DEFAULT false` column; (2) backfill any pre-existing row
(`email IS NULL`) with a synthetic, unguessable, per-row-unique identity
(`legacy+<id>@market-os.invalid`) and a sentinel `passwordHash`
(`LEGACY_ACCOUNT_NO_CREDENTIALS`) that is never a valid scrypt record and is never presented as a
real credential; (3) tighten both columns to `NOT NULL`. `src/server/domain/auth.ts`'s `signIn()`
now checks `isLegacyAccount` and rejects immediately, before ever calling `verifyPassword` against
the sentinel hash — explicitly tested with the sentinel string itself passed as the "password" to
prove it's never evaluated as real. No existing row is ever deleted.
Applying the corrected migration to the local dev DB hit Prisma's own AI-agent safety guard on
`migrate reset --force` (requires fresh, explicit human consent — no prior conversational consent
counts, per Prisma's own message). Rather than ask for that destructive op, inspected the live
dev DB directly (`psql \d users`) and found its actual column state already matched what the
corrected migration produces except for the new `isLegacyAccount` column (the original buggy
migration happened to succeed in this specific dev DB because `users` had zero rows at the time
it first ran) — so a plain, non-destructive `ALTER TABLE ADD COLUMN` plus a manual
`_prisma_migrations` checksum reconciliation (recomputed sha256 of the edited `migration.sql`)
was sufficient. Zero data loss, no reset needed, no human-consent prompt required.
Regression test: `tests/integration/auth-migration-upgrade.test.ts` — creates a throwaway
Postgres database, applies only the pre-auth migrations via a temp `prisma.config.ts` pointing at
a filtered migrations dir, inserts a `User`+`WatchlistItem` fixture using the raw pre-auth schema
(id/createdAt only), then applies the full migration set (auth onward) and asserts: the row
survives, is flagged `isLegacyAccount = true`, gets the exact documented synthetic email/sentinel
hash (never a fabricated "real-looking" credential), the FK-dependent `WatchlistItem` still
resolves to the same user id, the post-upgrade `UNIQUE(email)` constraint is actually enforced,
and a brand-new post-upgrade signup gets `isLegacyAccount = false`. Also added a `signIn()`
regression in `tests/integration/auth.test.ts` for the legacy-rejection path.
Changed files: `prisma/schema.prisma`, `prisma/migrations/20260816001500_auth/migration.sql`,
`src/server/domain/auth.ts`, `tests/integration/auth-migration-upgrade.test.ts` (new),
`tests/integration/auth.test.ts`.

**H2 — Claim verification structural redesign (was: substring-based FACT verification)**
BEFORE: `claimVerification.ts` decided `VERIFIED` for a FACT claim via
`claimText.includes(String(observation.value))` — a value like `"3.5"` is a substring of an
unrelated `"13.50"`, so an evidenced observation with a completely different value could
false-positive a claim as verified. CALCULATION verification similarly trusted the claim's
stored `absoluteChange`/`percentChange`/`bpsChange` rather than recomputing them.
AFTER: FACT verification regenerates the expected claim text from the re-fetched observation via
a single shared builder (`buildFactClaimText`, extracted into `claimStore.ts` so the
creation path and the verification path can never drift into two different templates) and
requires exact string equality, plus explicit `evidence.seriesId`/`claim.sourceId` identity
checks against the observation's actual series/source. CALCULATION verification checks
current/previous share the same series and source, checks chronological order
(`current.observationDate > previous.observationDate`), independently recomputes
absoluteChange/percentChange/bpsChange from the raw observations via the existing `computeChange`
function, and regenerates the expected claim text via a second shared builder
(`buildChangeClaimText`, extracted from `whatChanged.ts`) — again exact string equality. A claim
whose free-text disagrees with its own structured, re-verified evidence is never `VERIFIED`.
Regression tests (`tests/integration/claim-verification.test.ts`, new "H2 adversarial
regressions" block, 9 cases): the `3.5`/`13.50` substring collision; truthful evidence paired
with a false `claimText`; `evidence.seriesId` pointing at a different series than the actual
observation; a real CALCULATION verify-success path through `computeSeriesChange`; CALCULATION
evidence spanning two different series; reversed current/previous; and tampered
absoluteChange/percentChange/bpsChange, one case each.
Changed files: `src/server/domain/claimVerification.ts`, `src/server/domain/claimStore.ts`,
`src/server/domain/whatChanged.ts`, `tests/integration/claim-verification.test.ts`.

**H3 — Concurrent observation ingestion race (was: read-then-create, no real DB guarantee)**
BEFORE: `upsertRevisionAwareObservation()` did `findFirst` to check for an existing row, then
`create` based on what it saw. The schema's `@@unique([seriesId, observationDate, isRevision,
revisionOf])` does NOT block two concurrent "original" inserts, because every original row has
`isRevision = false, revisionOf = NULL`, and Postgres treats `NULL` as distinct from `NULL` for
uniqueness — any number of "original" rows for the same series/date could coexist.
AFTER: added a genuinely NULL-free partial unique index —
`observations_series_date_original_unique` on `(seriesId, observationDate) WHERE isRevision =
false` (new migration `20260816090000_original_observation_unique`) — enforced by Postgres
itself regardless of application races. The "become the original" step is now a single atomic
`INSERT ... ON CONFLICT (...) WHERE isRevision = false DO NOTHING RETURNING id`; under concurrent
callers exactly one succeeds, the rest fall through to the revision path with zero thrown errors
on the original-vs-original race. The revision-attach path (which can itself race under
concurrent revisers) catches Prisma's `P2002` unique-violation and retries against the freshly
re-read "latest" row, bounded by `MAX_REVISION_RETRIES = 20`.
Regression tests (`tests/integration/observation-ingest-concurrency.test.ts`, new file, real
Postgres, 3 tests): (A) 8 concurrent same-value ingests for one series/date → exactly 1 original,
7 "unchanged", 0 "revised"; (B) 6 concurrent different-value ingests → exactly 1 original plus a
verified acyclic revision chain covering all 6 values, no orphaned `revisionOf` pointers; (C) a
direct duplicate-original `prisma.observation.create()` bypassing the app's own logic entirely →
rejected by the DB constraint itself. Confirmed stable across 6 repeated runs.
Changed files: `prisma/schema.prisma` (clarifying comment), new migration
`20260816090000_original_observation_unique/migration.sql`,
`src/server/domain/observationIngest.ts`,
`tests/integration/observation-ingest-concurrency.test.ts` (new).

**P1s (recommended, not blocking, fixed anyway since none weakened the P0 verification above)**

- **Ask Market guardrail bypass phrasing**: `ADVICE_REQUEST_PATTERNS` in `askMarket.ts` missed
  several real bypasses — a buy/sell verb not immediately adjacent to a timing word ("Buy Tesla
  now, seriously"), "buy or sell" framing, "worth buying", stock-recommendation requests
  ("recommend a stock to buy"), and several Korean phrasings that omit "지금" ("삼성전자 살까요?",
  "이 ETF 사도 될까요?", "추천 종목"). Added patterns for all of these; `tests/askMarket.test.ts`
  gained 3 new regression cases covering the exact bypass phrasings above, all previously-passing
  "does NOT flag" cases still pass unchanged.
- **External API / ingest subprocess timeout**: none of the FRED/ECOS/DART/EDGAR/EDGAR-XBRL
  adapter clients set a `fetch` timeout — a stalled upstream connection would hang the calling
  ingest job indefinitely. Added `src/server/adapters/httpTimeout.ts` (`fetchWithTimeout`, a
  drop-in `fetch` wrapper using `AbortSignal.timeout`, default 30s, throwing a distinguishable
  `HttpTimeoutError`) and wired it into all 5 clients. Separately, `scripts/run-ingest-jobs.ts`'s
  `spawnSync` had no `timeout` at all — one hung job subprocess would block every job after it
  forever, defeating the whole point of running each job in its own subprocess; added a 10-minute
  `timeout`/`SIGTERM`. New test: `tests/httpTimeout.test.ts` (resolves-normally, timeout-throws,
  non-timeout-error-propagates cases, via a stubbed `global.fetch` that only resolves/rejects on
  the injected `AbortSignal` firing).
- **Impossible calendar-date validation**: `Date.UTC(year, month-1, day)` never throws on an
  impossible date — it silently rolls over (Feb 30 → Mar 2, month 13 → next January). For
  financial data this is a real risk: a malformed source date would be silently stored as a
  different, unrequested date instead of being rejected. Added
  `src/server/adapters/dateValidation.ts`'s `assertValidCalendarDate()` (constructs the date, then
  checks the constructed UTC year/month/day still match the input — a rolled-over date fails
  that check) and wired it into both `fred/normalize.ts`'s day parsing and every branch of
  `ecos/normalize.ts`'s `parseEcosTimeAsUtc()` (including an explicit quarter-range check for the
  `Q` cycle, since an out-of-range quarter converts to a month before `Date.UTC` ever sees it).
  New regression tests in both adapters' existing normalize test files (impossible day/month for
  FRED; non-leap Feb 29, Feb 30, month 13, quarter 5 for ECOS) — the existing leap-day-2028 test
  in `ecos-normalize.test.ts` already proved a _valid_ Feb 29 still parses correctly.

**Verification**: Full chain re-run after all fixes: 209/209 automated tests pass (up from 184 —
25 new regression tests: 1 migration-upgrade, 1 legacy-signin, 9 H2 adversarial, 3 H3 concurrency,
3 Ask Market bypass, 3 httpTimeout, 6 impossible-date), `npm run e2e` 12/12 real-browser checks,
lint clean, typecheck clean, production build succeeds. Per explicit instruction, this round ends
at Codex re-review, not at self-declared APPROVE — see `docs/CODEX_REVIEW_PACKET.md`'s updated
fix-round section for the exact re-review scope and this commit's HEAD SHA.

---

## 2026-08-17 — Local-environment verification round: four green results falsified

Development moved from the Claude Code Web sandbox to a local Windows/VS Code machine. The
sandbox had no real PostgreSQL, no browser, and no outbound network; the local machine has all
three. Everything below was found by running existing, already-"passing" work on real
infrastructure — no new features were speculated into existence to justify the move.

The headline lesson is recorded deliberately: **209/209 green was accurate about the environment
that produced it and wrong about the product.** Two of those tests failed against a real
PostgreSQL on a fast machine, and a third had never executed on Windows at all.

### H3's fix was itself defective (re-fixed)

`upsertRevisionAwareObservation()` located the revision chain's "latest" row with
`orderBy: { retrievedAt: "desc" }`. Prisma maps `DateTime` to Postgres `timestamp(3)`, so an
original and its revision written within the same millisecond carry identical timestamps and
Postgres may return them in either order. On the unlucky ordering the function compared the
incoming value against the ORIGINAL rather than the newest revision, concluded a revision was
needed, and attempted to attach a second child to a parent that already had one — violating
`(seriesId, observationDate, isRevision, revisionOf)`. The retry loop then re-read the same
ambiguous ordering, so it exhausted all 20 attempts and surfaced a raw P2002.

This is not a concurrency-only bug, which is why the H3 concurrency tests alone did not catch
it: a plain sequential re-ingest of already-revised data reproduced it
(`fred-ingest` "is idempotent"). Both that test and concurrency case B failed on first run here.

Fix: find the tail structurally — the row no other row points at via `revisionOf`. The 4-column
unique constraint guarantees at most one child per parent, making the chain a linked list with
exactly one tail, so the answer no longer depends on timestamp resolution. A chain with no tail
(a cycle, which the constraints should make unreachable) throws explicitly rather than looping.

### The H1 regression test had never run on Windows

`tests/integration/auth-migration-upgrade.test.ts` spawned `npx`: ENOENT under the bare name,
and EINVAL as `npx.cmd` because modern Node refuses to spawn a `.cmd` without a shell
(CVE-2024-27980 mitigation). The suite failed in `beforeAll`, before its first assertion, so the
migration upgrade-safety guarantee was unverified on this platform. Now invokes Prisma's CLI
entry point directly through `process.execPath` — portable, and one process shorter.

`scripts/run-ingest-jobs.ts` had the same class of bug spawning `npm`, with a worse failure
mode: `spawnSync` returns `status: null` rather than throwing, so every job would have been
reported as a normal FAILED job instead of never having started.

### Real EDGAR schema drift

`scripts/verify-edgar-live.ts` (new) checks both EDGAR adapters against live data.sec.gov —
field presence and types, the parallel-array alignment `filings.recent` depends on, date
formats, and each tracked XBRL concept's internal shape. It asserts the contract, not values,
so it catches drift without breaking every time Apple reports earnings.

First run found that SEC returns `fy: null, fp: null` on some companyfacts rows — facts
republished for a `frame` under a later restating filing. Both adapter types and both
`financial_facts` columns were non-nullable, so a real ingest would have failed on the first
such row. Apple alone has 20 across the six tracked concepts.

Three options were considered:

1. Drop those rows. Rejected: silent loss of real, fully-sourced history.
2. Derive a fiscal year from `periodEnd`. Rejected outright — that stores an inference in a
   column readers will treat as reported source data, which is precisely what
   `docs/DATA_POLICY.md` forbids.
3. Widen the columns to nullable. Chosen. The fact is fully sourced — value, period, form and
   accession number are all real — and only the label is absent. Nullability is threaded through
   `XbrlFactValue` → `NormalizedFinancialFact` → the Prisma model → `askMarket`, and `/ask`
   renders "fiscal period not reported" rather than a blank or a guess. The migration only
   relaxes NOT NULL, so it cannot invalidate an existing row.

Verified beyond the contract check: a real ingest of 1000 Apple filings and 1099 financial
facts, then a re-ingest returning 0 inserted / all unchanged. Both EDGAR rows in
`docs/RELEASE_READINESS.md` move to `VERIFIED`.

A related hygiene fix: the XBRL ingest test was leaving fabricated $400B Apple financials in the
dev database, which can now also hold real ingested facts. Invented numbers sitting next to
sourced ones is the exact confusion the data policy exists to prevent, so the test cleans up on
the way out as well as on the way in.

### M19 Watchlist got a real request path

`docs/RELEASE_READINESS.md` had named this precisely: the domain module was built and tested,
but nothing in `src/app` or `src/server/actions` called it, so cross-user isolation was verified
only at the function-signature level — there was no HTTP path to attack. Added
`src/server/actions/watchlist.ts` and `/watchlist`. `userId` always comes from the validated
session cookie and never from the form; accepting a form-supplied one would reduce every
per-user scope check in the domain module to decoration.

The page deliberately shows no score, rating or suggested action. Tracking is an information
filter, not a judgment about the item (`docs/LEGAL_GUARDRAILS.md`).

`tests/integration/watchlist-actions.test.ts` (8 tests) covers what the existing watchlist tests
structurally could not: no-session and expired-session rejection, a `userId` smuggled through
the form being ignored in favour of the session user, and one user failing to remove another
user's identically-keyed `(itemType, itemRef)` row. `npm run e2e` adds a real-browser
add/list/remove pass, and its Chromium path is now opt-in via `PLAYWRIGHT_CHROMIUM_PATH` instead
of hardcoding the cloud sandbox's `/opt/pw-browsers/chromium`, which made the script unrunnable
anywhere else.

### Human Gate resolved

The user approved sending their own contact address in the SEC `User-Agent` header (2026-08-17),
which is what SEC's fair-access policy asks for and what unblocked live EDGAR verification. SEC
returns 403 for a User-Agent that is not roughly "<name> <contact email>" — a bare product name
or repository URL is rejected. The user also committed to obtaining free FRED, ECOS and OpenDART
API keys; those adapters stay unverified-live until the keys arrive, which is a pending user
action rather than a defect.

**Verification**: 218/218 tests against a real local PostgreSQL 16.10 (up from 209 — 8 watchlist
server-action tests, 1 null-fiscal-label regression), `npm run e2e` 17/17 in a real browser (up
from 12), 55/55 live EDGAR contract checks, lint/typecheck/format/production build all clean.

---

## 2026-08-17 (night) — Hardening round: completeness, guardrails, and secrets

A continuation of the local-environment round above, and it kept finding the same shape of
defect. Recording the pattern once here rather than eleven times below: **code that skips or
caps data and says nothing, so an incomplete result is indistinguishable from a complete one.**
Every finding in this round is an instance of it, in a different layer.

### EDGAR was storing 45% of Apple's filing history

`filings.recent` is hard-capped by SEC at 1000 entries; everything older spills into
`filings.files[]`, each naming another JSON document. The adapter read `recent` alone. Real
ingest went from 1000 filings (oldest 2015-06-04) to 2240 (oldest 1994-01-26).

The uncomfortable part is how it survived: the live contract check written the previous day
verified the response shape, printed "1000 recent filings" as an informational line, and
concluded `VERIFIED`. Shape verification is not completeness verification, and a suspiciously
round total should be read as a cap rather than a count. `docs/RELEASE_READINESS.md`'s EDGAR row
now records that its own first verification was incomplete, because that is more useful to the
next reader than a clean-looking VERIFIED. The script asserts completeness now.

### Silent pagination truncation in all three keyed adapters

FRED's `count`, ECOS's `list_total_count`, and DART's `total_page` were each received and then
ignored; every client fetched page one and treated it as the whole answer. DART is the starkest:
one request capped at 100 rows, against a filer that files several hundred disclosures a year.
Found by reading the adapters against their own documented response shapes, before any key
existed — worth noting, because it means the fix did not need the Human Gate to be resolved.

Each client now pages to the provider's own total, bounded, and returns `truncated` plus that
total. Tested at the client boundary rather than by pushing 14,000 synthetic rows through the
real ingest, which added ~100s to the suite and proved nothing extra.

### `truncated` was a field nobody read

Which the Codex packet itself asked about. Every adapter returned a completeness signal and all
of it went to `console.warn`. Added the `IngestRun` model (purely additive migration),
`recordIngestRun` at the script entry points — the real run boundary, so tests do not litter the
table — and an "Ingest completeness" section on /admin showing fetched vs. provider total.

SUCCESS, PARTIAL and FAILED are kept as three distinct outcomes. Collapsing PARTIAL into SUCCESS
is precisely how a partial dataset comes to read as a whole one. A failure is recorded and
re-thrown rather than swallowed: the caller still needs to fail, but a run that died is the run
an operator most wants to see afterwards.

### Provider API keys were reaching logs — and then the database

`HttpTimeoutError` embeds the request URL, and credentials live in those URLs: ECOS in a path
segment, FRED and DART in a query parameter. Already bad as console output; persisting
ingest-run errors made it materially worse, since a single upstream timeout would have written a
live key into `ingest_runs.error` and rendered it on /admin.

`redactSecrets` redacts the actual configured credential values wherever they appear — exact
rather than pattern-based, so it covers path segments, query parameters, and any provider added
later that nobody wrote a pattern for — plus known credential parameter names as a second layer.
Applied at the error constructor and again at persistence. It ignores implausibly short values,
since a two-character key would match everywhere and destroy every message's diagnostic value.

### Third-party input in a URL

`filings.files[].name` was interpolated straight into a request URL. A path traversal or absolute
URL in that field would send the request elsewhere. Constrained to the filename shape SEC
documents; anything else throws. Small surface, but not worth leaving open on the grounds that
the third party is trustworthy today.

### 14 real bypasses in the Ask Market buy/sell guardrail

The most serious: "price target" was undetected. Price targets are named explicitly in
`docs/LEGAL_GUARDRAILS.md`'s hard-prohibitions list and only the "target price" word order was
covered — the reverse, which is the more common phrasing, went straight through. Same for
목표가/목표주가.

Two of the closed bypasses were ones `docs/CODEX_REVIEW_PACKET.md` had itself listed as open,
written down as suggested reviewer inputs rather than fixed. Better that a re-reviewer finds them
handled than confirms a hole we had already documented.

Guarded the opposite failure deliberately. A guardrail that redirects everything is
indistinguishable from a broken product and pushes users toward tools with no guardrail at all,
so seven analytical controls now share vocabulary with the new patterns and must keep passing
through. Non-English-non-Korean input remains genuinely unhandled — the honest limit of a
deterministic pattern approach, and an argument for the M21 LLM decision rather than something to
keep patching.

### Watchlist request-path audit

Three findings. An unused exported server action (every export in a `"use server"` module is a
network-reachable endpoint whether or not a page calls it, so an unused export is HTTP surface,
not dead code). No per-user row cap. And an `upsert` that could surface a raw P2002 under
concurrent submission — the same read-then-write-treated-as-atomic shape as the observation
revision race.

The design decision worth preserving: no action accepts a `WatchlistItem.id`. Removal is
addressed by `(itemType, itemRef)` resolved together with the session user's id, so there is no
direct object reference to tamper with. A delete-by-row-id refactor would introduce exactly the
IDOR this avoids.

### Test-suite honesty

Two fixes aimed at the suite itself rather than the product. `tests/integration-coverage-guard.
test.ts` fails loudly in CI when `DATABASE_URL` is unset, because otherwise all 25 integration
files skip themselves and the run still reports green. And `npm run e2e` now drives the Ask
Market guardrail through the real page — the detector was unit-tested, but nothing proved it was
wired into the page a user reaches.

### Completed the 2026-08-16 impossible-date sweep

That pass added `assertValidCalendarDate` to FRED and ECOS. DART, EDGAR submissions and EDGAR
XBRL were all missed; a `\d{8}` or `\d{4}-\d{2}-\d{2}` check proves shape, not validity, so
"20260230" would have rolled silently to Mar 2 and filed data under a date the source never
reported. All four adapters now share the guard.

### Measured and deliberately did not act

Re-ingesting 2240 filings runs in 2.7s against local Postgres despite a per-row `findUnique`.
The N+1 is real and the workload is not, so it was left alone rather than optimised on
principle.

A full security sweep found nothing further: one raw query in application code and it is a
parameterised tagged template, no `RawUnsafe` calls, no hardcoded secrets, only `.env.example`
tracked, no `dangerouslySetInnerHTML`, no environment logging.

**Verification**: 258/258 tests against real local PostgreSQL 16.10, `npm run e2e` 24/24 in a
real browser, `npm run verify:live:edgar` 59/59 against real data.sec.gov, all 13 migrations
applied cleanly to a genuinely fresh database, lint/typecheck/format/production build clean.
Nothing here is self-declared APPROVE, and no provider other than SEC EDGAR is claimed
live-verified.

---

## 2026-08-17 (late night) — What real data revealed

The hardening round above was found by reading code and running the suite on real infrastructure.
This round was found a different way, and the method is the most transferable thing in this file:
**look at the real numbers and ask whether they are plausible.**

Each of these was a number sitting in a passing system:

| The number                                   | Why it was implausible                    |
| -------------------------------------------- | ----------------------------------------- |
| 1000 filings for Apple                       | Too round. It was SEC's cap, not a count. |
| "933 inserted, 168 unchanged" on an empty DB | Nothing can be unchanged against nothing. |
| 2240 filings, 933 facts, 0 joinable rows     | Not a coincidence.                        |
| 244 rows of net income, 13 of revenue        | Not how a company reports.                |
| Revenue +232.9985% quarter over quarter      | Not what Apple did.                       |

None had a failing test. Several had passing ones. No amount of additional fixture-based testing
would have surfaced any of them, because every fixture was written by someone who did not know
the shape that breaks the code.

### Filing Diff reported a fabricated +233% revenue increase

The most serious defect found. It took "the two most recent rows ordered by periodEnd, then
filedDate", which against real SEC data selects two figures from the SAME filing: one Apple 10-Q
reports revenue for the nine months ending 2026-06-27 ($364.357B) and for the three months ending
on the same date ($109.417B), same accession number. Subtracting them gave +232.9985% for revenue
and +242.9948% for operating income — confident, plausible, entirely invented, and displayed as a
computed financial change. Precisely what `docs/DATA_POLICY.md` exists to prevent. Post-fix those
concepts read -1.5893% and -0.5295%.

A period-over-period comparison requires the same period LENGTH and a different period. Both are
enforced now, and a concept with no comparable pair reports INSUFFICIENT_DATA rather than
inventing one — saying "not enough data" is the feature. Length is bucketed to whole months
because fiscal quarters are not a fixed number of days (Apple's run 89-98); exact matching would
refuse to compare two genuine quarters. Which figure is "current" is decided by an explicit
tie-break on the shortest period, since several lengths share both a period end and a filed date.

### A financial fact's identity includes the period start

The unique key omitted `periodStart`, so the year-to-date and quarterly figures above were treated
as one row and one was dropped — 168 per ingest, chosen by array order. Enforced as two partial
unique indexes rather than by adding the column to the key: `periodStart` is NULL for instant
concepts, and Postgres treats NULL as distinct from NULL in a unique index, so the naive fix would
have silently stopped enforcing uniqueness for exactly those rows. Same trap as H3.

The migration's first version dropped the old index by guessed name and silently no-opped, because
Prisma truncates generated names to 63 characters. It drops by shape now. `DROP INDEX IF EXISTS`
against a misspelled name reports success.

### The two EDGAR adapters identified companies differently

Filings stored SEC's padded `cik`, XBRL stored the unpadded tracked constant. Zero joinable rows,
and Ask Market's "Company facts" section silently empty for every EDGAR company. Neither adapter
was canonicalising; they simply differed, and a unit test on either alone would have passed. Both
pad explicitly now, and the regression test ingests through both and joins the results.

### Revenue was missing for eight years

US GAAP's ASC 606 transition moved revenue to a new tag. Tracking only `Revenues` gave 11 rows
ending 2018. Added the pre- and post-transition tags; coverage now runs 2007 to 2026.

Each tag is stored verbatim rather than merged into a canonical "Revenues". Renaming one tag's
values under another's would be an interpretation, and the ASC 606 boundary is exactly where a
reader would want to know which tag a number came from. Unification belongs at presentation.

### CALCULATION claims never verified their own source

`verifyFactClaim` always compared `claim.sourceId` against its evidence; `verifyCalculationClaim`
did not, and `buildChangeClaimText` does not mention the source — so a change attributed to the
wrong provider reconstructed to byte-identical text and verified as VERIFIED. Found by looking at
the neighbours of the Codex-reported H2 rather than at H2 alone, which generalises: a reported
finding is often one instance of a local habit.

### Secrets, and a small SSRF surface

`HttpTimeoutError` embeds the request URL and providers put credentials in those URLs — ECOS in a
path segment. Persisting ingest-run errors would have written a live key into `ingest_runs.error`
and rendered it on /admin. `redactSecrets` redacts the actual configured values wherever they
appear, which covers path segments and any provider added later that nobody wrote a pattern for.
Separately, `filings.files[].name` came from SEC's response and was interpolated into a request
URL; it is now constrained to the documented filename shape.

### Company X-Ray finally has a view

M15 built the adapter and store, M16 the diff, and nothing assembled them — the same
built-but-unreachable gap the Watchlist had. `/company` and `/company/[corpCode]` show reported
figures, the change against the previous comparable period, and recent filings. No type in the
read model can carry a score, rating, valuation or target, asserted by serialising the whole
result in a test. Watchlist entries link through, but only where the reference resolves to a
company with stored filings — a dead link implies coverage that does not exist.

### Two things deliberately measured and left alone

Re-ingesting 2240 filings takes 2.7s despite a per-row `findUnique`, and the Observation-based
computations run in ~100ms over 16,000 synthetic observations. Both are real N+1-ish shapes and
neither is a real workload, so neither was optimised.

### Test-suite honesty

`DATABASE_URL` unset silently skipped all 25 integration files while reporting green; a guard now
fails loudly in CI. The e2e walkthrough runs in CI against the production build, because
everything else in the gate can pass while the legal guardrail is not wired to `/ask`. Tests
redirect to `TEST_DATABASE_URL` when set, so a run stops erasing ingested data — that bit three
times in one session. And an encoding guard catches the PowerShell ANSI round-trip that twice
corrupted Korean fixtures and em dashes, once silently.

**Verification**: 281/281 tests against real local PostgreSQL 16.10, `npm run e2e` 30/30 in a real
browser against the production build, 67/67 live EDGAR contract checks, all 15 migrations applied
to both a fresh and a populated database, real ingest of 2240 filings and 1428 facts with an
idempotent re-ingest, lint/typecheck/format/build clean. Nothing here is self-declared APPROVE,
and no provider other than SEC EDGAR is claimed live-verified.

---

## 2026-08-18 — Third hardening round: working the review packet instead of waiting for it

Independent review is blocked on included-usage exhaustion until 2026-08-22. Rather than treat
that as a stop, the round was spent answering the attack questions in
`docs/INDEPENDENT_REVIEW_PACKET.md` directly. Every finding below came from one of them, which
is the argument for writing the packet before a reviewer is available rather than after.

Two of the findings were in code written the previous day. That is the most useful signal in this
entry: the patterns this project keeps producing are not historical, and freshly written code is
not exempt.

### Destructive-test database selection now fails closed

The earlier protection redirected tests to `TEST_DATABASE_URL` when set and fell back to
`DATABASE_URL` when not. Wrong default — the protection reached only people who already knew they
needed it, and forgetting the variable silently reinstated the hazard it existed to remove.

`resolveTestDatabase` is a pure function so the decision is testable, and refuses on: a reachable
database with no test database named; a test URL addressing the same database as the dev one
(compared by host and path, not string, so different credentials cannot slip it through); a name
that does not identify itself as disposable; and a name reading as a real environment even when
it also says "test". Same-database is checked first, because when both are true it is the more
alarming diagnosis and the naming message would bury it.

Applied in `vitest.config.mts`, not a setup file, so an unsafe configuration stops the run before
anything opens a connection. All four paths were exercised against the real config rather than
only the pure function, and the dev database still held its 2240 filings afterwards.

### The "no database" path never actually worked

The guard documents running with no database as supported. It was not: four unit test files
failed outright, and a fifth after those. Found by trying it rather than trusting what had just
been written.

`export const prisma = createClient()` ran at module scope, so importing any module that touches
the database required `DATABASE_URL` transitively — `tests/askMarket.test.ts` exercises a pure
detector function but importing its module reached the client and threw. The client is now built
on first property access behind a proxy: call sites unchanged, imports side-effect free, and a
missing connection string surfaces at the query with the query in the stack.

The fifth failure was `auth-migration-upgrade.test.ts` parsing `DATABASE_URL!` at describe-body
scope. Vitest evaluates the body of a skipped `describe` to collect it, so a suite designed to
skip itself failed the whole file. This was predicted by the packet's own A6 question.

### Event ingest: a fourth read-then-write race, and a non-atomic write

`ingestMention` did `findUnique({url})` then `create`. Reproduced before fixing: four concurrent
ingests of one URL rejected three of four with a raw P2002 — for an operation whose own contract
calls a repeated URL a no-op.

Worse and structural: `Event` and its first `EventMention` were separate statements, so a failure
between them left an Event with `mentionCount: 1` and nothing attached — a row rendering on
/today as a real event with a count nothing backs. Both paths are single transactions now, and
`countDistinctTiers` takes the transaction client so it counts the mention just inserted.

### A fifth identity-representation mismatch, one day old

`IngestRun.target` recorded the unpadded CIK while the filings and facts it describes are stored
padded. Nothing joined them, so nothing looked broken — and the completeness lookup built minutes
later would have returned nothing and reported UNKNOWN forever. That failure mode is worse than a
crash: it reads as a feature nobody finished rather than a broken join.

### Truncation reaches the reader, not just the operator

The packet asks whether `truncated` is consumed anywhere that changes behaviour. It was not —
only displayed, and only on /admin. `/company/[corpCode]` now carries COMPLETE,
KNOWN_INCOMPLETE (with the shortfall), LAST_RUN_FAILED, or UNKNOWN. UNKNOWN matters: the runs
table is new, so absence of a record is genuinely unknown, and defaulting it to a reassuring
answer would be the same class of lie the truncation work exists to prevent.

### Persisted errors carried filesystem paths and source code

Tested rather than reasoned about, by forcing a real Prisma connection failure. Good news: the
`DATABASE_URL` password does NOT appear — Prisma reports "Can't reach database server at
host:port". Bad news: the message embeds a code frame with an absolute path and several lines of
application source, and `recordIngestRun` persists `err.message` for /admin to render.
`sanitiseErrorForStorage` redacts first, then strips the code frame, the `invocation in
<path>:line:col` header, and absolute Windows and POSIX paths. The line an operator needs
survives intact.

### 14 more Ask Market bypasses

A probe of 21 adversarial phrasings against 11 analytical controls found 14 slipping through:
stop loss, entry and exit price, "what percentage of my portfolio", "how should I allocate
between", "what weighting", roleplay and "pretend you are", "if you were me", "if you had X where
would you put it", "what would a smart investor do", "my advisor said X do you agree", and the
spaced Korean form of 비중 조절.

The sizing patterns anchor on possessives and on the act of allocating rather than on the word
"percentage" — "what percentage of GDP is Korean household debt" is a legitimate macro question
and is now an explicit negative control. Zero false positives across all controls.

### Recorded rather than built

Filing Diff cannot show an original-vs-restated comparison, because a period-over-period change
requires a different period end. That exclusion is correct — a restatement is not a
period-over-period change, and showing it there would be the same category error as the +233%
defect — but restatements are consequently invisible even though both rows are stored. Logged as
debt, not built speculatively.

Unit strings are matched exactly and case-sensitively; `tests/unitVocabulary.test.ts` pins the
vocabulary so the next typo fails at test time, rather than introducing a type-level unit that
five values do not justify.

### Answered with evidence, no change needed

Only `observationIngest` writes rows with `isRevision = true`, so nothing can fork a revision
chain behind its back. No code path compares across units or currencies — every diff query fixes
the unit. No test mocks the application path: `vi.stubGlobal` is only ever used on `fetch`, the
database is always real, and the true request path is covered by the browser walkthrough against
the production build.

**Verification**: 331/331 tests against a disposable PostgreSQL 16.10, `npm run e2e` 30/30 in a
real browser against the production build, 67/67 live EDGAR contract checks, 16 migrations
against both fresh and populated databases, 159 unit tests passing with no database at all,
lint/typecheck/format/build clean.

## 2026-08-19 — Continuation is state-based, and escalation is asynchronous

**Decision.** Autonomous work continues while a safe runnable task exists. Absolute time is never a
completion condition, and an escalation or a Human Gate blocks only the task that actually depends
on it.

**Why this is written down rather than just followed.** Every previous directive carried a clock —
"until 18:00", "until 20:00" — and a clock answers the wrong question. It says when to stop rather
than whether anything is left, and the two diverge in both directions: a session can run out of
useful work at 15:00 and can have a P1 half-fixed at 20:00. Checking the repository revealed
something worth noting: **no time-based termination had ever been persisted here.** The deadlines
lived entirely in chat, so there was nothing to remove — a case where the honest answer to "replace
the time-based rules" is that there were none.

**What changed, minimally.** `CLAUDE.md` gains the continuation, escalation and verification rules,
because it is the file every session reads first. `evaluateStopSentinel()` joins the existing
scheduler rather than starting a second mechanism.

**The sentinel's design choice worth defending.** It takes counts of failing checks, advanceable
blockers and unhandled review findings from the caller, and **an unsupplied count blocks stopping
rather than defaulting to zero.** The scheduler cannot observe a failing build or an unread finding
and must not pretend to. This is the project's standing rule — unknown is not success — applied to
the thing that decides whether to stop, where getting it wrong would be self-concealing: a sentinel
that assumes the best would report a clean stop precisely when it knew least.

**Open escalations are recorded and never obeyed as a halt.** A single unanswered question would
otherwise freeze every independent task in the repository, which is the failure the protocol
explicitly forbids.

**The escalation channel works in one direction.** Issue #2 is readable over the unauthenticated
API because the repository is public, so ChatGPT → Claude is live. Claude → ChatGPT needs the same
credential as `git push` (HG-001), so replies are staged verbatim in
`docs/escalation/PENDING_COMMENTS.md`. Staging rather than reconstructing later matters: a reply
written from memory weeks on is a different artifact from the one that was owed.

## 2026-08-20 — RC-GATES-001: the two remaining gates are not equal

Decided by `[CHATGPT_DECISION][RC-GATES-001]` on issue #2, anchored to candidate `6103ad8`.

For most of this project the release status has been "blocked on two Human Gates", stated as
though they were the same kind of thing. They are not, and treating them alike is what kept the
release candidate in a single undifferentiated blocked state.

**Gate A — final independent adversarial review — is a true technical blocker.** Narrower than "no
Codex review has happened", which is what the checklist used to imply: real reviews have run and
found real defects (`HG-005`). What is missing is a final read-only pass over the exact candidate
HEAD covering everything accumulated since. A green CI run, a self-review, or a partial review does
not substitute. It blocks promotion to `RELEASE_CANDIDATE_CODEX_APPROVED`, any public production
release touching authentication, user data or Ask Market, and any claim that the independent
security review is complete. It does not block documentation work, internal development, or a
clearly-labelled non-production preview using fixtures or already-verified EDGAR data.

**Gate B — full free-text Ask Market — is deferred product scope, not a blocker.** V1 ships the
deterministic `/ask` topic-search mode that already exists, with conversational inference disabled
and unavailable, the existing refusal behaviour preserved, no paid provider, no PAYG key, no hidden
fallback, and no INFERENCE claims while `verifyClaim()` still rejects unsupported ones. The product
is described as deterministic market research and search — not as full conversational Ask Market.
Reopening it needs one human decision carrying all eight items the decision enumerates: provider
and jurisdiction, budget and funding, credential lifecycle, fail-closed behaviour, legal enforcement
independent of model compliance, claim labelling with stored provenance, adversarial evasion and
injection testing with a kill switch, and the standing prohibition on personalised advice.

**Unchanged by this.** `HG-009` is not closed — the 5-attempt / 15-minute account lockout is
accepted as pre-launch only, and public production stays blocked until ingress topology and layered
throttling are decided and tested. Production deployment (`HG-007`) and payments (`HG-008`) remain
separate human approvals. Provider live classification waits on the documented verification
sequence for each free key. `LEGAL_GUARDRAILS.md`, the Claim Ledger provenance requirements,
fail-closed admin/auth/environment behaviour and the zero-extra-cost policy are never weakened by
any of this.

The honest reading is that the candidate is one review away from being a technical RC, and several
human decisions away from being deployable. Those were previously the same sentence.
