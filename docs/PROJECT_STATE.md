CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22, M23, M24, M25 (partial), M26 (partial — self-review, real Codex security review still
owed)

CURRENT
M27

STATUS
READY

TESTS
157 / 157 PASS (71 unit, 86 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (22 entries). M21 remains BLOCKED_HUMAN_GATE pending a human decision on
product-runtime LLM provider/funding/credentials. M25 remains BLOCKED_HUMAN_GATE pending
production-deployment approval for a real scheduler. M26 added a self-review-only caveat (no
Codex session available all session) and a new row: login lockout is per-email/process-local
only, no distributed rate limiting.

NEXT
M27: Production QA. No end-to-end QA pass across the full app (all pages, all flows) has run
together as one exercise — each milestone was verified individually (Playwright for
signup/login/admin, npm run *:print for domain logic, integration tests against real Postgres)
but never as a single cross-feature walkthrough. Real scoping: a genuine "production QA" pass
(load testing, multi-region, real user traffic patterns) needs an actual deployed environment,
which is gated on the production-deployment Human Gate the same way M25's scheduler is. What's
buildable now: a comprehensive Playwright walkthrough exercising every real page/flow in
sequence in this dev environment (signup → login → /today → /admin → logout → wrong-password
rejection → lockout → session expiry), plus a review of docs/RELEASE_CHECKLIST.md against
current state to see what's genuinely done vs. still open before any real release. No new paid
QA/monitoring tooling.
