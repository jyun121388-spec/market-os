CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22, M23, M24, M25 (partial), M26 (partial), M27 (partial — E2E walkthrough + honest
checklist audit; not a full production-scale QA pass, which needs an actual deployment)

CURRENT
M28

STATUS
READY

TESTS
157 / 157 PASS (71 unit, 86 integration against a real Postgres instance) + npm run e2e (12/12
checks, real browser, run this session)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (22 entries). Two genuine RC blockers per the M27 RELEASE_CHECKLIST
audit: M21 Ask Market (BLOCKED_HUMAN_GATE) and no Codex security review (no Codex session
available this entire session). Full detail in docs/RELEASE_CHECKLIST.md's per-item audit.

NEXT
M28: Release Candidate. Per the M27 RELEASE_CHECKLIST.md audit, this milestone cannot honestly
be marked DONE yet: two items are blocked on things outside this session's control (M21 needs a
human LLM-provider/funding decision; the security review needs a Codex session, unavailable this
entire session). Real scoping for what remains: close every checklist item that IS achievable
without those two blockers (Claim Ledger cross-feature provenance audit, timezone/KST-boundary
test coverage, user-facing stale-data marking), then write an honest M28 status — either
"Release Candidate blocked on N named Human Gates" (not a failure state, an accurate one) or,
if the user provides the M21 decision or a Codex session becomes available mid-session, complete
those and reassess. Do not mark M28/the roadmap "complete" while genuine blockers remain
un-surfaced — CLAUDE.md's Definition of Done requires Codex review done or logged as Review Debt,
which is exactly the state to document, not paper over.
