# Release Checklist (Release Candidate gate — M28)

Not required per milestone; required before declaring a Release Candidate.

- [ ] Critical user flows implemented (Today Brief, What Changed, Ask Market, Watchlist, at
      least one of Company X-Ray / ETF X-Ray).
- [ ] P0 = 0, P1 = 0.
- [ ] Core unit/integration/E2E tests pass.
- [ ] Build passes (`next build`, `tsc --noEmit`).
- [ ] Claim Ledger provenance verified for sample outputs across feature areas.
- [ ] Financial-unit correctness verified (see `DATA_POLICY.md` checklist) with test cases.
- [ ] Timezone handling verified (UTC/KST) with test cases.
- [ ] Stale-data detection verified (no stale value shown as current).
- [ ] Legal guardrail tests pass (`LEGAL_GUARDRAILS.md`).
- [ ] Security review complete (`docs/` security notes + Codex critical review).
- [ ] Codex critical review complete or explicitly logged as accepted `REVIEW_DEBT`.
- [ ] `PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md` up to date.

Actual production deployment and actual paid-plan activation remain Human Gates regardless of
checklist completion.
