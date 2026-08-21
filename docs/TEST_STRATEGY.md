# Test Strategy

## Layers

- **Unit** (Vitest): pure functions — normalization, unit conversion, regime calculations,
  claim-ledger construction, causal-graph edge logic, financial-data-correctness checklist
  cases (timezone, revision, scale, missing values — see `DATA_POLICY.md`).
- **Integration** (Vitest + test DB or in-memory Postgres): adapters against recorded fixtures,
  API route handlers against a test database, Prisma migrations.
- **E2E** (Playwright): critical user flows (Today brief loads, Ask Market answers with
  FACT/CALCULATION/INFERENCE segmentation and redirects buy/sell questions, Watchlist add/remove).
- **Legal guardrail tests**: assert the system never emits personalized buy/sell language,
  guaranteed-return language, or an investment-recommendation score. Required to pass before any
  milestone touching Ask Market / Company X-Ray / ETF X-Ray / Historical Analog is DONE.
- **Static/deterministic checks before any AI opinion**: `prettier --check`, `eslint`,
  `tsc --noEmit`, `next build`, dependency/secret scanning. Order of trust:
  `compiler > test > AI opinion`.

## Order of operations per milestone

format → lint → typecheck → unit → integration → E2E (if in scope) → build → error-handling
spot check → docs update → PROJECT_STATE update → Codex review (if in scope) → commit.

## Failure loop

FAIL → classify → find root cause → minimal fix → add a regression test → rerun. No asking the
user to approve fixing a test failure. If the same failure survives 3 fix attempts: reconsider
the approach, check for an architecture problem, escalate to Opus if warranted (see
`AI_RESOURCE_POLICY.md`), and if still unresolved, log it as `BLOCKED` tech debt and move to a
different independent task rather than stalling the whole project.

## Prohibited "fixes"

Never delete a failing test to make the suite pass, remove validation to hide an error, weaken
type safety to silence a type error, silently swallow a critical error, replace a data error
with 0/null to hide it, or fabricate a source-less financial claim.

## Codex review scope

See `AGENTS.md`. Required for DB/data-model, financial normalization, Claim Ledger, Event
Intelligence, Causal Graph, Historical Analog, auth, security, guardrails, release candidates.
Not required for formatting/docs/trivial rename/spacing-only changes.
