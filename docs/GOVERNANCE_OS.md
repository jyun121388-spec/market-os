# Governance OS

> **Status: DESIGN + SHADOW MODE.** Governance logs decisions; it enforces nothing yet.
> See `docs/META_ARCHITECTURE_V2.md`.

Governance turns rules that currently live in prose across six markdown files into decisions a
machine can make and a human can audit.

## The problem it solves

The rules already exist and are largely good. They are spread across `CLAUDE.md`,
`docs/LEGAL_GUARDRAILS.md`, `docs/HUMAN_GATE_QUEUE.md`, `docs/AI_RESOURCE_POLICY.md`,
`docs/DATA_POLICY.md` and `docs/RELEASE_CHECKLIST.md`. Every application of them is a judgement
call made by whoever is reading at the time, and there is no record of _which rule_ produced a
decision.

That has a specific cost visible in this repo's history: work stops at a Human Gate that a written
rule already resolves, or proceeds on a reading nobody recorded. The purpose here is **more
autonomy, not less** — an agent that can prove an action is `AUTO_ALLOWED` should not pause for it.

## Decisions

```ts
export type PolicyDecision =
  | "AUTO_ALLOWED" // proceed; reversible and within policy
  | "AUTO_ALLOWED_WITH_VERIFY" // proceed, but the stated verification must pass before commit
  | "DEFERRED_HUMAN_GATE" // do not act; record what is needed and continue other work
  | "DENIED"; // policy forbids this outright; no gate will open it as things stand

export interface PolicyEvaluation {
  action: ActionDescriptor;
  decision: PolicyDecision;
  /** The rule that decided it, by document and section. A decision with no citation is an opinion. */
  citations: string[];
  /** For AUTO_ALLOWED_WITH_VERIFY: exactly what must pass. */
  requiredVerification: string[];
  /** For DEFERRED_HUMAN_GATE: what the human is actually being asked. */
  gate?: {
    id: string; // e.g. "HG-002"
    question: string;
    recommendedDefault: string;
    alternatives: string[];
    consequences: string;
  };
  evaluatedAt: string;
}

export interface ActionDescriptor {
  kind: ActionKind;
  /** Whether the action can be undone without external cooperation. Drives most decisions. */
  reversible: boolean;
  /** Does this spend money, contact a third party, or become publicly visible? */
  externalEffect: "NONE" | "READ_EXTERNAL" | "WRITE_EXTERNAL" | "SPEND";
  target: string;
  detail: string;
}

export type ActionKind =
  | "ADD_TEST"
  | "FIX_DEFECT"
  | "REFACTOR"
  | "EDIT_DOCS"
  | "SCHEMA_MIGRATION"
  | "DESTRUCTIVE_DB_OP"
  | "GIT_COMMIT"
  | "GIT_PUSH"
  | "GIT_HISTORY_REWRITE"
  | "CALL_FREE_PROVIDER"
  | "CALL_PAID_PROVIDER"
  | "ENABLE_PAID_SERVICE"
  | "DEPLOY_PRODUCTION"
  | "ACTIVATE_PAYMENTS"
  | "BULK_MESSAGING"
  | "PUBLISH_REPO"
  | "CREDENTIAL_CHANGE"
  | "USER_FACING_FINANCIAL_OUTPUT";
```

## Execution status — separate from the decision

A policy decision answers "is this permitted?". Whether it can actually be carried out right now is
a different question with a different answer, and the two must not be collapsed. Recording a
missing credential as `DEFERRED_HUMAN_GATE` would put a standing environmental limitation in front
of the user as though it were a decision they could make — and would teach a later reader that
policy forbids something it permits.

```ts
export type ExecutionStatus =
  | "READY"
  | "BLOCKED_MISSING_CREDENTIAL" // no usable GitHub credential on this machine (HG-001)
  | "BLOCKED_PROVIDER_KEY" // the provider is free to call but issues no key (HG-002..HG-004)
  | "BLOCKED_USAGE_LIMIT"; // an included model's quota is exhausted
```

Every member names an environmental condition and each is drawn from a blocker this project has
actually hit. Outcome states such as `EXECUTED` or `FAILED` were considered and deliberately left
out: a `PolicyEvaluation` is produced BEFORE the action and could never legitimately carry one, and
a status no evaluation can hold advertises a capability the engine does not have.

`BLOCKED_USAGE_LIMIT` carries a rule worth stating on its own. **An exhausted quota is a routing
event, not a purchasing event.** The review is still `AUTO_ALLOWED`; the response is to route to
another included model or to deterministic verification. Purchasing has its own action kind and it
is that one — never this — that raises a gate.

Two invariants are enforced by test across the whole table: an execution blocker never coincides
with `DENIED`, and an execution blocker never raises a `gate`.

## Reasoning about reality, not only about the action

"May I publish this?" has no answer that does not depend on the state of the data underneath. Two
action kinds consume the Fabric's reality state directly:

