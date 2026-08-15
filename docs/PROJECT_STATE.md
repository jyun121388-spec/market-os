CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08

CURRENT
M09

STATUS
READY

TESTS
65 / 65 PASS (34 unit, 31 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline (FRED/ECOS/DART/EDGAR/Event/Claim) not yet
Codex-reviewed; ECOS/DART/EDGAR field-level shapes unverified against live APIs (egress
blocked); no live news source wired (M07); `releaseDate` unset by adapters and no automatic
cross-source DataConflict detection yet (both M08, deliberately deferred — see DECISIONS.md).

NEXT
M09: Claim Ledger + verification pipeline. `src/server/domain/claimStore.ts` (M08) is the write
path; M09 builds the verification side — checking a claim's evidence actually supports its
text, surfacing INFERENCE claims without adequate confidence, and (per CLAUDE.md) making sure
nothing downstream can present an unsourced statement as FACT. Natural next consumer:
M10 (What Changed) will need to read verified claims, so M09 should design with that in mind
without building M10's feature itself.
