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
