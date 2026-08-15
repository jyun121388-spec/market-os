LAST COMPLETED
M07 (partial, as scoped for this dev environment): Event Intelligence groundwork. Added Event
+ EventMention Prisma models (migration 20260815162331_events) and deterministic keyword-based
clustering (src/server/domain/eventClustering.ts: Jaccard similarity over a stopword-filtered
keyword set + time window — explicitly NOT an LLM call, see docs/DECISIONS.md) plus the ingest
orchestration (src/server/domain/eventIngest.ts: dedupe by exact URL, cluster into an existing
open event or create a new one, track mentionCount/distinctTierCount). 61/61 tests pass (32
unit + 29 integration against a real local Postgres, verified stable across repeated runs).
Full verify chain green.

No live news/metadata source is wired yet in this environment — that's future work (a news
adapter analogous to M03-M06, once a suitable free source is identified and its reachability
confirmed, since ecos.bok.or.kr/opendart.fss.or.kr/data.sec.gov were all egress-blocked here).
Logged clearly as scope-limited in PROJECT_STATE.md rather than claiming M07 fully done.

CURRENT TASK
M08: Data normalization + provenance hardening — see docs/CURRENT_TASK.md. Key gap identified:
`assertValidClaim` (Claim Ledger invariant enforcement) has no real caller outside its own unit
test yet — nothing in the app actually creates a Claim row through it. This is exactly the kind
of "mechanism exists but isn't wired to a path" the completion standard warns about.

CURRENT FAILURE
none

CHANGED FILES (since M06 commit)
prisma/schema.prisma (+Event, +EventMention models), prisma/migrations/
20260815162331_events/, src/server/domain/eventClustering.ts (new),
src/server/domain/eventIngest.ts (new), tests/domain/eventClustering.test.ts (new),
tests/integration/event-ingest.test.ts (new).

TEST STATUS
61/61 pass with DATABASE_URL set, verified stable across 3 repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M08 by closing the Claim Ledger wiring gap: add a real caller of `assertValidClaim` (a
helper that creates a `Claim` DB row from e.g. an Observation, enforcing invariants at the
write boundary), then audit FRED/ECOS/DART/EDGAR adapters against the DATA_POLICY.md financial
checklist for any gaps (most items are already covered — timezone/UTC parsing, revision
tracking, missing-value handling, idempotency — but this hasn't been done as a dedicated pass).

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns (own source codes / url or topic
prefixes) — never a bare deleteMany() on a shared table (see docs/DECISIONS.md, this bit the
project once already in M06). Seven commits pushed so far (M00-M06) to
origin/claude/market-os-development-7vnicg; M07 is about to be committed and pushed. No PR
opened yet (none requested). All milestones from M00-M07 have real, passing tests against a
real Postgres instance — nothing has been declared done on the strength of code existing alone.
