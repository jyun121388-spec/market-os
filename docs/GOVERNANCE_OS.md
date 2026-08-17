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
