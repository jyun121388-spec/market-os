LAST COMPLETED
M17: ETF X-Ray, scoped to schema + legal-guardrail enforcement + exposure aggregation only, no
ingestion adapter (see docs/DECISIONS.md). Confirmed via WebFetch that both candidate free
holdings sources (ssga.com, ishares.com) are egress-blocked. Unlike M04-M06/M15's
government/regulatory APIs, ETF issuer holdings files aren't a stable, well-documented public
API shape — building an adapter against a guessed format was judged too fabrication-prone and
rejected. What shipped instead: `Etf`/`EtfHolding` Prisma models (migration
20260815173856_etf_xray) with NO score/rating/recommendation field anywhere, enforced by a
dedicated structural test (`tests/etfSchemaGuardrail.test.ts`) that greps the actual
schema.prisma source for forbidden patterns — a real regression test, not just a design
intention. `src/server/domain/etfExposure.ts`'s `computeSectorExposure`/`computeCountryExposure`
purely sum stored holding weights into buckets (deterministic, no LLM, no invented score) —
verified against real seeded data including an "Unclassified" bucket for a holding with no
recorded sector. 111/111 tests pass (46 unit + 65 integration against a real local Postgres,
verified stable). Full verify chain green.

CURRENT TASK
M18: Real Estate Intelligence (Korea) — see docs/CURRENT_TASK.md. Candidate sources (MOLIT,
data.go.kr) are already in the M02 seed registry but have never actually been probed for
reachability. Given every financial-data domain tested this session has been egress-blocked,
budget effort accordingly — probe once, then move to scoping down if blocked, rather than
repeated probing.

CURRENT FAILURE
none

CHANGED FILES (since M16 commit)
prisma/schema.prisma (+Etf, +EtfHolding models), prisma/migrations/20260815173856_etf_xray/,
src/server/domain/etfExposure.ts (new), tests/etfSchemaGuardrail.test.ts (new),
tests/integration/etf-exposure.test.ts (new).

TEST STATUS
111/111 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M18: WebFetch-probe MOLIT/data.go.kr for reachability once. If blocked (likely, given the
session's pattern so far), scope down to schema + a deterministic domain-logic module (e.g.
price-index change reusing seriesReadings.ts) tested against seeded fixture data — don't spend
excess effort re-probing already-established egress restrictions.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Seventeen commits pushed so far (M00-M16) to
origin/claude/market-os-development-7vnicg; M17 is about to be committed and pushed. No PR
opened yet (none requested). Confirmed egress-blocked so far: ecos.bok.or.kr,
opendart.fss.or.kr, data.sec.gov (submissions + XBRL), api.stlouisfed.org, ssga.com,
ishares.com — this dev container appears to block essentially all financial-data-provider
domains, which is a real, consistent environmental constraint rather than intermittent — factor
this into how much time is spent probing new domains for future milestones (M18 onward).
