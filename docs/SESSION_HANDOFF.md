LAST COMPLETED
M16: Filing Diff, numeric half only (text half explicitly blocked — see below).
`src/server/domain/filingDiff.ts`'s `computeFinancialFactDiff`/`computeFilingDiff` compute
deterministic deltas between the two most recent `FinancialFact` rows for a concept, reusing
the M10/M11 change-calculation pattern. Verified end-to-end with a real invocation script
(`npm run filing-diff:print -- <cik>`) against real data left by M15's own restatement test —
output correctly showed the real Revenues change (400B→405B, +1.25%) and INSUFFICIENT_DATA for
every other concept (only Revenues has 2 accession numbers in the dev DB). New/removed risk
factors and management-language-change detection (the text-diff half of the spec) were NOT
built: no adapter in this project (DART/EDGAR filings/EDGAR XBRL) has ever fetched filing
document text, only metadata or structured facts — attempting a text diff without real text
would mean fabricating one. Logged as blocked-on-a-prerequisite in REVIEW_DEBT.md, not
forgotten. 106/106 tests pass (43 unit + 63 integration against a real local Postgres, verified
stable). Full verify chain green.

CURRENT TASK
M17: ETF X-Ray — see docs/CURRENT_TASK.md. Real scoping question before any code: ETF
holdings/exposure data is a genuinely different category from anything built so far (issuer
sites or paid vendors, not government/regulatory APIs like FRED/ECOS/DART/EDGAR). Need to check
reachability of a candidate free source before designing schema. Hard constraint to keep in
mind throughout: NO buy-fitness-score or recommendation output (docs/LEGAL_GUARDRAILS.md).

CURRENT FAILURE
none

CHANGED FILES (since M15 commit)
src/server/domain/filingDiff.ts (new), scripts/print-filing-diff.ts (new), package.json
(filing-diff:print script), tests/integration/filing-diff.test.ts (new).

TEST STATUS
106/106 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M17: WebFetch-probe a candidate free ETF holdings source (e.g. an issuer's public
holdings CSV/API — check SPDR/iShares/Vanguard public data pages) for reachability before
designing schema. If nothing free and reachable exists, scope down explicitly (schema +
legal-guardrail tests only, no real ingestion) or mark BLOCKED in REVIEW_DEBT.md, same
discipline as M12.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Sixteen commits pushed so far (M00-M15) to
origin/claude/market-os-development-7vnicg; M16 is about to be committed and pushed. No PR
opened yet (none requested). Confirmed egress-blocked domains so far: ecos.bok.or.kr,
opendart.fss.or.kr, data.sec.gov (submissions + XBRL companyfacts), api.stlouisfed.org — a new
domain for M17 (an ETF issuer site) has NOT been probed yet, don't assume it's blocked or
reachable without checking directly.
