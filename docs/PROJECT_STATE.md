CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00-M28 (see docs/RELEASE_READINESS.md for the precise, honest per-subsystem status — this
section is intentionally brief; that document is now the source of truth for readiness).
Post-M28: timezone/staleness fixes, a security-review skill pass, and a pre-release audit that
shipped M21's deterministic Ask Market safe mode (`src/server/domain/askMarket.ts` + `/ask`).

CURRENT
Pre-Release Audit complete. Status: `RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES` (see
docs/RELEASE_READINESS.md for the full verdict and evidence).

STATUS
BLOCKED_HUMAN_GATE / CODEX_REVIEW_PENDING — every task buildable, fixable, or auditable without
external input is done. Two things remain, both requiring something this session cannot supply:
a Codex session (packet ready at docs/CODEX_REVIEW_PACKET.md), and human decisions on named
Human Gates (M21's full LLM-based Ask Market, production deployment, payment activation).

TESTS
184 / 184 PASS (98 unit, 86 integration against a real Postgres instance) + npm run e2e (12/12
checks, real browser). CI green on PR #1's current head.

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (24 entries — 4 marked DONE this session with what was found/fixed,
including M21's safe-mode scope). docs/RELEASE_READINESS.md is now the canonical per-subsystem
classification (VERIFIED / VERIFIED_WITH_LIMITATION / LIVE_VERIFICATION_REQUIRED /
CODEX_REVIEW_PENDING / HUMAN_GATE / BLOCKED) — read it before assuming anything is "done."

NEXT
Nothing further is available to build autonomously without one of:
(a) A Codex session becoming available — docs/CODEX_REVIEW_PACKET.md is ready to hand off
immediately, no re-derivation needed.
(b) A human decision on M21's full free-text Ask Market (LLM provider/funding/credentials) — see
docs/DECISIONS.md's two M21 entries for the precise boundary between what's done (topic
search + guardrail) and what's blocked (arbitrary natural language).
(c) Real API keys/reachable network for any `LIVE_VERIFICATION_REQUIRED` row in
docs/RELEASE_READINESS.md.
(d) Production-deployment approval (unblocks the real job scheduler and live E2E against a
deployed environment).
Do not force a "complete" status in the absence of these — see docs/RELEASE_READINESS.md's
verdict section for why `RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES` is the accurate terminal
state, not a failure to reach `RELEASE_CANDIDATE_READY`.