| Action                        | Reality                    | Decision                                 |
| ----------------------------- | -------------------------- | ---------------------------------------- |
| `PUBLISH_CURRENT_STATE_CLAIM` | freshness `STALE`          | `DENIED` — the claim would be false      |
|                               | freshness `FRESH`          | `AUTO_ALLOWED`                           |
|                               | freshness `UNKNOWN`/absent | `AUTO_ALLOWED_WITH_VERIFY` — disclose it |
| `PUBLISH_COMPLETENESS_CLAIM`  | `KNOWN_INCOMPLETE`         | `DENIED`                                 |
|                               | `COMPLETE`                 | `AUTO_ALLOWED`                           |
|                               | `UNCONFIRMED`/`UNKNOWN`    | `AUTO_ALLOWED_WITH_VERIFY` — disclose it |

A stale reading produces a DECISION, not an execution blocker: nothing in the environment is
missing, and the data that is present says the claim would be false. That is the mirror image of a
missing credential, and keeping the two apart is the point of the whole separation.

`UNCONFIRMED` is the permanent state for SEC financial facts. Denying it would forbid the product's
main output; allowing it silently is the 1000-of-2240 defect. Permitting it with the limitation
disclosed is the only answer that is both true and useful.

## Decision, readiness, and outcome are three questions

```ts
export type PolicyDecision =
  "AUTO_ALLOWED" | "AUTO_ALLOWED_WITH_VERIFY" | "DEFERRED_HUMAN_GATE" | "DENIED";
export type ExecutionStatus =
  "READY" | "BLOCKED_MISSING_CREDENTIAL" | "BLOCKED_PROVIDER_KEY" | "BLOCKED_USAGE_LIMIT";
export type ExecutionOutcome =
  | "EXECUTED"
  | "FAILED"
  | "DEFERRED"
  | "BLOCKED_MISSING_CREDENTIAL"
  | "BLOCKED_PROVIDER_KEY"
  | "BLOCKED_USAGE_LIMIT";
```

`ExecutionStatus` is readiness assessed BEFORE the attempt and lives on a `PolicyEvaluation`.
`ExecutionOutcome` is what happened, recorded AFTER, and lives on an `ObservedExecution`. Folding
them together would put `EXECUTED` on a record produced before anything was tried, where it could
never legitimately appear.

`observeExecution()` throws if an action decided `DENIED` or `DEFERRED_HUMAN_GATE` is recorded as
`EXECUTED`. An audit record able to express a policy violation as a normal outcome is not an audit
record — it would make the governance log the last place a violation is visible rather than the
first.

The canonical example remains `GIT_PUSH`: policy `AUTO_ALLOWED_WITH_VERIFY`, execution
`BLOCKED_MISSING_CREDENTIAL`, outcome `BLOCKED_MISSING_CREDENTIAL`. The policy has not changed
because a credential is absent.

## Replaying the queue, all of it

The engine is calibrated by replaying the Human Gate decisions already on record. That replay
covered four of the nine gates in `docs/HUMAN_GATE_QUEUE.md` and looked complete, because the five
it omitted are the ones whose answer is not a `PolicyDecision` at all.

| Gate                         | What the engine says                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| HG-001 GitHub push           | `AUTO_ALLOWED_WITH_VERIFY` + execution `BLOCKED_MISSING_CREDENTIAL` |
| HG-002/003/004 provider keys | `AUTO_ALLOWED` + execution `BLOCKED_PROVIDER_KEY`                   |
| HG-005 independent review    | `AUTO_ALLOWED`; execution follows the quota                         |
| HG-006 paid provider         | `DEFERRED_HUMAN_GATE`                                               |
| HG-007 production deployment | `DEFERRED_HUMAN_GATE`                                               |
| HG-008 payment activation    | `DEFERRED_HUMAN_GATE`                                               |
| HG-009 login lockout         | **not modelled, deliberately**                                      |

HG-002, HG-003 and HG-004 are the separation in its original form. All three providers are FREE to
call; what is missing is a key, which is an environmental fact. Recording any of them as
`DEFERRED_HUMAN_GATE` would say the policy forbids calling a free provider, which it does not.

HG-005 moved three times — a login problem, then an exhausted quota, then available again — and
the policy never changed. Only the execution status did. That is the separation doing its job
across a real sequence of events rather than in a single example.

HG-009 is the honest gap. It asks a human to choose between a targeted lockout DoS and unlimited
password guessing, and every option trades one weakness for another; there is no rule to encode.
Inventing an action kind for it would produce a decision the engine has no basis to make, wearing
the same shape as the decisions it does. A governance engine that answers questions it cannot
answer is worse than one with a visible boundary, so a test asserts no such action kind exists.

A coverage test reads `HUMAN_GATE_QUEUE.md` and fails if any recorded gate id never appears in the
replay, so a gate added later cannot sit unreplayed while the suite reports green.

## The policy table

Derived from the existing documents. Each row cites its origin; none of it is invented here.

