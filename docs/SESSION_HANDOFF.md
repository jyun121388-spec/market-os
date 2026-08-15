LAST COMPLETED
M15: Company X-Ray, scoped to structured XBRL financial facts for EDGAR only (see
docs/DECISIONS.md). Confirmed via WebFetch that data.sec.gov's XBRL companyfacts endpoint is
also egress-blocked (same as its submissions endpoint used in M06). Rather than block the
milestone or attempt to parse raw filing HTML/PDF (risking fabricated structured data from
unstructured text — explicitly rejected), added a new `FinancialFact` model (migration
20260815173054_financial_facts) and `src/server/adapters/edgar-xbrl/` (client → normalize →
ingest) covering 6 core concepts (Revenues, NetIncomeLoss, OperatingIncomeLoss, Assets,
Liabilities, CashAndCashEquivalentsAtCarryingValue), built against SEC's documented XBRL shape.
Untracked concepts are extracted-not (not an error, deliberately narrow starter set). A
restated value (new accession number for the same concept/period) is correctly preserved as a
new row rather than overwritten — verified by a dedicated test. Real invocation path
`npm run ingest:edgar-xbrl`, verified to fail safely without EDGAR_USER_AGENT. 102/102 tests
pass (43 unit + 59 integration against a real local Postgres, verified stable). Full verify
chain green. Explicitly out of scope: filing *text* (risk factors, management-language
changes) — no adapter has ever fetched filing document bodies, only metadata/structured facts.

CURRENT TASK
M16: Filing Diff — see docs/CURRENT_TASK.md. Two halves with very different feasibility right
now: numeric deltas (buildable today on M15's FinancialFact data, which already has verified
restatement/multi-accession history) vs. text diffs (needs a new filing-text-fetching
capability nothing built so far has). Build the numeric half; explicitly scope/block the text
half rather than attempting it without real filing text.

CURRENT FAILURE
none

CHANGED FILES (since M14 commit)
prisma/schema.prisma (+FinancialFact model), prisma/migrations/20260815173054_financial_facts/,
src/server/adapters/edgar-xbrl/* (new), scripts/ingest-edgar-xbrl.ts (new), package.json
(ingest:edgar-xbrl script), tests/adapters/edgar-xbrl-normalize.test.ts (new),
tests/integration/edgar-xbrl-ingest.test.ts (new).

TEST STATUS
102/102 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M16: build src/server/domain/filingDiff.ts's computeFinancialFactDiff(sourceId, corpCode,
concept, unit) reusing the deterministic-change pattern already established
(seriesReadings.ts/whatChanged.ts). Test it against M15's FinancialFact data (the restatement
test fixture already proves multi-accession history works). Explicitly document text-diff
(risk factors/management language) as BLOCKED pending a new filing-text adapter — don't
attempt it without real text.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change (forgot this once again in M15's own session before
catching it via a typecheck failure — this keeps happening, be deliberate about it every
migration). vitest.config.mts has fileParallelism: false, and every integration test file must
scope cleanup to rows it owns — never a bare deleteMany() on a shared table. Fifteen commits
pushed so far (M00-M14) to origin/claude/market-os-development-7vnicg; M15 is about to be
committed and pushed. No PR opened yet (none requested). Confirmed egress-blocked domains in
this container so far: ecos.bok.or.kr, opendart.fss.or.kr, data.sec.gov (both submissions and
XBRL companyfacts endpoints), api.stlouisfed.org — assume any new external financial-data
domain needs the same reachability check before designing against it.
