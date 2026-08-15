# Current Task

MILESTONE: M22 — Auth / User System (M21 skipped: BLOCKED_HUMAN_GATE, see PROJECT_STATE.md /
DECISIONS.md — Ask Market needs a live product-runtime LLM call, a cost decision for the human
to make, not this session to decide unilaterally)

TASK: Real authentication on top of the minimal `User` model already added in M19 (id +
createdAt only). Per docs/ROADMAP.md this is scoped as "Auth / User System" — needs at minimum:
credential storage (password hashing — never plaintext, never a weak/custom hash), session
handling, and the actual login/signup flow wired to real pages (continuing M20's precedent of
shipping real UI, not just backend logic). Real secrets (session signing key, etc.) are a Human
Gate per CLAUDE.md — use `.env.example` placeholders and generate a random dev-only value
locally, never hardcode or commit a real production secret.

STATUS: Not started — M20 (Today / Morning Intelligence) complete and verified with a real
rendered page.

NEXT EXACT ACTION: Decide the auth approach before coding: a from-scratch email+password flow
(bcrypt/argon2 hashing, a Session model, httpOnly cookies) is the most control-preserving and
dependency-light option consistent with this project's "prefer deterministic, self-owned code"
pattern so far, versus pulling in a library like next-auth/Auth.js (more features, more
dependency surface, some auth providers involve external services that could themselves be
Human Gates — e.g. OAuth with a third party). Recommend: from-scratch email+password for V1
(smallest surface, no external dependency, easiest to reason about for a security review later
in M26) — record this choice and reasoning in DECISIONS.md before implementing.
