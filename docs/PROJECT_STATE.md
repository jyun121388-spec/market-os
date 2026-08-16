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
confirmed present but NOT logged in (`npx @openai/codex login status` → "Not logged in"). This
is a remote/cloud environment limitation (no interactive OAuth possible unattended), not a
product defect, and was not worked around with an API key. **The defined final-review path**
(per explicit user instruction) is a LOCAL machine with `codex login` already completed, running
the exact procedure in `docs/CODEX_REVIEW_PACKET.md` §12-15 — base
`df56ace3ab27c2a7cb6bf52e95153d4a8dd06f7e`, head `9b34f8bb6be120dacd381fe22577870f40d6e5fa` (git
tree clean as of this update, no code changes this pass — docs/reviews-scaffolding only). Result
lands in `reviews/market-os-final-review.json` (schema in the packet). REVISE → fix loop and
APPROVE → status-update procedure are both fully specified there. This is the terminal state for
this session: no further code changes are needed or planned absent new input or a produced
review result.

TESTS
184 / 184 PASS (98 unit, 86 integration against a real Postgres instance) + npm run e2e (12/12
checks, real browser). CI green on PR #1's current head (9b34f8b before this doc-only commit).

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
The Codex review (the one non-Product gate still open) has a defined path now — run
docs/CODEX_REVIEW_PACKET.md §12 from a local machine with codex login already done, and drop the
result at reviews/market-os-final-review.json. When that file appears with a `verdict`, follow
§14 (REVISE) or §15 (APPROVE) as written. Not something to poll for in the meantime.
