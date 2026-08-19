/**
 * Exactly-once decision application, and the prerequisite that must hold before anything is wired
 * to apply a decision automatically.
 *
 * Nothing in this repository applies decisions automatically today. That is why IR-051 and IR-052
 * were recorded and not fixed: the consumer is a pure function taking `appliedIds` from its caller,
 * no persistence is attached to it, and so nothing can currently double-apply. Recording a latent
 * defect honestly is right; leaving the door open for someone to wire execution up later without
 * meeting it is not, and prose in a findings document has never stopped anyone.
 *
 * So this module is the door. `tests/applicationPrerequisite.test.ts` fails if an execution path
 * appears that does not go through it.
 *
 * **Delivery and application are different guarantees.** The transport may redeliver a comment as
 * often as it likes; that is a feature of at-least-once delivery and the deduplication in
 * `state.ts` absorbs it. What must happen once is the EFFECT. Those two are routinely conflated,
 * and the conflation is invisible until a crash lands in the window between them.
 *
 * **The hard window, stated plainly.** A process can execute a side effect and then die before the
 * applied marker is durable. On restart the journal says "started, not finished" and the system
 * cannot tell from its own records whether the effect happened. There is no clever ordering that
 * removes this — only three honest responses, chosen by what kind of action it is:
 *
 * - `IDEMPOTENT` — repeat it. Doing it twice is doing it once.
 * - `RECONCILABLE` — go and look. Posting a comment carrying a protocol id is reconcilable because
 *   the issue can be read back and the answer is definitive.
 * - `NON_IDEMPOTENT` — stop. Do not guess, and do not auto-apply in the first place.
 *
 * An action nobody has classified is `UNKNOWN`, and `UNKNOWN` never runs.
 */

import type { ActionKind } from "../governance/policy";

/**
 * Whether repeating an action is safe, checkable, or neither.
 *
 * The classification is per action kind and deliberately conservative: this table decides what may
 * be retried after a crash of unknown outcome, so the cost of a wrong `IDEMPOTENT` is doing
 * something twice that must happen once.
 */
export type IdempotencyClass =
  /** Repeating it produces the same state. Safe to retry blind. */
  | "IDEMPOTENT"
  /** Repeating is unsafe, but whether it happened can be established by observation. */
  | "RECONCILABLE"
  /** Repeating is unsafe and the outcome cannot be established. Never auto-applied. */
  | "NON_IDEMPOTENT"
  /** Policy sends it to a human regardless, so automatic application never arises. */
  | "HUMAN_GATE"
  /** Policy forbids it outright. */
  | "DENIED"
  /** Nobody has classified it. Fails closed — see `mayAutoApply`. */
  | "UNKNOWN";

const CLASSIFICATION: Partial<Record<ActionKind, IdempotencyClass>> = {
  // Writing the same local record twice leaves the same record.
  ADD_TEST: "IDEMPOTENT",
  EDIT_DOCS: "IDEMPOTENT",
  CONTROL_BUS_READ: "IDEMPOTENT",
  CONTROL_BUS_WATCHER_START: "IDEMPOTENT",
  CONTROL_BUS_WATCHER_STOP: "IDEMPOTENT",

  // Reconcilable: the effect is observable afterwards, so a crash of unknown outcome can be
  // resolved by looking rather than by guessing. A comment carries its protocol id, and the issue
  // can be read back; a commit is either in the log or it is not.
  CONTROL_BUS_PUBLIC_WRITE: "RECONCILABLE",
  POST_PUBLIC_ISSUE_COMMENT: "RECONCILABLE",
  GIT_COMMIT: "RECONCILABLE",
  GIT_PUSH: "RECONCILABLE",

  // Non-idempotent: repeating changes the world again and the first attempt cannot be reliably
  // observed from here.
  ADDITIVE_SCHEMA_MIGRATION: "NON_IDEMPOTENT",
  RUN_DESTRUCTIVE_TESTS: "NON_IDEMPOTENT",
  BULK_MESSAGING: "NON_IDEMPOTENT",
  FIX_REPRODUCED_DEFECT: "NON_IDEMPOTENT",
  FIX_SUSPECTED_DEFECT: "NON_IDEMPOTENT",
  REFACTOR: "NON_IDEMPOTENT",

  // Policy decides these long before idempotency becomes interesting. Listed so that the table is
  // a complete statement rather than a partial one with a silent tail.
  DEPLOY_PRODUCTION: "HUMAN_GATE",
  ACTIVATE_PAYMENTS: "HUMAN_GATE",
  CREDENTIAL_CHANGE: "HUMAN_GATE",
  PUBLISH_REPO: "HUMAN_GATE",
  MERGE_MAIN: "HUMAN_GATE",
  EDIT_GOVERNING_DOCUMENT: "HUMAN_GATE",
  CALL_PAID_PROVIDER: "HUMAN_GATE",
  PURCHASE_AI_CREDITS: "DENIED",
  COMMIT_CREDENTIAL: "DENIED",
  GIT_HISTORY_REWRITE: "DENIED",
  DESTRUCTIVE_DB_OP: "DENIED",
  PERSONALIZED_ADVICE_OUTPUT: "DENIED",
  UNSOURCED_FACT_OUTPUT: "DENIED",
};

