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

## FULL DUPLEX VERIFIED, 2026-08-20

| Capability                     | State                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `GIT_REMOTE_WRITE`             | **VERIFIED**                                                                                 |
| `GITHUB_ISSUE_API_READ`        | **VERIFIED** — authenticated `gh api`                                                        |
| `GITHUB_ISSUE_API_WRITE`       | **VERIFIED** — `gh issue comment --body-file`, read back                                     |
| `CONTROL_BUS_TRANSPORT_DUPLEX` | **VERIFIED** — TEST-001 round trip complete and approved                                     |
| `CONTROL_BUS_DECISION_LOOP`    | **PARTIAL** — verified for a decision that pre-existed; TEST-002 tests the reverse direction |

Remote thread as reconciled at posting time:

| id         | message                                              |
| ---------- | ---------------------------------------------------- |
| 5335242139 | `[CHATGPT_DECISION][TEST-001]`                       |
| 5341554970 | `[CHATGPT_TRANSPORT_STATUS][TEST-001]`               |
| 5349296642 | `[CLAUDE_APPLIED][TEST-001]`                         |
| 5349301611 | `[CHATGPT_REVIEW_POLICY][v1]`                        |
| 5349388665 | `[CHATGPT_VERIFIED][TEST-001]` — Status: APPROVED    |
| 5349417717 | `[ESCALATION][TEST-002]` — posted, awaiting decision |
| 5349422884 | `[ESCALATION][ESC-009]` — posted, awaiting decision  |

**What was wrong for most of a session.** Write was recorded as blocked on HG-001. `gh` was
installed and authenticated throughout. The probe was `command -v gh && gh auth status || echo "not
installed"`, and `gh auth status` exits non-zero when logged out, so the fallback branch fired and
"unauthenticated" was recorded as "absent". Git remote authentication and GitHub REST
authentication genuinely are separate capabilities — the distinction was right, the inference from
that probe was not. Check each capability positively, with its own result.

**A malformed comment was posted and deleted.** `gh api -f body=@file` does not expand `@`, so the
literal string `@./ack.tmp.md` went up as a comment body. The read-back caught it, it was deleted,
and the acknowledgement was reposted with `--body-file`. Only `--body-file` is used now. The
read-back is the sole reason this was caught, which is the argument for requiring one.

**Still not delivered:** nothing. Both queued packets are transmitted and read back. TEST-002 and
ESC-009 now await decisions, and neither blocks any other work.

## 2026-08-29 — `[CLAUDE_APPLIED][ESC-015]`

Posted as comment 5458898428, bound to `f02301ab6c13afb6939d47e3d78b3da91d466863`, read back by id
with the SHA confirmed present in the stored body. Screened first: `screenPublicComment` returned 0
findings.

It carries one open question rather than only a report — whether a fact concept identity should be
derived from stored taxonomy identifiers, stored as its own record class, or deferred with the
company residue pinned for V1. That question blocks the residue half of the company role and
nothing else, so every other path continued.

**Inbound kinds this repository still cannot receive.** The comment immediately before it was
`[CHATGPT_GUIDANCE][ESC-015-EXACT-ROLE-COVER-EXACT-TREE-20260829]`, and `CHATGPT_GUIDANCE` is not
among the five kinds the channel was known to carry, let alone the one `ProtocolKind` parses. It was
read by hand, and it mattered: its point 5 required a discrimination that then exposed a live
regression in the repair it was approving. A durable inbox would not have delivered it. ESC-014
remains the staged question about which kinds may authorise, and this is a second instance of the
same gap rather than a new one.

## 2026-08-29 — `[CLAUDE_APPLIED][ASK-FRAMING-POSITIONAL-AUTHORITY-20260829]`

Posted as comment 5459725571, bound to `9f2da0e83baf2c5366dbf241dcf450efc1ee034a`, screened clean
(`screenPublicComment` returned 0 findings) and read back by id with the SHA and both review verdicts
confirmed present in the stored body.

A new escalation id, deliberately not the ESC-015 one. ESC-015 is `APPROVED_WITH_V1_LIMITATION` and
reusing its id for unrelated work would make a closed decision look reopened.

The packet reports two things that are not progress and are the reason it exists. `LEGACY_BYPASS` is
measured as NOT removable — over the development corpus it carries 13 requests, all of them ones the
canonical parser cannot READ rather than ones it refuses on safety grounds, so removing it today
would close zero exposures and lose thirteen legitimate requests. And the framing repair does not
reduce authority divergence at all: 7 of 42 before and after, measured by reverting the changed
files under hash verification rather than by argument.

## 2026-08-29 — `[CLAUDE_APPLIED][ASK-B2C-SOURCE-AUTHORITY-20260829]`

Posted as comment 5460973484, bound to `0f727d7db74d58717d2f6c11f17915166b027c95`, screened clean
and read back by id with the SHA and both review verdicts confirmed in the stored body.

The unit took three review rounds and the packet records all of them, including the two verdicts
against my own repairs. That is the useful part of the record: the first fix invented a
generic-vocabulary exception the governing decision had not asked for, and the second fixed the
resulting symptom by rewriting stored provider names, which aliased `Street` to `The Street` and was
graded P1. Both reproduced before being repaired, and the second was only closed by moving the fix
to where the information was actually lost.

Two measurements of mine were wrong before any reviewer saw the work: a planner probe that printed
`calls=0` while throwing, and a fixture that reported no defect because the door under test was
never opened. Neither would have been caught by re-reading the code.
