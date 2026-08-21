# AGENTS.md — Agent & Review Roles

## Roles

- **Claude (main loop)** — Lead Architect / Full-Stack Engineer / Data Engineer / QA / Security /
  DevOps for this project. Builds features, writes tests, updates docs and state.
- **Bounded subagents** — spawned only for a specific bounded task (e.g. read-only repo search,
  isolated implementation slice). Max 2 concurrent, prefer 1. Not kept alive after their task.
- **Codex** — Independent Reviewer only. Never builds the same feature Claude builds. Reviews
  are requested via `docs/CODEX_REVIEW_PACKET.md` (created per review, kept short) for:
  DB/data-model changes, financial data normalization, Claim Ledger, Event Intelligence, Causal
  Graph, Historical Analog, auth, security, AI guardrails, and release candidates. Not needed for
  formatting/docs/trivial renames/UI spacing.

## Codex cost policy

Only the user's included ChatGPT/Codex usage may be used — no OPENAI_API_KEY PAYG, no credit
purchase, no paid fallback. If included usage is exhausted, record `CODEX_REVIEW_PENDING` in
`docs/PROJECT_STATE.md` and continue with other independent work.

## Finding handling

Codex findings are not auto-applied. Claude checks evidence, attempts to reproduce (ideally with
a failing test), and either fixes (confirmed) or rejects with evidence (not confirmed). Max 2
Claude↔Codex review cycles per milestone; unresolved disagreement beyond that is logged as
`HUMAN_DECISION_REQUIRED`.

## Model assignment

See `docs/AI_RESOURCE_POLICY.md` for the Sonnet/Haiku/Opus escalation rules.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