export function idempotencyClass(kind: ActionKind): IdempotencyClass {
  return CLASSIFICATION[kind] ?? "UNKNOWN";
}

/** Where an application has got to. The journal records exactly these. */
export type ApplicationState =
  | "RESERVED"
  /** The effect is being attempted. A crash here is the hard window. */
  | "STARTED"
  | "EFFECT_VERIFIED"
  | "APPLIED"
  /** Crashed mid-flight and the outcome could not be established. Needs a human. */
  | "INDETERMINATE";

export interface ApplicationRecord {
  protocolId: string;
  action: ActionKind;
  /**
   * A key stable across restarts, derived from what the effect IS rather than from when it ran.
   *
   * This is what makes a reconcilable retry answerable: the same decision applied twice produces
   * the same key, so looking for the key is looking for the effect.
   */
  idempotencyKey: string;
  state: ApplicationState;
  /** Supplied by the caller, so this module stays pure. */
  at: string;
  note: string;
}

export function idempotencyKey(protocolId: string, action: ActionKind): string {
  return `${protocolId}:${action}`;
}

export interface AutoApplyDecision {
  allowed: boolean;
  class: IdempotencyClass;
  reason: string;
}

/**
 * Whether an action may be applied automatically at all.
 *
 * Called BEFORE anything is reserved. Governance has already said whether the action is permitted;
 * this asks the separate question of whether it can be carried out safely by a process that might
 * die halfway through.
 */
export function mayAutoApply(kind: ActionKind): AutoApplyDecision {
  const cls = idempotencyClass(kind);
  switch (cls) {
    case "IDEMPOTENT":
      return { allowed: true, class: cls, reason: "Repeating it produces the same state." };
    case "RECONCILABLE":
      return {
        allowed: true,
        class: cls,
        reason:
          "Repeating is unsafe, but whether it happened can be established by observation, so a " +
          "crash of unknown outcome is answerable.",
      };
    case "NON_IDEMPOTENT":
      return {
        allowed: false,
        class: cls,
        reason:
          "Repeating changes the world again and the first attempt cannot be observed from here. " +
          "A crash in the effect window would leave no safe move.",
      };
    case "HUMAN_GATE":
      return { allowed: false, class: cls, reason: "Policy sends this to a human." };
    case "DENIED":
      return { allowed: false, class: cls, reason: "Policy forbids this outright." };
    default:
      return {
        allowed: false,
        class: "UNKNOWN",
        reason:
          "Nobody has classified this action's idempotency, and unknown is not safe. Add it to " +
          "CLASSIFICATION with a reason before anything applies it automatically.",
      };
  }
}

export type RecoveryAction =
  "RETRY" | "RECONCILE_THEN_DECIDE" | "NOTHING_TO_DO" | "ESCALATE_INDETERMINATE";

export interface Recovery {
  action: RecoveryAction;
  reason: string;
}

/**
 * What to do on restart with a journal entry that is not `APPLIED`.
 *
 * This is the whole point of the module. The interesting case is `STARTED`: the effect may or may
 * not have happened, and the answer depends entirely on the action's class rather than on anything
 * the journal can know.
 */
export function recoverFrom(record: ApplicationRecord): Recovery {
  if (record.state === "APPLIED" || record.state === "EFFECT_VERIFIED") {
    return { action: "NOTHING_TO_DO", reason: "The effect is recorded as complete." };
  }
  if (record.state === "INDETERMINATE") {
    return {
      action: "ESCALATE_INDETERMINATE",
      reason: "A previous recovery could not establish whether the effect occurred.",
    };
  }
  if (record.state === "RESERVED") {
    // Reserved but never started: nothing was attempted, so starting is safe regardless of class.
    return {
      action: "RETRY",
      reason: "Reserved and never started, so no effect can have occurred.",
    };
  }

  switch (idempotencyClass(record.action)) {
    case "IDEMPOTENT":
      return { action: "RETRY", reason: "Idempotent, so repeating it is doing it once." };
    case "RECONCILABLE":
      return {
        action: "RECONCILE_THEN_DECIDE",
        reason:
          `Look for ${record.idempotencyKey} at the effect site and decide from what is actually ` +
          "there. Do not infer it from the journal, which is precisely what is missing.",
      };
    default:
      return {
        action: "ESCALATE_INDETERMINATE",
        reason:
          "The effect may have occurred and cannot be checked or safely repeated. This is the " +
          "case that must never be reached, which is why such actions are not auto-applied.",
      };
  }
}
