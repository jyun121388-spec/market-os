# AI Resource Policy

## Cost ceiling
Zero additional AI spend beyond the Claude Max 20x subscription. No Anthropic usage credits, no
API PAYG (Anthropic/OpenAI/Google/Bedrock/Vertex), no paid inference gateway, no auto top-up.
On hitting the Max 20x included-usage limit: stop, write `USAGE_LIMIT_PAUSE` (with exact
resume point) into `PROJECT_STATE.md` / `SESSION_HANDOFF.md`, and stop spending — do not switch
to a paid fallback.

## Model assignment
- **Sonnet (default)** — all normal coding, debugging, API/backend, frontend, DB, tests,
  refactoring.
- **Haiku** — only for narrow, low-risk, read-only tasks: repo/file/symbol lookup, short
  extraction. Never for tasks with correctness/financial-data risk.
- **Opus (escalation only)**, triggered by one of:
  1. Sonnet has failed to solve the same core problem 3 times.
  2. A core architecture decision.
  3. A genuinely complex causal/verification algorithm.
  4. A significant security-architecture decision.
  5. A complex multi-subsystem conflict.
  6. A Release Candidate core-architecture review.
  Keep Opus calls small, read-heavy, single-question. Opus proposes direction; Sonnet
  implements it.

## Agent usage
Default: main Claude loop alone. Spawn a bounded subagent only for a specific bounded task.
Max concurrent subagents: 2, prefer 1. Do not keep a subagent alive after its task completes.
Do not build large multi-agent "teams" for routine milestone work.

## Context economy
Read only files relevant to the current task, not the whole repo, every task. Don't paste full
raw logs into context — extract FAIL/ERROR/relevant stack trace + summary first (scripts, not
AI, should do this extraction where possible). Priority order for any given step:
```
deterministic script > simple tool > Haiku > Sonnet > Opus
```
except where correctness requires the higher-reasoning tier.

## Codex
See `AGENTS.md` for Codex's role, cost policy (included usage only, `CODEX_REVIEW_PENDING` on
exhaustion), and the finding-verification process.
