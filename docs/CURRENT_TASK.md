# Current Task

MILESTONE: M26 — Security Hardening

TASK: No dedicated security-review pass has happened yet on Auth (M22) or Admin (M24) — the
docs/REVIEW_DEBT.md M01-M22 row already flags this as Codex-review-required, and no Codex
session has been available in this environment for the whole session so far. Real scoping
without a Codex session: a thorough self-review against docs/LEGAL_GUARDRAILS.md and standard
web-app security basics, specifically: (1) session cookie flags (httpOnly/secure/sameSite) on
the `market_os_session` cookie, (2) scrypt parameters used for password hashing (are they
reasonable defaults or need tuning), (3) whether login/signup have any rate-limiting or brute-
force protection (currently none — is that acceptable for this stage or worth adding a minimal
in-memory limiter, consistent with M25's "no external service" pattern), (4) whether any error
path could leak a secret, stack trace, or internal detail to the client, (5) CSRF: Next.js
Server Actions enforce same-origin by default — verify this is actually true for this Next.js
version rather than assuming, and check if any additional protection is warranted. No new paid
security-scanning service (that's a Human Gate the moment it's paid) — use eslint, manual review
of the actual source, and the existing test suite.

STATUS: Not started — M25 (Performance / Cache / Background Jobs) complete and verified.

NEXT EXACT ACTION: Read `src/server/domain/auth.ts` and `src/server/actions/auth.ts` in full,
check the cookie-setting code for the session cookie's flags, check `scryptSync` parameters
against Node's documented recommended minimums, and decide concretely (not speculatively)
whether a minimal login-rate-limiter is in scope for this pass. Write findings + fixes, add
tests proving any new protection actually works (e.g. wrong-password lockout after N attempts,
if added), and verify with Playwright as usual for any behavior change to the login/signup flow.
