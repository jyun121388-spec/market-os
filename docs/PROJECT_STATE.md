CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial), M19,
M20, M22, M23, M24

CURRENT
M25

STATUS
READY

TESTS
147 / 147 PASS (61 unit, 86 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (20 entries, unchanged by M24 — no new gaps). M21 remains
BLOCKED_HUMAN_GATE pending a human decision on product-runtime LLM provider/funding/
credentials.

NEXT
M25: Performance / Cache / Background Jobs. No caching layer or scheduled-job runner exists yet
— every domain read (Morning Brief, Admin health, Macro Regime, etc.) computes on-demand at
request time, and every ingestion adapter is invoked manually via `npm run ingest:*`. Real
scoping question: a full job scheduler (cron-like) that runs unattended in production is
deployment infrastructure — deploying anything is itself a Human Gate per CLAUDE.md until a
human approves production deployment. What's genuinely buildable now without deploying
anything: (a) an in-process/dev-invocable scheduled-ingestion runner (a script that sequences
the existing `ingest:*` commands, with logging), and (b) a caching layer for expensive
read paths (e.g. memoizing `computeSystemHealth`/`computeRegimeSnapshot` within a short TTL)
that's real code, testable today, and deployment-agnostic. Actual production cron/queue
infrastructure (Vercel Cron, a queue service, etc.) stays deferred pending the production-
deployment Human Gate. Check docs/ARCHITECTURE.md for any existing job-runner design notes
before scoping further.
