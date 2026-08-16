CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00-M28 (see docs/RELEASE_READINESS.md for the precise, honest per-subsystem status — this
section is intentionally brief; that document is now the source of truth for readiness).
Post-M28: timezone/staleness fixes, a security-review skill pass, and a pre-release audit that
shipped M21's deterministic Ask Market safe mode (`src/server/domain/askMarket.ts` + `/ask`).

CURRENT
RELEASE CANDIDATE — finalized. Status: `RELEASE_CANDIDATE_READY` (technical work complete; three
named Product/Human Gates remain and are out of scope for further autonomous engineering — see
below). Session-level PR-status polling has been stopped per explicit user instruction
(2026-08-16) — do not re-arm periodic PR check-ins; only act on real inbound GitHub webhook
events from here on.

STATUS
`codex-cli` (0.147.0, via `npx @openai/codex`) was checked in this environment on 2026-08-16 and
confirmed present but NOT logged in (`npx @openai/codex login status` → "Not logged in"). No
ChatGPT session exists here, and per absolute cost rules no OpenAI API key was configured or
used to work around that. Codex review therefore remains genuinely unavailable in this
environment — `docs/CODEX_REVIEW_PACKET.md` stays ready for whenever a logged-in Codex session
(or any independent reviewer) becomes available. This is the terminal state for this session:
no further code changes are needed or planned absent new input.

TESTS
184 / 184 PASS (98 unit, 86 integration against a real Postgres instance) + npm run e2e (12/12
checks, real browser). CI green on PR #1's current head (e00a390).

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (24 entries — 4 marked DONE this session with what was found/fixed,
including M21's safe-mode scope). docs/RELEASE_READINESS.md is the canonical per-subsystem
classification (VERIFIED / VERIFIED_WITH_LIMITATION / LIVE_VERIFICATION_REQUIRED /
CODEX_REVIEW_PENDING / HUMAN_GATE / BLOCKED).

NEXT
Nothing further is available to build autonomously. Three named gates remain, all explicitly
Product/Human Gates per user instruction (2026-08-16) — not to be worked around with speculative
engineering, and not a reason to keep polling PR #1:
(a) Full free-text LLM-based Ask Market — needs a funded LLM provider/credential decision.
(b) Production deployment approval.
(c) Payment/subscription activation.
A Codex session becoming available (real ChatGPT login, not an API key) would let the review in
docs/CODEX_REVIEW_PACKET.md run immediately — that is the one non-Product gate still open, and is
also not something to poll for; act on it when the user brings it up or a session becomes
available through normal means.
