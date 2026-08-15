# Market OS — Architecture (V1)

## Style
**Modular monolith.** No microservices in V1 — unnecessary operational cost for the current
scale and team (one AI developer + human owner). Split out services later only if a concrete
scaling/deploy need forces it, and record that decision in `DECISIONS.md`.

## Stack
- **Frontend**: TypeScript, Next.js (App Router, latest stable), React, Tailwind CSS.
  Mobile-first responsive, PWA-friendly later.
- **Backend**: TypeScript, served from the same Next.js app initially (API routes / route
  handlers) behind a clear internal API boundary (`src/server/*`), so it can be split into a
  separate service later without a rewrite.
- **Database**: PostgreSQL (via Prisma ORM for schema/migrations + type safety). Local/dev uses
  a local or containerized Postgres; no paid managed DB without human approval.
- **Background jobs**: in-process scheduled jobs for V1 (node-cron style) behind an adapter
  interface, so a real queue (e.g. BullMQ+Redis) can be swapped in later (M25) without changing
  call sites.
- **Testing**: Vitest (unit/integration), Playwright (E2E), `tsc --noEmit` (typecheck), ESLint +
  Prettier (lint/format).
- **Package manager**: npm (matches the pre-installed toolchain; no assumption of pnpm/yarn
  availability in this environment).

## Layering (hallucination-resistant pipeline)
```
SOURCE DATA -> NORMALIZATION -> FACT -> CALCULATION -> INFERENCE -> PRESENTATION
```
- **Source adapters** (`src/server/adapters/<source>/`) fetch raw data from a specific source
  (FRED, ECOS, DART, SEC EDGAR, ...) and do nothing else — no interpretation.
- **Normalization** converts raw source payloads into a common internal shape (units, timezone,
  revision status) and stores raw + normalized side by side.
- **Fact layer** stores atomic, source-attributed observations (Claim Ledger — see below).
- **Calculation layer** derives values deterministically from stored facts (e.g. % change, regime
  scores). LLMs never compute financial numbers; they read pre-computed values.
- **Inference layer** is where an LLM may generate interpretive text, always labeled INFERENCE
  and always required to cite the FACT/CALCULATION claim_ids it used.
- **Presentation layer** renders FACT/CALCULATION/INFERENCE distinctly; INFERENCE without
  backing claim_ids is not shown as a factual statement.

## Claim Ledger (core data-integrity primitive)
Every material AI-authored claim shown to a user is backed by a stored row:
`claim_id, claim_text, claim_type (FACT|CALCULATION|INFERENCE), source_id, source_url,
source_timestamp, retrieved_at, evidence, confidence, conflict_status, generated_at`.
A FACT-typed claim with no source is a bug, not a feature — it must not render as fact.

## Data conflict handling
When sources disagree, the system stores a `DATA_CONFLICT` state (source A, source B, official
source if known, timestamps, revision status) instead of silently picking one value.

## Source hierarchy
Tier S: government / central bank / exchange / official filings / official statistics agencies.
Tier A: major wire services / high-trust primary reporting. Tier B: major financial press.
Tier C: general press. Tier D: social/community. Stored as `source_tier` metadata per source.

## Directory layout (initial)
```
/
├── src/
│   ├── app/                # Next.js routes (UI)
│   ├── server/
│   │   ├── adapters/       # per-source data adapters (FRED, ECOS, DART, EDGAR, ...)
│   │   ├── domain/         # normalization, claim ledger, event clustering, causal graph, etc.
│   │   ├── db/             # Prisma schema + client
│   │   └── api/            # internal API boundary consumed by app/
│   └── lib/                 # shared utilities
├── prisma/
├── tests/
├── docs/
├── scripts/
```

## Data sources (initial, free-first — see `DATA_POLICY.md` for the full list and priority)
Korea: BOK ECOS, KOSIS, OpenDART, 공공데이터포털, MOLIT. US: FRED, SEC EDGAR, BLS, BEA, Treasury,
Federal Reserve. Global: IMF, World Bank, OECD. Adapter-per-source architecture so paid sources
can be added later without redesign; absence of paid data never blocks development.

## Caching principle
Shared analyses (e.g. Morning Brief) are generated once, verified, and cached/stored — not
regenerated per user. AI generation cost must not scale linearly with user count.
