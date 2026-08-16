# Current Task

MILESTONE: M25 — Performance / Cache / Background Jobs

TASK: No caching layer or scheduled-job runner exists yet — every domain read computes on
demand and every ingestion adapter runs manually via `npm run ingest:*`. Real scoping decision:
a production-grade unattended scheduler (Vercel Cron, a queue worker, etc.) implies deploying
something, and any production deployment is a Human Gate per CLAUDE.md until a human approves
it. What's genuinely buildable now without deploying anything: (a) a dev/CI-invocable job
runner script that sequences the existing `ingest:*` commands with structured logging (a real,
testable increment toward "scheduled jobs" that doesn't require any new infrastructure), and
(b) an in-process cache with a short TTL for the more expensive on-demand reads (e.g.
`computeSystemHealth`, `computeRegimeSnapshot`) with tests proving cache hit/miss/expiry
behavior and that cached data never silently goes stale past its TTL without being labeled.
Real cron/queue infrastructure stays deferred pending the production-deployment Human Gate —
log it in docs/REVIEW_DEBT.md, don't silently skip the milestone.

STATUS: Not started — M24 (Admin / Monitoring) complete and verified.

NEXT EXACT ACTION: Design a small `src/server/domain/cache.ts` (or similar) — a generic
TTL-based in-memory cache helper with unit tests (hit, miss, expiry). Apply it to one real
expensive read path (`computeSystemHealth` is a reasonable first target since M24 just built
it). Then write `scripts/run-ingest-jobs.ts` (or an npm script) that sequences the existing
`ingest:*` commands in order with per-job success/failure logging, runnable via
`npm run jobs:ingest-all`. Verify both with real tests + an actual invocation (not just unit
tests) — same discipline as every prior milestone.
