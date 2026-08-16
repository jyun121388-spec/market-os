# Current Task

MILESTONE: M23 — Subscription-ready architecture

TASK: Per docs/ROADMAP.md, actual payment activation is a Human Gate. This milestone is about
the ARCHITECTURE being subscription-ready, not integrating a real payment processor. Real
question to resolve before coding: no feature currently built requires a paid tier to use, so
there is nothing real to gate yet. A `plan`/`tier` field on `User` with no enforcement anywhere
would be speculative schema — the same pattern this project has repeatedly avoided (e.g. M13's
"no multi-hop traversal until a real consumer exists").

STATUS: Not started — M22 (Auth) complete and verified with a real browser-tested signup/login/
logout flow.

NEXT EXACT ACTION: Decide and record in DECISIONS.md: either (a) add a minimal `plan` field to
`User` (default "FREE") plus a small `hasEntitlement(user, feature)` helper that currently
always returns true for every existing feature (since nothing is paid-gated yet) — genuinely
minimal, forward-compatible groundwork, analogous to M19's placeholder User model — or (b) mark
this milestone explicitly deferred/low-value until a real paid feature exists to gate, and move
to M24 (Admin/Monitoring) instead. Leaning toward (a) since it's small and mirrors the M19
precedent, but confirm the reasoning holds before implementing rather than defaulting to
"add a field" out of momentum.
