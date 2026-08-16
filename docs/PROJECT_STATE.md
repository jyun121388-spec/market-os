CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22, M23, M24, M25 (partial)

CURRENT
M26

STATUS
READY

TESTS
155 / 155 PASS (69 unit, 86 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (21 entries — added one M25 row: no real cron/queue scheduler,
BLOCKED_HUMAN_GATE pending production-deployment approval). M21 remains BLOCKED_HUMAN_GATE
pending a human decision on product-runtime LLM provider/funding/credentials.

NEXT
M26: Security Hardening. Auth (M22) and Admin (M24) both exist now with no dedicated security
review pass yet — docs/REVIEW_DEBT.md's M01-M22 row already flags this as Codex-review-required
once a Codex session is available (still PENDING, no session available in this environment).
Real scoping for this milestone without a Codex session: a self-review pass against
docs/LEGAL_GUARDRAILS.md and standard web-app security basics — session/cookie flags (httpOnly/
secure/sameSite), password-hashing parameters, rate-limiting on login/signup (brute-force
protection), input validation on auth forms, and confirming no secret ever gets logged or
returned in an error message. Check whether CSRF protection is needed given Next.js Server
Actions' same-origin enforcement (may already be handled by the framework — verify, don't
assume). No new paid security-scanning service (Human Gate if paid) — use what's already
available (eslint, manual code review, existing tests).
