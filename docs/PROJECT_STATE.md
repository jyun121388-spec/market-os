CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22, M23, M24, M25 (partial), M26 (partial), M27 (partial), M28 (honest status: BLOCKED,
not a forced completion — see below)

CURRENT
M28 — BLOCKED_HUMAN_GATE (2 named blockers; every other criterion closed)

STATUS
BLOCKED_HUMAN_GATE — the whole roadmap through M28 has been worked as far as this session can
take it without a human decision or a Codex session. This is a genuine stopping point, not a
paused task waiting on nothing in particular.

TESTS
157 / 157 PASS (71 unit, 86 integration against a real Postgres instance) + npm run e2e (12/12
checks, real browser)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (24 entries). Two entries are the actual release blockers:
- M21 Ask Market: BLOCKED_HUMAN_GATE — needs a human decision on LLM provider/funding/
  credentials (a real production runtime cost, not covered by this session's own Max 20x usage).
- Codex critical security review: PENDING — no Codex session has been available in this
  environment at any point this entire session, despite being flagged as required since M22.
Everything else in REVIEW_DEBT.md is either a data-source reachability limitation (this dev
sandbox blocks essentially every financial-data-provider domain — documented per-milestone) or a
deliberately deferred scope decision, all logged with reasoning in DECISIONS.md, none silently
skipped.

NEXT
This session cannot progress the roadmap further without one of:
(a) A human decision on M21 Ask Market's LLM provider/funding/credentials — see the M21 and M28
    DECISIONS.md entries for exactly what's needed.
(b) A Codex session becoming available, to run the security-critical review owed since M22 (M26
    already applied a self-review in the meantime — see DECISIONS.md — but that is not a
    substitute).
(c) Real API keys/reachable network for any of the REVIEW_DEBT items marked PENDING on data
    sources (FRED/ECOS/DART/EDGAR/etc.) — would let several "schema + algorithm only" milestones
    (M07, M12, M14, M17, M18) gain real ingestion.
(d) Explicit human approval of production deployment — would unblock M25's real scheduler wiring
    and let M27's E2E coverage extend to a real deployed environment.
Absent any of these, do not force a "complete" status — see the M28 DECISIONS.md entry for why.
If new instructions or new environment capabilities arrive in a future session, re-read this
file, docs/REVIEW_DEBT.md, and docs/RELEASE_CHECKLIST.md before resuming.
