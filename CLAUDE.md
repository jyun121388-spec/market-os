# CLAUDE.md — Market OS Operating Rules

Market OS is an Economic & Market Intelligence SaaS (not a trading/advice product).
Full governance lives in `docs/`. This file holds only what must be read every session.

## Read order for a new session
1. This file
2. `docs/PROJECT_STATE.md` — current milestone, status, test counts
3. `docs/CURRENT_TASK.md` — exact next action
4. `docs/SESSION_HANDOFF.md` — if present, last session's stopping point
5. Only the architecture/source/test files relevant to the current task

Do not re-read the whole repo or reconstruct history from chat. `PROJECT_STATE.md` is the
single source of truth for progress.

## Absolute rules
- **Zero extra AI/API cost.** Never activate paid Anthropic/OpenAI/Google/Bedrock/Vertex usage,
  buy credits, or use a PAYG key. If Max 20x included usage is exhausted, stop and write
  `USAGE_LIMIT_PAUSE` into `PROJECT_STATE.md`.
- **No paid external services** (data, hosting, DB, monitoring, email/SMS, domains) without
  explicit human approval, even "free tier requires a card" cases — treat as HUMAN GATE.
- **Legal guardrail**: never produce personalized buy/sell recommendations, portfolio advice,
  automated trading, guaranteed returns, or definitive price predictions. See
  `docs/LEGAL_GUARDRAILS.md`.
- **No hallucinated financial facts.** Every FACT shown to a user must trace to a stored source
  (see `docs/DATA_POLICY.md`, Claim Ledger design in `docs/ARCHITECTURE.md`).
- Never commit secrets. Use `.env.example` templates; real credentials are a HUMAN GATE.
- Never force-push, rewrite history, or run destructive git/DB operations without explicit
  human approval.

## Human Gate (stop and ask) — otherwise keep working autonomously
Cost (paid API/service), production deployment, destructive prod DB ops, real secrets,
real payment activation, bulk email/SMS, credential/security changes, force-push, making the
repo public, or any feature that crosses `docs/LEGAL_GUARDRAILS.md`.
If a task is blocked on a Human Gate, switch to the next independent task instead of stopping
all work.

## Development loop (repeat per milestone)
READ STATE → DEFINE TASK → IMPLEMENT → TEST → FIX → RETEST → SELF REVIEW →
CODEX REVIEW (if in scope, see `docs/TEST_STRATEGY.md`) → UPDATE DOCS →
UPDATE `PROJECT_STATE.md` → COMMIT → NEXT MILESTONE.
Do not ask permission between these steps.

## Model/agent economy
Default model: Sonnet. Use Haiku-tier subagents only for trivial read-only lookups. Escalate
to Opus only per the rules in `docs/AI_RESOURCE_POLICY.md`. Max 1 subagent at a time normally,
2 concurrent max. Don't spawn agents for work you can do directly and cheaply.

## Architecture defaults
Modular monolith. TypeScript everywhere. Next.js (frontend) + TypeScript backend with a clear
API boundary. PostgreSQL. No microservices in V1. Details: `docs/ARCHITECTURE.md`.

## Definition of Done (per milestone)
Implementation + format + lint + typecheck + unit tests + relevant integration/E2E + build all
pass; docs and `PROJECT_STATE.md` updated; P0/P1 = 0; Codex review done or logged as Review
Debt. See `docs/RELEASE_CHECKLIST.md` for release-level criteria.
