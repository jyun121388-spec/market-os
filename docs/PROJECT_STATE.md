CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial — see
REVIEW_DEBT: FACT-only)

CURRENT
M10

STATUS
READY

TESTS
71 / 71 PASS (34 unit, 37 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline (FRED/ECOS/DART/EDGAR/Event/Claim/
Verification) not yet Codex-reviewed; ECOS/DART/EDGAR field-level shapes unverified against
live APIs (egress blocked); no live news source wired (M07); releaseDate/cross-source-conflict
gaps (M08); verifyClaim only supports FACT claims with an observationId (M09, matches the one
real producer that exists — see DECISIONS.md).

NEXT
M10: What Changed — 24h change detection across tracked macro/market variables. First
milestone that's a real *feature* consuming the FRED/ECOS pipeline + Claim Ledger end-to-end
(deterministic % / bps change calculation → CALCULATION claim via claimStore.ts → verifiable via
claimVerification.ts once that's extended to CALCULATION). Natural forcing function to notice
any remaining gaps in the pipeline built in M02-M09.
