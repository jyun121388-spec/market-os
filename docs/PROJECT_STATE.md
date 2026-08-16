CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00-M28 (see docs/RELEASE_READINESS.md for the precise, honest per-subsystem status — this
section is intentionally brief; that document is now the source of truth for readiness).
Post-M28: timezone/staleness fixes, a security-review skill pass, and a pre-release audit that
shipped M21's deterministic Ask Market safe mode (`src/server/domain/askMarket.ts` + `/ask`).

CURRENT
RELEASE CANDIDATE — a real local-Codex review ran (per the path defined in the prior session) and
returned **REVISE** with 3 P0/HIGH blockers. All 3 were fixed directly by Claude on 2026-08-16
(Codex quota reserved, not spent on implementation), each with a dedicated real-Postgres
regression test, plus 3 recommended P1s. Status: **[CODEX RE-REVIEW READY]** — technical fix work
complete, self-declared APPROVE explicitly NOT claimed; three named Product/Human Gates remain
separately out of scope for further autonomous engineering (see NEXT below). Session-level
PR-status polling remains stopped per the 2026-08-16 instruction — only act on real inbound
GitHub webhook events or explicit user follow-up.

STATUS
First Codex review verdict: **REVISE** (3 P0 blockers — auth migration upgrade safety, claim
verification substring collision, concurrent observation ingestion race). All 3 fixed; see
docs/DECISIONS.md's "Fixed all 3 P0 blockers from the first real Codex REVISE verdict" entry for
exact BEFORE/AFTER/regression-test/changed-files per blocker, and docs/CODEX_REVIEW_PACKET.md §0
for the same information restructured for a re-reviewer. Fix-round HEAD:
`8f4f76ca74e01f1b9541a7f7295521f3eda08803` (parent: `9b34f8bb6be120dacd381fe22577870f40d6e5fa`,
the exact commit the first review ran against). **Next action is a Codex RE-REVIEW**, run from
the same local machine/`codex login` session as before, using
docs/CODEX_REVIEW_PACKET.md §12 (updated for this round) — scope to §0's fix-round diff first.
This session does not self-declare APPROVE; that requires an actual Codex re-review result in
`reviews/market-os-final-review.json`.

TESTS
209 / 209 PASS (up from 184 — 25 new regression tests added this fix round: 1 migration-upgrade,
1 legacy-signin, 9 H2 claim-verification adversarial, 3 H3 concurrency, 3 Ask Market bypass, 3
httpTimeout, 6 impossible-date) + npm run e2e (12/12 checks, real browser). Lint/typecheck/build
all clean at fix-round HEAD `8f4f76ca74e01f1b9541a7f7295521f3eda08803`.

OPEN P0
0 (3 were found by the first Codex review and fixed this pass — see STATUS above)

OPEN P1
0 (3 were recommended by the first Codex review and fixed anyway this pass — see STATUS above)

REVIEW DEBT
See docs/REVIEW_DEBT.md (27 entries — new H1/H2/H3 rows added this pass documenting the fix, all
still PENDING Codex re-review, not self-marked DONE). docs/RELEASE_READINESS.md is the canonical
per-subsystem classification (VERIFIED / VERIFIED_WITH_LIMITATION / LIVE_VERIFICATION_REQUIRED /
CODEX_REVIEW_PENDING / HUMAN_GATE / BLOCKED).

NEXT

1. **Codex re-review** (the one non-Product gate still open): run
   docs/CODEX_REVIEW_PACKET.md §12 from a local machine with codex login already done, scoped to
   §0's fix-round diff first, and drop the result at reviews/market-os-final-review.json. If
   `verdict: APPROVE`, follow §15 (status update to `RELEASE_CANDIDATE_CODEX_APPROVED`). If
   `verdict: REVISE` again, follow §14 (same fix-loop discipline as this round — Claude
   implements, does not delegate back to Codex, does not self-declare APPROVE).
2. Three named Product/Human Gates remain, unaffected by the above, not to be worked around with
   speculative engineering:
   (a) Full free-text LLM-based Ask Market — needs a funded LLM provider/credential decision.
   (b) Production deployment approval.
   (c) Payment/subscription activation.
