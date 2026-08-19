# Escalation transport state

Channel: GitHub issue **#2**, `jyun121388-spec/market-os` — `AI ESCALATION CHANNEL`.
State machine: `src/server/escalation/transport.ts`. Tests: `tests/escalationTransport.test.ts`.

Measured 2026-08-19 against the live issue. Nothing here is inferred from a previous write-up.

| Field                        | Value                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `TRANSPORT_STATE`            | **`HALF_DUPLEX`** — see the credential change below                         |
| `READ_GITHUB`                | **VERIFIED** — issue and comments fetched over the unauthenticated REST API |
| `WRITE_GITHUB` (REST API)    | **BLOCKED** — no usable API credential                                      |
| `WRITE_GITHUB` (git push)    | **VERIFIED** 2026-08-19 — `6cb74fc..5de6672` pushed                         |
| `LAST_REMOTE_COMMENT_ID`     | `5335242139`                                                                |
| `LAST_PROCESSED_PROTOCOL_ID` | `TEST-001`                                                                  |
| `PENDING_ESCALATIONS`        | `TEST-002`, `ESC-009`                                                       |
| `PENDING_DECISIONS`          | none                                                                        |
| `PENDING_ACKS`               | `TEST-001`                                                                  |
| `LAST_SUCCESSFUL_READ`       | 2026-08-19, issue #2, 1 comment                                             |
| `LAST_SUCCESSFUL_WRITE`      | 2026-08-19 — git push only; no comment has ever been posted                 |

## Why the write is blocked, and how that was established

A fail-fast probe, not a hang. With `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never` and
`GIT_ASKPASS=echo`, `git push --dry-run` returns in under a second:

```
fatal: Cannot prompt because user interactivity has been disabled.
remote: Invalid username or token. Password authentication is not supported for Git operations.
```

That is the canonical probe. Earlier attempts without those variables hung for 45 seconds against a
prompt that can never be answered in this environment — a blocked credential should resolve to
`NO_CREDENTIAL`, never to "waiting".

A credential helper (`manager`) is configured and holds nothing usable. `gh` is not installed;
neither `GITHUB_TOKEN` nor `GH_TOKEN` is set. No token was created, requested or read from any
browser or IDE store, and none is recorded anywhere in this repository.

## What that means, stated honestly

**Half of the channel works.** ChatGPT → GitHub → Claude is live and verified: the
`[CHATGPT_DECISION][TEST-001]` comment was read directly, in full, with no human relaying it.

**Claude → GitHub has never succeeded.** Not once, so `FULL_DUPLEX_VERIFIED` is unavailable
regardless of how the queue looks. A pending file is not a transmission.

## Exchanges

| ID       | State              | Note                                                                                                                                                                                                                                       |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-001 | `DECISION_INVALID` | A decision with no matching `[ESCALATION]` on the issue — it opened the channel rather than answering a question. Read and understood; deliberately not treated as an instruction the repository requested. Its acknowledgement is queued. |
| TEST-002 | `PENDING`          | Composed and **not transmitted**. Queued under `TEST_002_BLOCKED_WRITE_AUTH`.                                                                                                                                                              |

`TEST-001` sitting at `DECISION_INVALID` is the state machine working, not a fault: a decision
arriving with no escalation behind it may be a test, a stray, or aimed at another repository, and
the module refuses to obey one rather than guessing. The transport test it was part of still
succeeded — reading it is what was being tested.

## Retry

`CREDENTIAL_STATE_CHANGED`, never elapsed time. Nothing about this improves by waiting and the
issue is not polled. The queue in `PENDING_COMMENTS.md` is idempotent by `(kind, id)`, so a flush
after a credential appears posts each message exactly once.

One fine-grained PAT with `issues:write` and `contents:write` clears this, the push gate (HG-001)
and the escalation write together.

## Credential state changed, 2026-08-19 — and only halfway

The write probe that had returned `AUTH_FAILURE` on every previous run now authenticates:
`git push --dry-run` reported `6cb74fc..5de6672`, and the branch has since been pushed for real.

That is a genuine change and it does not open the channel. Posting a comment goes through the REST
API, and the credential that satisfies git lives in a credential helper. Reaching into it would
mean extracting a helper secret — prohibited outright, and not made acceptable by the fact that it
would work. No `gh` CLI is installed, so no standard authenticated API mechanism is exposed to this
process.

So the honest state is `HALF_DUPLEX` in a narrower sense than the term usually carries here: reads
work, git writes work, protocol writes do not. `TEST-001`'s acknowledgement, `TEST-002` and
`ESC-009` remain `ESCALATION_QUEUED_NOT_TRANSMITTED`.

**Nothing may report these as delivered.** ChatGPT has not seen them. The retry condition is
narrowed accordingly — not "a credential appears", which has now happened without helping, but a
credential usable against the REST API.
