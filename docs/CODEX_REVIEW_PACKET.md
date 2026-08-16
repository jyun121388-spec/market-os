# Codex Review Packet

Prepared because no Codex session has been available in this development environment at any
point across the M00-M28 build-out. This packet exists so that whenever a Codex session (or any
independent reviewer) becomes available, review can start immediately without re-deriving
context. It is not a substitute for the review — `docs/REVIEW_DEBT.md`'s M01-M22 row stays
`PENDING` until an actual independent review happens.

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
- ~35 commits, built from an empty repository through the full M00-M28 roadmap plus post-M28
  follow-up work (timezone/staleness fixes, a security-review skill pass, an M21 safe-mode MVP).
- 160+ files changed, ~20k lines added.
- Full commit history and reasoning for every non-obvious decision: `docs/DECISIONS.md`
  (chronological, append-only, ~35 entries).

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
recommendation), but is a gap in the "always redirect" requirement. Recommended specific test
inputs for a reviewer, in addition to `tests/askMarket.test.ts`'s existing 11 cases:

- Indirect phrasing: "would now be a wise time to add to my position"
- Third-person framing: "is Samsung Electronics a buy right now"
- Non-English languages other than Korean (not currently handled at all — a real, acknowledged
  gap, not hidden: the pattern list is English + Korean only).
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

184/184 automated tests passing as of this packet's writing (98 unit, 86 integration).

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
