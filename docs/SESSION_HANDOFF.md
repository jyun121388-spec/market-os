LAST COMPLETED
M20: Today / Morning Intelligence — the first milestone with real, verified UI. Added
`src/server/domain/morningBrief.ts`'s `buildMorningBrief()`, composing existing domain modules
(events, filings, series changes, macro regime, calendar) into one view. Deliberately
READ-ONLY: reuses `getRecentObservationPair`/`computeChange` directly rather than calling
`computeSeriesChange()` (which persists a new CALCULATION claim every call) — a page can be
loaded many times, and persisting a duplicate claim per page-view would be both semantically
wrong and a real scaling problem (see docs/DECISIONS.md). Built a real page
(`src/app/today/page.tsx`, Next.js Server Component, `dynamic = "force-dynamic"`). Verified via
an ACTUAL dev-server request (`npm run dev` + `curl localhost:3000/today`), not just unit
tests — confirmed real seeded data renders in every section (Unemployment Rate in What
Changed/Macro Regime, real TEST events, a real 삼성전자 DART filing, real calendar
projections). 122/122 tests pass (46 unit + 76 integration against a real local Postgres,
verified stable). Full verify chain green, including `next build` showing `/today` as a proper
dynamic route.

IMPORTANT: M21 (Ask Market) is BLOCKED_HUMAN_GATE, not started. Its INFERENCE layer needs a
live LLM API call at PRODUCT RUNTIME (answering real end-user questions) — a fundamentally
different cost category from this coding session's own Claude Code / Max 20x usage, which
authenticates this session, not a deployed backend. CLAUDE.md requires human approval for any
paid API/service activation; this was flagged rather than decided unilaterally (see the M21
entry in docs/DECISIONS.md for full reasoning and what's needed to unblock: provider/funding/
credential decision from the human). Per CLAUDE.md's "blocked on Human Gate → switch to next
independent task," this session moved to M22 instead of stopping.

CURRENT TASK
M22: Auth / User System — see docs/CURRENT_TASK.md. Builds real authentication on the minimal
User model from M19. Recommended approach (needs confirming before/while implementing):
from-scratch email+password (bcrypt/argon2 + Session model + httpOnly cookies), not a
third-party auth library, to keep the dependency/Human-Gate surface small.

CURRENT FAILURE
none

CHANGED FILES (since M19 commit)
src/server/domain/morningBrief.ts (new), src/app/today/page.tsx (new),
tests/integration/morning-brief.test.ts (new).

TEST STATUS
122/122 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB. `/today` page verified working via a real HTTP request to a
running dev server, not just tests.

NEXT EXACT ACTION
Start M22: record the auth-approach decision in DECISIONS.md (recommend from-scratch
email+password), add password hashing (bcrypt or argon2 — check what's easily available/
installable in this environment), a Session model, signup/login/logout server actions or route
handlers, and real pages. Use a random dev-only session-signing secret via .env.example
placeholder — never a hardcoded or committed real secret.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. vitest.config.mts has fileParallelism: false, and
every integration test file must scope cleanup to rows it owns — never a bare deleteMany() on a
shared table. Twenty commits pushed so far (M00-M19) to
origin/claude/market-os-development-7vnicg; M20 is about to be committed and pushed. No PR
opened yet (none requested). M21 is genuinely blocked pending a human cost decision — do not
attempt to route around this by using a free-tier key without asking, or by faking LLM output;
wait for explicit human direction on M21 specifically, and continue with M22+ (which have no
LLM dependency) in the meantime. `npm run dev` works in this environment and was used for real
verification this session — future UI milestones should do the same, not just rely on unit
tests, per CLAUDE.md's "for UI or frontend changes... test in a browser" instruction.