| Action                                            | Decision                   | Source rule                                              |
| ------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| Add a regression test                             | `AUTO_ALLOWED`             | `CLAUDE.md` development loop                             |
| Fix a **reproduced** defect                       | `AUTO_ALLOWED_WITH_VERIFY` | `CLAUDE.md` Definition of Done                           |
| Fix a _suspected_ defect, not reproduced          | `DEFERRED_HUMAN_GATE`      | interim-review policy: reproduce before modifying        |
| Edit docs / state files                           | `AUTO_ALLOWED`             | `CLAUDE.md` development loop                             |
| Reversible refactor with tests green              | `AUTO_ALLOWED_WITH_VERIFY` | `RELEASE_CHECKLIST.md`                                   |
| Additive schema migration                         | `AUTO_ALLOWED_WITH_VERIFY` | must apply to fresh **and populated** DB (H1)            |
| Destructive migration / prod DB op                | `DEFERRED_HUMAN_GATE`      | `CLAUDE.md` Human Gate list                              |
| Run destructive tests without `TEST_DATABASE_URL` | `DENIED`                   | fail-closed guard, `tests/support/testDatabaseGuard.mts` |
| `git commit` on the working branch                | `AUTO_ALLOWED`             | git policy                                               |
| `git push`                                        | `AUTO_ALLOWED_WITH_VERIFY` | clean tree + green suite; blocked as HG-001              |
| Force push / reset / history rewrite / merge main | `DENIED`                   | git safety — highest-priority standing rule              |
| Call a free provider within its rate limit        | `AUTO_ALLOWED`             | `DATA_POLICY.md`                                         |
| Call a paid provider / enable paid service        | `DENIED`                   | zero-additional-cost, absolute                           |
| Purchase AI credits / API PAYG                    | `DENIED`                   | `AI_RESOURCE_POLICY.md`, absolute                        |
| Use a **local** model for hypotheses              | `AUTO_ALLOWED`             | `LOCAL_AI_CALIBRATION.md`                                |
| Use a local model as a **verifier**               | `DENIED`                   | `LOCAL_AI_CALIBRATION.md` — failed negative control      |
| Production deployment                             | `DEFERRED_HUMAN_GATE`      | HG-007                                                   |
| Payment activation                                | `DEFERRED_HUMAN_GATE`      | HG-008                                                   |
| Make the repo public                              | `DEFERRED_HUMAN_GATE`      | `CLAUDE.md` Human Gate list                              |
| Commit a real credential                          | `DENIED`                   | `CLAUDE.md` absolute rules                               |
| Output personalized buy/sell/allocation advice    | `DENIED`                   | `LEGAL_GUARDRAILS.md`                                    |
| Show a FACT with no stored source                 | `DENIED`                   | `DATA_POLICY.md` / Claim Ledger                          |
| Declare `RELEASE_CANDIDATE_READY` with gates open | `DENIED`                   | `RELEASE_CHECKLIST.md`                                   |

## The two rules that decide most cases

1. **Reversibility.** Reversible + no external effect ⇒ at worst `AUTO_ALLOWED_WITH_VERIFY`. Almost
   all engineering work lands here, which is what makes autonomy safe rather than reckless.
2. **External effect.** `SPEND` is `DENIED` under current cost policy. `WRITE_EXTERNAL` (deploys,
   emails, publishing) is a Human Gate. `READ_EXTERNAL` within a free provider's limits is allowed.

`DENIED` and `DEFERRED_HUMAN_GATE` differ in kind: a gate is a question awaiting an answer; a denial
is settled policy. Purchasing credits is not a gate — no approval is pending, the answer is already
recorded. Conflating them is how a standing rule quietly turns into "ask again later".

## Gate handling

On `DEFERRED_HUMAN_GATE`, the required behaviour is fixed:

1. Do not perform the action, and do not perform a partial version of it.
2. Append to `docs/HUMAN_GATE_QUEUE.md`: exact decision required, why, recommended default,
   alternatives, consequences.
3. **Select the next unblocked task and continue.** A gate blocks an action, never the session.

This is already how the project operates; Governance makes it mechanical and, importantly, makes
the _citation_ mandatory — so a future reader can tell whether a gate was policy or caution.

## Shadow mode plan

1. Implement `evaluate(action): PolicyEvaluation` as a pure function over the table above. Pure and
   table-driven so the policy is reviewable as data, not buried in branches.
2. **Log only.** Every gated action records what Governance would have decided.
3. Compare against the human decisions already recorded in `docs/HUMAN_GATE_QUEUE.md` — eight
   entries with known outcomes, a genuine back-test.
4. Promote to enforcing only for `DENIED` rules first, since those are absolute and unambiguous
   (paid services, force push, advice output). `AUTO_ALLOWED` enforcement comes last, because
   wrongly auto-allowing is the only failure mode here that is not merely annoying.

Promotion criterion: Governance's shadow decisions match every recorded human decision, and every
mismatch is resolved as either a policy bug or a documented exception — before it controls anything.
