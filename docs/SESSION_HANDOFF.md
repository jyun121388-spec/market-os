LAST COMPLETED
M09 (partial, FACT-only — matches the one real producer that exists): Claim Ledger
verification. Added `src/server/domain/claimVerification.ts`'s `verifyClaim(claimId)`, which
re-reads the evidenced Observation from the database and checks both that the claim text
actually contains the stored value and that `claim.sourceId` matches the observation's source
— not just that `evidence` is shaped correctly. Returns a typed status:
VERIFIED / EVIDENCE_MISSING / EVIDENCE_NOT_FOUND / VALUE_MISMATCH / UNSUPPORTED_CLAIM_TYPE.
Integration tests cover all five paths, including a claim attributed to the wrong source even
when the value text happens to match. 71/71 tests pass (34 unit + 37 integration against a real
local Postgres, verified stable across repeated runs). Full verify chain green.

CURRENT TASK
M10: What Changed (24h change detection) — see docs/CURRENT_TASK.md. First milestone that's a
real user-facing feature rather than pipeline groundwork: deterministic delta/%/bps calculation
over FRED/ECOS series, stored as a CALCULATION claim. Also extend claimVerification.ts to
handle CALCULATION claims in this same milestone rather than leaving another FACT-only gap.

CURRENT FAILURE
none

CHANGED FILES (since M08 commit)
src/server/domain/claimVerification.ts (new), tests/integration/claim-verification.test.ts
(new).

TEST STATUS
71/71 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M10: create src/server/domain/whatChanged.ts with computeSeriesChange(seriesId, opts) —
query the two most recent (non-superseded) Observations for a series, compute delta/percent/bps
deterministically, persist as a CALCULATION claim via createClaim. Extend claimVerification.ts
to verify CALCULATION claims in the same milestone.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Nine commits pushed so far (M00-M08) to
origin/claude/market-os-development-7vnicg; M09 is about to be committed and pushed. No PR
opened yet (none requested). The project consistently marks partial milestones as partial in
PROJECT_STATE.md/REVIEW_DEBT.md (M07 news source, M09 FACT-only verification) rather than
claiming full completion — keep that pattern for M10 and beyond: land what's real, tested, and
wired to an actual call path, and name what's deliberately deferred.
