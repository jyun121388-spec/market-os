# Current Task

MILESTONE: M24 — Admin / Monitoring

TASK: No admin surface exists yet. Real scoping decision: "monitoring" often implies external
paid services (error tracking, uptime, APM) — those are Human Gates per docs/DATA_POLICY.md
cost policy if paid. What's buildable now without any new service: an internal admin view of
data-pipeline health using data already in the DB — last successful ingest per Source
(`MAX(Observation.retrievedAt)` / `MAX(Filing.retrievedAt)` / etc.), counts, and any
`DataConflict` rows still unresolved. Gate the page to authenticated users (reuse M22's auth) —
for V1 with no role system, "any signed-in user" is an acceptable placeholder; do not build a
speculative admin-role system for a single-operator product without being asked.

STATUS: Not started — M23 (Subscription-ready architecture) complete and verified.

NEXT EXACT ACTION: Design `src/server/domain/systemHealth.ts` computing per-source health
(sourceCode, lastIngestAt across whichever tables that source writes to, unresolved
DataConflict count) purely by reading existing tables — no new ingestion, no new external
service. Build `/admin` page gated by `getCurrentUser()` (redirect to `/login` if not signed
in). Verify with the same discipline as M20/M22: real Playwright browser check against
`npm run dev`, not just unit tests.
