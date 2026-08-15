LAST COMPLETED
M14: Historical Analog Engine (single-series scope — see docs/DECISIONS.md). Added
`src/server/domain/historicalAnalog.ts`'s `computeHistoricalAnalog(seriesId, options)`: compares
a series' current trailing change over `windowSize` observations against every historical point
using z-score-normalized distance (deterministic, no LLM), returns the topK most similar
historical periods with their actual subsequent changes N/3N/6N observations later. Results are
labeled "observations ahead," not literal calendar months, since several tracked series are
daily (mislabeling a daily series' next-3-observations as "3 months" would be a factually wrong
claim). Every result carries a required, non-optional `limitations` disclaimer and `sampleSize`
— mirrors M13's `CausalEdge.counterexamples` pattern of enforcing epistemic honesty structurally.
Test dataset was hand-designed with an exact expected answer (10 points, specific values chosen
so the 3 nearest historical trailing changes are unambiguous) — all hand-computed expected
values (similarity ranking, subsequent changes, one deliberate out-of-range null) matched
exactly on the first test run. Verified end-to-end with a real invocation script
(`npm run analog:print -- <seriesId> <windowSize>`) against real data left by the test suite —
output matched the hand-computed math exactly. 94/94 tests pass (39 unit + 55 integration
against a real local Postgres, verified stable). Full verify chain green.

CURRENT TASK
M15: Company X-Ray — see docs/CURRENT_TASK.md. Real scoping question before any code: M05/M06
only stored Filing *metadata*, not structured financial figures. Need to check whether EDGAR's
XBRL company-facts API (data.sec.gov/api/xbrl/companyfacts/...) is reachable — would provide
structured data without parsing raw filing HTML/PDF, which is a much larger and riskier
undertaking (risk of fabricating structured data from unstructured text).

CURRENT FAILURE
none

CHANGED FILES (since M13 commit)
src/server/domain/historicalAnalog.ts (new), scripts/print-analog.ts (new), package.json
(analog:print script), tests/integration/historical-analog.test.ts (new).

TEST STATUS
94/94 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite skips
gracefully without a DB.

NEXT EXACT ACTION
Start M15: WebFetch-probe data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json (Apple, same CIK
already used in M06's fixtures) to check reachability before designing anything. If blocked
(consistent with api.stlouisfed.org/ecos.bok.or.kr/opendart.fss.or.kr all being blocked in this
container), explicitly scope M15 down or log it BLOCKED in REVIEW_DEBT.md with a clear
unblocking condition (a real environment where data.sec.gov is reachable), rather than
attempting HTML/PDF parsing of raw filings.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Fourteen commits pushed so far (M00-M13) to
origin/claude/market-os-development-7vnicg; M14 is about to be committed and pushed. No PR
opened yet (none requested). This session confirmed egress-blocked: ecos.bok.or.kr,
opendart.fss.or.kr, data.sec.gov (submissions endpoint), api.stlouisfed.org. data.sec.gov's XBRL
endpoint specifically has NOT been probed yet — don't assume it's blocked just because
data.sec.gov's other endpoint was; test it directly for M15, since a different path on the same
host is sometimes handled differently by egress proxies (though often not — verify, don't
assume either way).
