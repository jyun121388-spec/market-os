# AI Review Runtime State

Which review capabilities are actually callable right now, verified by probe rather than assumed.
Update this whenever availability changes; routing decisions cite it.

**Last probed: 2026-08-18 (local), from `C:\AI-Projects\market-os`.**

## Codex (ChatGPT subscription entitlement)

`codex-cli` 0.147.0 at `C:\Users\jyun1\AppData\Roaming\npm\codex.ps1`.
`codex login status` → **Logged in using ChatGPT**.

| Model           | Status        | Probe latency | Notes                                           |
| --------------- | ------------- | ------------- | ----------------------------------------------- |
| `gpt-5.6-luna`  | **AVAILABLE** | 9.7s          | Bounded/repetitive audit — default first choice |
| `gpt-5.6-terra` | **AVAILABLE** | 4.9s          | Cross-file engineering review — default strong  |
| `gpt-5.6-sol`   | **AVAILABLE** | 5.3s          | Reserved: P0/P1, security, financial, final RC  |

**This is a change.** All three were quota-exhausted until 2026-08-22 under the previous plan;
the account has since been upgraded. `HG-005` is therefore **unblocked** — the first genuine
independent review of this branch is now possible.

One bounded probe per model. No polling, no retry loops. No `OPENAI_API_KEY` is configured and
none will be; this is subscription entitlement only.

### Known probe noise

The models-manager background refresh logs
`ERROR codex_models_manager::manager: failed to refresh available models: unexpected status 401
Unauthorized: Provided authentication token is expired.` while `codex exec` itself succeeds and
returns output. It is a stale cache-refresh token, not the exec credential. Recorded so it is not
mistaken for an auth failure.

## Mandatory invocation safety

`codex exec` defaults to `sandbox: workspace-write` with `approval: never`, which means a review
run **can modify the working tree**. That is unacceptable for a reviewer.

**Every review invocation must pass `-s read-only`.** A reviewer reads code and returns findings;
it never edits, never commits, and never runs the test suite against a real database.

```
codex exec -s read-only --model <model> --skip-git-repo-check "<prompt>"
```

## Local models (Ollama)

| Model                  | Reviewer / verifier              | Permitted use                             |
| ---------------------- | -------------------------------- | ----------------------------------------- |
| `qwen3.5:4b`           | **NO** — failed negative control | Hypothesis / adversarial input generation |
| `gemma3:4b`            | **NO** — failed negative control | Same, noisier                             |
| `qwen3-embedding:0.6b` | n/a                              | Embedding only                            |

Evidence: `docs/LOCAL_AI_CALIBRATION.md`. Now that Codex is available, **prefer Codex for all
actual independent review**; local models stay useful only where a deterministic oracle grades the
output (the Ask Market adversarial generator), because there the model's false-positive bias costs
nothing.

## Routing

| Work                                                             | Model |
| ---------------------------------------------------------------- | ----- |
| Bounded, repetitive, explicit acceptance criteria                | Luna  |
| Cross-file reasoning, schema/app interaction, provider semantics | Terra |
| P0/P1, security, concurrency, financial correctness, final RC    | Sol   |

Do not escalate merely because a finding exists — escalate when the reasoning required exceeds the
tier. Do not send the same trivial code to all three.

## Standing rule

No Codex finding changes code on its own authority. Every finding goes through
reproduce → valid/invalid → failing test → minimal fix → verify. Unreproducible findings are
recorded as `REJECTED_FINDING` with reasoning, in `docs/INTERIM_REVIEW_FINDINGS.md`. Model
authority does not override runtime evidence.

## Review actually performed, 2026-08-18 (second window)

Codex became available again during this session. One review was run and routed per the standing
rules.

| Model           | Scope                                                      | Result                                 |
| --------------- | ---------------------------------------------------------- | -------------------------------------- |
| `gpt-5.6-terra` | Cross-file review of the v2 shadow layers, `b6eb8fd..HEAD` | 5 findings, **all 5 valid**, all fixed |

Terra is the correct routing for this: the target was interactions BETWEEN files — a capability
matrix, a contract deriving from it, and two consumers — which is exactly what a bounded reviewer
would miss and what Sol should not be spent on. Sol remains reserved for the final Release
Candidate adversarial pass and for any P0/P1 on v1.

Two operational notes worth keeping:

- `codex exec` blocks on stdin when invoked non-interactively even with the prompt passed as an
  argument. Redirect from `/dev/null` or the process hangs indefinitely, printing only
  "Reading additional input from stdin...".
- Always `-s read-only`. Without it `codex exec` defaults to `workspace-write` with
  `approval: never`, which lets a reviewer edit the tree it is reviewing.

**Calibration.** All five findings reproduced exactly as described, which is a marked contrast with
the two previous rounds — Sol fabricated a reproduction (IR-020) and the local models produced four
worthless findings. The reproduction step did not become optional as a result. It is what
established that these five were real, and it is the same step that rejected the other five.
