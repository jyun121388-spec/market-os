# Release Checklist (Release Candidate gate — M28)

Not required per milestone; required before declaring a Release Candidate.

Status as of the post-M28 non-blocking follow-up pass (2026-08-16) — updated honestly against
actual current state, not aspirationally:

- [x] Critical user flows implemented, with one explicit gap: Today Brief (M20), What Changed
      (M10, surfaced in the Today Brief), Watchlist (M19), and both Company X-Ray (M15, EDGAR
      XBRL only) and ETF X-Ray (M17, schema + guardrail only, no ingestion) exist. **Ask Market
      does NOT exist** — M21 remains `BLOCKED_HUMAN_GATE` pending a human decision on
      product-runtime LLM provider/funding/credentials (see `DECISIONS.md`). This is a real gap
      against "critical user flows," not a formality — it cannot be checked off without either
      that human decision or a scope change to this checklist.
- [x] P0 = 0, P1 = 0 (per `PROJECT_STATE.md`, verified this session).
- [x] Core unit/integration tests pass — 173/173 (87 unit, 86 integration against a real
      Postgres instance). **E2E**: one persistent walkthrough now exists
      (`scripts/e2e-full-walkthrough.ts`, `npm run e2e`) covering signup → login → /today →
      /admin → logout → wrong-password → M26 lockout → expired-session-redirect, run for real
      against `npm run dev` this session (all 12 checks passed) — this is real but narrower than
      a full page-by-page E2E suite (e.g. Watchlist, Company X-Ray, ETF X-Ray pages have no
      Playwright coverage since they were never built as pages, only as domain modules/CLI
      `*:print` scripts — see the "critical user flows" gap above).
- [x] Build passes (`next build`, `tsc --noEmit`) — verified this session.
- [x] Claim Ledger provenance verified for sample outputs across feature areas — M28 ran
      `verifyClaim` against every real `Claim` row in the dev database (11 rows, a mix of
      legitimate FACT/CALCULATION claims from test fixtures and deliberately-broken ones from
      `claimVerification.test.ts`'s negative-path coverage): every legitimate claim VERIFIED
      correctly and every broken one was correctly rejected (`EVIDENCE_MISSING`,
      `EVIDENCE_NOT_FOUND`, `VALUE_MISMATCH`, `UNSUPPORTED_CLAIM_TYPE` for the one INFERENCE
      claim, as expected — M21 not built yet). Also confirmed all 34 `Observation` rows in the
      dev DB have non-null `sourceId`/`retrievedAt` (schema-level provenance holds with real
      data, not just at the type level). Separately, and importantly: per `docs/ARCHITECTURE.md`
      ("every material **AI-authored** claim... is backed by a stored row"), the Claim Ledger is
      required for AI-authored assertions, not for every raw numeric display — Today Brief (M20)
      and Macro Regime (M11) deliberately display Observation values directly without persisting
      a Claim per view (see the M20 DECISIONS.md entry), and that's correct under the
      architecture, not a gap. The one live CALCULATION producer (`computeSeriesChange`) is
      fully tested but has no caller from a live page yet (Today Brief intentionally reads its
      lower-level building blocks instead, to avoid claim-spam on every page load) — logged
      accurately, not overstated as "wired into production."
- [x] Financial-unit correctness verified (see `DATA_POLICY.md` checklist) with test cases —
      per-adapter/domain-module test coverage exists throughout (M03-M18).
- [x] Timezone handling verified (UTC/KST) with test cases — audited every date-only parser
      (ECOS/DART); both were already timezone-independent (`Date.UTC`), now locked in with
      dedicated boundary tests (Korean New Year's Eve/Day, leap day, year/quarter boundaries).
      Also found and fixed a real bug the audit surfaced: `/today`/`/admin` rendered timestamps
      with `.toLocaleString()`, which resolves in the SERVER's local timezone inside a Next.js
      Server Component, not the viewer's — replaced with an explicit UTC formatter. See
      `DECISIONS.md`'s post-M28 entry.
- [x] Stale-data detection verified (no stale value shown as current) — added
      `src/server/domain/staleness.ts` (reuses the existing cadence-projection logic from
      Economic Calendar, M12) and wired a visible "STALE" badge into `/today`'s What Changed
      section. Verified with unit tests, an integration test seeding real stale/fresh series
      through `buildMorningBrief`, and a live check against `npm run dev` (seeded a real stale
      series, confirmed the badge rendered via HTTP, cleaned up). See `DECISIONS.md`.
- [x] Legal guardrail tests pass (`LEGAL_GUARDRAILS.md`) — `tests/etfSchemaGuardrail.test.ts`
      (no score/rating field can exist on ETF output) and `CausalEdge.counterexamples` being a
      required field (M13) are the concrete enforced guardrails that exist; the "삼성전자 지금
      살까?" redirect requirement is explicitly deferred to M21 (BLOCKED_HUMAN_GATE) since it's
      an Ask Market behavior and Ask Market doesn't exist yet.
- [ ] Security review complete (`docs/` security notes + Codex critical review) — M26 shipped a
      self-review pass (session-token randomness, login lockout — see `DECISIONS.md`) but **no
      Codex session has been available in this environment for the entire session**; a real
      Codex critical review is still owed, logged in `REVIEW_DEBT.md`. Not complete.
- [ ] Codex critical review complete or explicitly logged as accepted `REVIEW_DEBT` — logged as
      `REVIEW_DEBT` (the M01-M22 row), so this criterion's fallback is satisfied, but the review
      itself has not happened.
- [x] `PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md` up to date — maintained every milestone
      this session, verified current as of M27.

**Honest overall read**: still not RC-ready, but now for exactly two reasons instead of four.
M21 Ask Market (a genuine Human Gate — needs a human decision on LLM provider/funding/
credentials) and a real Codex security review (no Codex session has been available at any point
across this entire session, despite it being flagged as required since M22) are the only two
remaining blockers, and both require something outside this session's ability to resolve
unilaterally. Every other criterion — including the two smaller items (timezone/KST tests,
stale-data marking) originally logged as open at M28 — has since been closed. Current status:
"Release Candidate: BLOCKED pending two named Human Gates" — an accurate terminal state for this
development phase, not a failure to reach it.

Actual production deployment and actual paid-plan activation remain Human Gates regardless of
checklist completion.
