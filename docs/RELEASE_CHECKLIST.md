# Release Checklist (Release Candidate gate — M28)

Not required per milestone; required before declaring a Release Candidate.

Status as of M27 (Production QA pass, 2026-08-16) — updated honestly against actual current
state, not aspirationally:

- [x] Critical user flows implemented, with one explicit gap: Today Brief (M20), What Changed
      (M10, surfaced in the Today Brief), Watchlist (M19), and both Company X-Ray (M15, EDGAR
      XBRL only) and ETF X-Ray (M17, schema + guardrail only, no ingestion) exist. **Ask Market
      does NOT exist** — M21 remains `BLOCKED_HUMAN_GATE` pending a human decision on
      product-runtime LLM provider/funding/credentials (see `DECISIONS.md`). This is a real gap
      against "critical user flows," not a formality — it cannot be checked off without either
      that human decision or a scope change to this checklist.
- [x] P0 = 0, P1 = 0 (per `PROJECT_STATE.md`, verified this session).
- [x] Core unit/integration tests pass — 157/157 (71 unit, 86 integration against a real
      Postgres instance). **E2E**: one persistent walkthrough now exists
      (`scripts/e2e-full-walkthrough.ts`, `npm run e2e`) covering signup → login → /today →
      /admin → logout → wrong-password → M26 lockout → expired-session-redirect, run for real
      against `npm run dev` this session (all 12 checks passed) — this is real but narrower than
      a full page-by-page E2E suite (e.g. Watchlist, Company X-Ray, ETF X-Ray pages have no
      Playwright coverage since they were never built as pages, only as domain modules/CLI
      `*:print` scripts — see the "critical user flows" gap above).
- [x] Build passes (`next build`, `tsc --noEmit`) — verified this session.
- [ ] Claim Ledger provenance verified for sample outputs **across feature areas** — verified
      per-milestone in isolation (M08/M09 tests, `verifyClaim`), but never as one cross-feature
      audit pulling a real sample from each feature area and checking it end-to-end. Not done.
- [x] Financial-unit correctness verified (see `DATA_POLICY.md` checklist) with test cases —
      per-adapter/domain-module test coverage exists throughout (M03-M18).
- [ ] Timezone handling verified (UTC/KST) with test cases — no dedicated UTC/KST test suite
      exists; dates are stored/compared as UTC `DateTime` throughout, but no milestone
      specifically tested KST-boundary edge cases (e.g. a KST-midnight observation date vs. its
      UTC storage). Open.
- [ ] Stale-data detection verified (no stale value shown as current) — `/admin`'s "last ingest"
      display (M24) surfaces staleness for an operator, but no user-facing feature marks an
      individual value as stale/current. Open — no milestone has built this yet.
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

**Honest overall read**: not RC-ready. The two blocking gaps are M21 Ask Market (a genuine
Human Gate, not a scoping choice) and a real Codex security review (no session available in this
environment so far). Everything else buildable without a human decision or external tooling has
been built and verified.

Actual production deployment and actual paid-plan activation remain Human Gates regardless of
checklist completion.
