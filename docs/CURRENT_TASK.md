# Current Task

MILESTONE: M28 — Release Candidate

TASK: Per the M27 `docs/RELEASE_CHECKLIST.md` audit, an honest Release Candidate cannot be
declared yet — two items are blocked on things outside this session's unilateral control: (1)
M21 Ask Market needs a human decision on LLM provider/funding/credentials (a genuine Human Gate,
not a scoping choice this session can route around); (2) a Codex critical security review needs
an actual Codex session, which has not been available at any point this session. What IS
achievable without either blocker, still open per the M27 audit: a cross-feature Claim Ledger
provenance audit (pull one real sample output from each feature area — Today Brief, Macro
Regime, Historical Analog, Company X-Ray — and verify its claim traces to a stored source, not
just per-milestone in isolation as already tested), timezone/KST-boundary test coverage (no
dedicated UTC/KST edge-case tests exist despite UTC `DateTime` being used throughout), and
user-facing stale-data marking (no feature currently marks an individual displayed value as
stale vs. current — `/admin`'s pipeline-health view is operator-facing only, not user-facing).

STATUS: Not started — M27 (Production QA) complete and verified.

NEXT EXACT ACTION: Start with the Claim Ledger cross-feature audit since it's pure verification
(no new feature code) — trace one real claim from Today Brief's What Changed section back to its
Observation and Source, confirm `verifyClaim` accepts it, and do the same for a Macro Regime
reading. Then decide concretely whether timezone/KST tests and stale-data marking are real gaps
worth closing now or reasonable to log as scoped-out for V1 (record whichever in DECISIONS.md
either way, not silently). Finally write the honest M28 status: still blocked on M21 + Codex
review, with everything else either closed or explicitly logged.
