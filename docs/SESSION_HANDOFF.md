LAST COMPLETED
M08: Data normalization + provenance hardening. Added `src/server/domain/claimStore.ts`
(`createClaim` backed by `assertValidClaim`; `createFactClaimFromObservation`) as the first
real write path for `Claim` rows — previously `assertValidClaim` (M01) had no caller anywhere
outside its own unit test, a genuine instance of the Completion Standard's "validation exists →
verify the production path invokes it" warning. Integration tests prove an unsourced FACT claim
is rejected before it reaches the database, and that `createFactClaimFromObservation` builds a
correctly sourced/evidenced claim from a real Observation row. Also did a lightweight audit of
FRED/ECOS/DART/EDGAR against docs/DATA_POLICY.md's financial-data checklist: timezone/UTC
parsing, revision tracking, and missing-value handling are all solid; two real gaps were found
and logged (not silently ignored) in docs/REVIEW_DEBT.md — `releaseDate` is never populated by
any adapter, and there's no automatic cross-source DataConflict detection yet (both deferred
with reasons, not oversights). 65/65 tests pass (34 unit + 31 integration against a real local
Postgres). Full verify chain green.

CURRENT TASK
M09: Claim Ledger + verification pipeline — see docs/CURRENT_TASK.md. Build a `verifyClaim`
function that checks a FACT claim's evidence actually references a real, matching Observation
row, rather than trusting `evidence` blindly.

CURRENT FAILURE
none

CHANGED FILES (since M07 commit)
src/server/domain/claimStore.ts (new), tests/integration/claim-store.test.ts (new).

TEST STATUS
65/65 pass with DATABASE_URL set. Integration suite skips gracefully without a DB.

NEXT EXACT ACTION
Start M09: create src/server/domain/claimVerification.ts with `verifyClaim(claimId)` — for now,
scoped to the FACT-from-Observation shape that createFactClaimFromObservation produces (look up
evidence.observationId, confirm it exists, confirm the claim text's stated value matches the
stored Decimal value). Extend to CALCULATION/INFERENCE once M11/M21 give those real producers —
don't build speculative support ahead of a real caller (see M08's DECISIONS.md entry for why
that pattern matters here).

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns (own source codes / url or topic
prefixes) — never a bare deleteMany() on a shared table. Eight commits pushed so far (M00-M07)
to origin/claude/market-os-development-7vnicg; M08 is about to be committed and pushed. No PR
opened yet (none requested). Milestones M00-M08 all have real, passing tests against a real
Postgres instance; two known scope gaps are tracked in REVIEW_DEBT.md rather than silently
presumed complete (M07's missing live news source, M08's releaseDate/DataConflict-detection
gaps).
