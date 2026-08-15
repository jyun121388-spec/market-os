CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20

CURRENT
M21

STATUS
READY

TESTS
122 / 122 PASS (46 unit, 76 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (19 entries, unchanged by M20).

NEXT
M21: BLOCKED_HUMAN_GATE (cost decision) — see docs/DECISIONS.md and docs/REVIEW_DEBT.md. Ask
Market's INFERENCE layer needs a live LLM call at PRODUCT RUNTIME (answering real user
questions), which is a fundamentally different cost category from using Claude Code / the Max
20x subscription for *development* of this codebase. The Max subscription authenticates this
coding session, not a deployed backend serving end-user requests — the product would need its
own LLM API access (a real per-token cost, whatever provider), which CLAUDE.md's absolute rules
require explicit human approval for. Not deciding this unilaterally. Switching to the next
independent milestone per CLAUDE.md ("blocked on Human Gate → switch to next independent task,
don't stop all work"): M22 Auth / User System, which has no such dependency.