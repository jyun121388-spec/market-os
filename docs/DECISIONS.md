# Decisions Log

Append-only. Each entry: date, decision, reason, alternatives considered.

## 2026-08-15 — Modular monolith over microservices for V1

**Decision**: Single Next.js + TypeScript app (frontend + backend API routes), one Postgres DB.
**Reason**: Team is one AI developer + one human; microservices add operational overhead with
no scaling benefit yet. Matches master-prompt architecture principles (§13).
**Alternatives**: Separate API service from day one — rejected as premature.

## 2026-08-15 — Prisma as ORM

**Decision**: Use Prisma over raw SQL or a query builder for schema + migrations.
**Reason**: Strong TypeScript type generation reduces financial-data type errors; migration
tooling is mature; fits "stability, testability, simplicity" priority order.
**Alternatives**: Drizzle (lighter, considered acceptable alternative — revisit if Prisma proves
too heavy for AI-context-efficiency in later milestones).

## 2026-08-15 — npm as package manager

**Decision**: Use npm, not pnpm/yarn.
**Reason**: Environment has npm pre-verified available; avoids introducing an unverified
toolchain dependency.

## 2026-08-15 — Roadmap order follows master-prompt default (M00-M28)

**Decision**: Keep the default milestone order from the master prompt unless a concrete
dependency issue forces reordering.
**Reason**: No conflicting technical constraint identified yet during M00.

## 2026-08-15 — Prisma 7 driver-adapter pattern (no `url` in schema.prisma)

**Decision**: Connection string lives only in `prisma.config.ts` (CLI/migrations) and is passed
explicitly via `@prisma/adapter-pg` in `src/server/db/client.ts` (runtime). `datasource.url` is
not set in `prisma/schema.prisma`.
**Reason**: Prisma 7 removed support for `datasource.url` in the schema file; this is the
supported replacement, not a workaround. See https://pris.ly/d/config-datasource.
**Alternatives**: None — this is required by the installed Prisma version.

## 2026-08-15 — M01 DB schema initial scope

**Decision**: M01 ships a schema skeleton (Source, Series, Observation, DataConflict, Claim)
sufficient to validate the hallucination-resistant pipeline end-to-end with a real Postgres
instance, deferring the full source registry / seed data and additional domain tables (events,
causal graph edges, filings, etc.) to their respective milestones (M02, M07, M13, M15-M17).
**Reason**: Keeps M01 scoped to "core architecture + database" as roadmapped; avoids building
schema for features not yet designed in detail.
