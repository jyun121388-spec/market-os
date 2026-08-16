CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22

CURRENT
M23

STATUS
READY

TESTS
137 / 137 PASS (52 unit, 85 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (20 entries). M21 remains BLOCKED_HUMAN_GATE pending a human decision
on product-runtime LLM provider/funding/credentials — not decided unilaterally.

NEXT
M23: Subscription-ready architecture. Per docs/ROADMAP.md, actual payment activation is a
Human Gate — this milestone is about the ARCHITECTURE being subscription-ready (plan/tier
concept, entitlement checks), not integrating a real payment processor or moving any real
money. Real scoping question: does the User model need a `plan`/`tier` field now, with
entitlement-check helpers gating nothing yet (since no paid features exist to gate)? Given no
feature currently requires a paid tier to use, consider whether this milestone has any real
work to do yet beyond a schema placeholder, or whether it's more honest to also flag this one
as premature/low-value until M21+ produces an actual feature worth gating — record the
reasoning in DECISIONS.md either way.