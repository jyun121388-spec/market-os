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

## Continuation: state-based, never time-based

Autonomous work continues while a safe runnable task exists. **Absolute time is never a completion
condition** — not "until 18:00", not "for N hours". If a runtime limit exists anywhere it is a
runaway-process safety valve, not a goal, and continuity is never bought by raising it.

None of these is a reason to stop: a finished milestone or phase, a written report, a completed
review, an open escalation, a Human Gate, a blocked dependency, or a long context.

`src/server/evolution/scheduler.ts` is the machinery — Evolution proposes, Governance classifies,
`scheduleNextWork()` returns `{ actionable, deferred }`. Reinforce it; do not build a second one.
Before concluding there is nothing to do, RUN IT: a prose summary is not evidence about the queue,
and the first time it ran it contradicted one written minutes earlier.

**The only normal completion sentinel** is `evaluateStopSentinel()` in that module: no startable
task, no unresolved failing check, no blocker advanceable by code, tests, docs or analysis, no
review finding quietly dropped, and everything remaining genuinely needs a human, a credential, or
an unavailable service.

## Escalation is asynchronous, not a stop

The canonical channel is the open GitHub issue titled **AI ESCALATION CHANNEL**
(`jyun121388-spec/market-os` #2). One issue, never a second.

- `[ESCALATION][<PROJECT_ID>][<ESC_ID>]` — Claude → ChatGPT
- `[CHATGPT_DECISION][<ESC_ID>]` — ChatGPT → Claude
- `[CLAUDE_APPLIED][<ESC_ID>]` — Claude → ChatGPT

Escalate only what genuinely needs a higher judgement: architecture contracts, conflicting product
intent, cross-repository protocol, security/financial/destructive/irreversible decisions, an
unresolvable conflict with an independent review, or a question the ADRs and evidence cannot
settle. Not lint, not a clear bug, not a reversible low-risk choice.

Posting an escalation blocks **only the task that depends on it** — mark that `WAITING_DECISION`
and continue everything independent. Check the channel at session start, milestone completion,
major checkpoints, and before returning to a previously escalated task; not after every edit.

A decision is not applied on sight. Confirm it targets this repository, matches an open `ESC_ID`,
and has not gone stale against the current HEAD. If it has, reply `[ESCALATION_REFRESH_REQUIRED]`
with the difference rather than guessing.

**Reading works; writing needs HG-001.** The repository is public, so decisions can be read over
the unauthenticated REST API. Posting needs a credential this machine does not have, so replies
are staged verbatim in `docs/escalation/PENDING_COMMENTS.md` and posted unchanged when one exists.

### Invariants (`src/server/escalation/packet.ts` is the machinery)

- `HUMAN_GATE => ESCALATE_ASYNC_AND_CONTINUE` — a gate defers its own action and nothing else.
- `TRUE_IDLE => ESCALATE_BEFORE_IDLE` — idling without having asked is a silent stop.
- `WRITE_AUTH_BLOCKED => QUEUE_ESCALATION_AND_CONTINUE` — never retry on unchanged credential state.
- `ESCALATION_PENDING != PROJECT_STOPPED`.
- `REMOTE_POST_NOT_CONFIRMED => CHATGPT_NOT_YET_NOTIFIED` — only read-back proves transmission.

Escalations carry a decision packet (one decision, options, recommended default, what continues
meanwhile), never a progress report. Everything outbound passes `screenPublicComment` first; issue
#2 is publicly readable. Do not re-post "still idle" — only a materially changed state earns
another message.

## Environment hazard: heredocs eat backslashes

Writing a file through a shell heredoc in this environment collapses `\b` to a backspace character,
so regexes written that way silently match nothing. It has happened three times, and the third time
it produced a **confident, plausible, entirely wrong findings list** rather than an obvious error.

Write any file containing regexes, or any analysis script whose output will be believed, with the
Write tool. Reserve heredocs for text with no backslashes.

The general rule this is a case of: **a script's output is a claim, not evidence.** Check a
surprising result against something already known before writing it down — the wrong list was caught
because it contradicted two greps, not because it looked wrong.

## Unknown is not success

Record what was actually established: `VERIFIED`, `VERIFIED_WITH_LIMITATION`,
`LIVE_VERIFICATION_REQUIRED`, `HUMAN_GATE`, `BLOCKED`, `REVIEW_PENDING`. A verification that could
not be run is never recorded as passing, "implemented" is not "verified", and a reviewer's
confidence is not evidence.

On repeated failure, compare the failure signature against the last attempt before retrying.
Re-running the same approach with no new evidence is not debugging, and an environment problem
must never be hidden by a product change.

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
