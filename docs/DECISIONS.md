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
