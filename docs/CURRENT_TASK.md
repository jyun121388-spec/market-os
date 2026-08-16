# Current Task

MILESTONE: M28 — Release Candidate (DONE as far as this session can take it)

STATUS: Closed with an honest BLOCKED status, not a forced completion. See
`docs/RELEASE_CHECKLIST.md` for the full per-item audit and `docs/DECISIONS.md`'s M28 entry for
the reasoning. Every checklist criterion achievable without a human decision or a Codex session
has been built, tested, and verified this session (157/157 unit/integration tests, a real-browser
E2E walkthrough via `npm run e2e`, a real cross-feature Claim Ledger provenance audit). Two
genuine blockers remain, both outside this session's ability to resolve unilaterally:

1. M21 Ask Market — `BLOCKED_HUMAN_GATE`. Needs a human decision on which LLM provider to use
   for product-runtime inference, how its cost is funded, and the real credential (itself a
   separate Human Gate). See the M21 DECISIONS.md entry.
2. Codex critical security review — `PENDING`. No Codex session has been available in this
   environment at any point across the entire session, despite being flagged as required since
   M22. M26 shipped a self-review pass in the meantime (session-token randomness, login lockout)
   but that does not substitute for the real review.

NEXT EXACT ACTION FOR A FUTURE SESSION: Check whether either blocker has been resolved (a human
decision on M21 has been communicated, or a Codex session is available). If (1) is resolved,
resume at M21 per its DECISIONS.md entry ("verifyClaim should be extended to support INFERENCE
claims in the same milestone, and dedicated legal-guardrail tests... must ship with the first
real Ask Market implementation, not after it"). If (2) is resolved, run the Codex review against
the full Auth/Admin/session pipeline flagged in REVIEW_DEBT.md's M01-M22 row. If neither is
resolved, there is no further autonomous work available on the core roadmap — check
`docs/REVIEW_DEBT.md` for the smaller PENDING items (timezone/KST tests, stale-data marking,
distributed rate limiting) as optional, non-blocking, genuinely useful work that doesn't require
either gate.
