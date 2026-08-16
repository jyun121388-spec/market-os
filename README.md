# market-os

AI Economic & Market Intelligence Platform

Not a trading/advisory product — see `docs/LEGAL_GUARDRAILS.md`. Full governance and roadmap
live in `docs/`; start with `CLAUDE.md` and `docs/PROJECT_STATE.md`.

## Stack

Next.js (TypeScript, App Router) + Prisma/PostgreSQL, modular monolith. See
`docs/ARCHITECTURE.md`.

## Getting started

```bash
npm install
cp .env.example .env        # DATABASE_URL is required; API keys are optional (see below)
npx prisma generate
npx prisma migrate deploy   # applies every migration to the database in DATABASE_URL
npm run dev
```

You need a reachable PostgreSQL 16. Anything works — a system install, a container, or a
portable extract. `docs/SESSION_HANDOFF.md` documents the portable no-admin setup currently used
on the primary dev machine.

Re-run `npx prisma generate` after any `prisma/schema.prisma` change, and **restart
`npm run dev`** afterwards — a running dev server holds the previously generated client, so a
page touching a new model fails at runtime while the code, tests and build are all clean.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` / `npm run typecheck` / `npm run format` / `npm run format:check`
- `npm run test` — unit + integration tests (Vitest)
- `npm run verify` — the full pre-commit gate (format check, lint, typecheck, test, build)
- `npm run e2e` — real-browser walkthrough of the signed-in user path. Needs `npm run dev`
  already running in another shell, plus Playwright's Chromium
  (`npx playwright install chromium`).
- `npm run verify:live:<edgar|fred|ecos|dart>` — checks an adapter's assumptions against the
  provider's real API. Read-only; writes nothing to the database.
- `npm run jobs:ingest-all` — runs every `ingest:*` script in sequence.

### Tests and `DATABASE_URL`

Integration tests skip themselves when `DATABASE_URL` is unset, so a run without a database
reports green while testing almost nothing. `tests/integration-coverage-guard.test.ts` turns
that into a hard failure in CI; locally it prints a warning. Bare `vitest` does not read `.env`,
so export `DATABASE_URL` in the shell first.

## Data sources

SEC EDGAR needs no API key — only a descriptive `EDGAR_USER_AGENT` of the form
`"<name> <contact email>"`. SEC returns 403 for anything that does not look like one.

FRED, ECOS and OpenDART each need a free API key you register for yourself; the adapters refuse
to run without one rather than substituting anything. See `docs/HUMAN_GATE_QUEUE.md`.

**An adapter is never considered live-verified because its verification script exists.** The bar
is in `docs/RELEASE_READINESS.md`, and it exists because the first provider actually checked
against its real API turned out to disagree with its own documentation — twice.

## Database

Schema lives in `prisma/schema.prisma`. Use `npx prisma migrate deploy` to apply existing
migrations. `prisma migrate dev` can generate a new one during development, but it fails
non-interactively for ambiguous changes — in that case use
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
and hand-write the migration.

No migration is run against a shared/production database without explicit human approval.
