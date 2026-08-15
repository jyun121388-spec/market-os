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
cp .env.example .env   # fill in DATABASE_URL for local Postgres
npx prisma generate
npm run dev
```

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` / `npm run typecheck` / `npm run format` / `npm run format:check`
- `npm run test` — unit/integration tests (Vitest)
- `npm run verify` — the full pre-commit gate (format check, lint, typecheck, test, build)

## Database

Schema lives in `prisma/schema.prisma`. Apply migrations locally with:

```bash
npx prisma migrate dev
```

No migration is run against a shared/production database without explicit human approval.
