LAST COMPLETED
M23: Subscription-ready architecture, scoped to the genuinely buildable extension point (see
docs/DECISIONS.md): `User.plan` (`FREE | PRO` enum, default `FREE`, migration
20260816002025_subscription_plan — applied cleanly with `prisma migrate dev` this time, no
ambiguous-change prompt) and `src/server/domain/entitlements.ts`'s `hasEntitlement`/
`canUseFeature`. `FEATURE_PLAN_REQUIREMENTS` is deliberately empty — no feature is currently
paid-gated, which is an honest statement about the product today, not an oversight. No
Subscription/billing model, no payment processor, no checkout flow — actual payment activation
remains a Human Gate. 144/144 tests pass (58 unit + 86 integration against a real local
Postgres, verified stable). Full verify chain green.

CURRENT TASK
M24: Admin / Monitoring — see docs/CURRENT_TASK.md. Scoped to an internal pipeline-health view
(last ingest per source, unresolved DataConflict count) built from data already in the DB, no
new paid service. Gated to any authenticated user (no role system yet — that would be
speculative for a single-operator product).

CURRENT FAILURE
none

CHANGED FILES (since M22 commit)
prisma/schema.prisma (+Plan enum, +User.plan), prisma/migrations/
20260816002025_subscription_plan/, src/server/domain/entitlements.ts (new),
tests/entitlements.test.ts (new), tests/integration/auth.test.ts (added a plan-default
assertion).

TEST STATUS
144/144 pass with DATABASE_URL set, verified stable across repeated runs. Integration suite
skips gracefully without a DB.

NEXT EXACT ACTION
Start M24: build src/server/domain/systemHealth.ts (per-source last-ingest timestamps +
unresolved DataConflict count, pure reads), then a real /admin page gated by getCurrentUser().
Verify with an actual Playwright browser session against npm run dev, same as M20/M22 — not
just unit tests.

IMPORTANT CONTEXT
Local Postgres 16 must be started manually each session: `service postgresql start`. Dev
role/db: market_os/market_os_dev, DATABASE_URL in .env (gitignored). Remember `npx prisma
generate` after every schema.prisma change. For schema changes that add a unique constraint (or
anything else ambiguous), `prisma migrate dev` fails non-interactively — use `prisma migrate
diff --from-config-datasource --to-schema prisma/schema.prisma --script` to get the SQL, then
hand-write it into `prisma/migrations/<timestamp>_<name>/migration.sql` and apply with `prisma
migrate deploy` (this session's M22 hit this; M23's simple additive column did not).
vitest.config.mts has fileParallelism: false, and every integration test file must scope
cleanup to rows it owns. `playwright` is now a devDependency — use it (not curl) to verify any
Server Action / interactive flow in a real browser, launching with `executablePath:
'/opt/pw-browsers/chromium'`. Twenty-two commits pushed so far (M00-M22) to
origin/claude/market-os-development-7vnicg; M23 is about to be committed and pushed. No PR
opened yet (none requested). M21 remains BLOCKED_HUMAN_GATE — do not attempt to unblock it
without explicit human direction on LLM provider/funding/credentials.
