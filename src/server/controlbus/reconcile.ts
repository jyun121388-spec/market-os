/**
 * Reconciling the directives that arrived before anything could judge them.
 *
 * Seven `[CHATGPT_DECISION]` comments sat in the durable inbox at `RECEIVED_UNVALIDATED` while the
 * consumer had no caller (IR-084). Every one of them was read, validated and acted on by hand at
 * the time — RC-GATES-001 authorised the twenty-gate review chain; the two REWORK directives got
 * their rework; ESC011-FINALIZE-011 produced the attestation the release rests on. The work
 * happened. The record does not know it.
 *
 * The obvious move is to run the newly-wired consumer over them and let it catch up. That is the
 * move `[CHATGPT_DECISION][ESC-012]` forbids, and the reason is worth stating rather than
 * assuming: a consumer that judges a pre-cutover directive produces a startable work item, and a
 * work item for something already done is an instruction to do it twice. The record of an effect
 * is not a request for one.
 *
 * So this module can only look. It takes evidence the caller has gathered, decides whether the
 * effect is PROVEN, and returns a status. **There is no executor here and no way to reach one** —
 * `tests/controlBusReconciliation.test.ts` asserts the shape of that, and the shape is the
 * guarantee.
 *
 * Three outcomes, and the middle one is the honest default:
 *
 * - Evidence proves the effect → `APPLIED`.
 * - Evidence is absent or inconclusive → `VALIDATED`, with a note saying what could not be
 *   established. Not `REJECTED`, which would say the directive was invalid, and not `APPLIED`,
 *   which would say something nobody checked.
 * - The id is not pre-cutover at all → refuse to touch it, because this path exists precisely to
 *   bypass judgement and must never be reachable for something that has not had any.
 */

import type { DecisionProvenance, InboxEntry, InboxStatus } from "./state";

/**
 * The pre-cutover directives, named individually.
 *
 * A list rather than a timestamp or a comment-id boundary. Both of those are inferences about
 * which side of a line a message fell on, and the consequence of getting one wrong is either
 * replaying a completed directive or silently skipping a live one. Seven ids, each of which can be
 * checked by eye against issue #2, is a claim somebody can audit.
 *
 * Nothing may be added here without evidence that the directive was carried out before the
 * consumer was wired. The list closes on 2026-08-21; anything received after that has a consumer
 * to go through.
 */
export const PRE_CUTOVER_DIRECTIVE_IDS: readonly string[] = [
  "RC-GATES-001",
  "MARKET-RESUME-002",
  "MARKET-RESUME-003",
  "MARKET-RC-CONVERGENCE-RESUME-008",
  "MARKET-GATE-N-REWORK-009",
  "MARKET-GATE-O-REWORK-010",
  "MARKET-ESC011-FINALIZE-011",
];

export function isPreCutoverDirective(protocolId: string): boolean {
  return PRE_CUTOVER_DIRECTIVE_IDS.includes(protocolId);
}

/**
 * What the caller found when it went and looked.
 *
 * Deliberately not a boolean. `PROVEN` and `NOT_FOUND` are different from `NOT_CHECKED`, and
 * collapsing the third into the second would turn "nobody looked" into "it did not happen" — the
 * substitution this whole layer exists to refuse.
 */
export type EffectEvidence =
  /** Something observable shows the effect occurred. The `detail` must say what. */
  | { kind: "PROVEN"; detail: string }
  /** Looked, and the effect is not there. */
  | { kind: "NOT_FOUND"; detail: string }
  /** No check was performed, or the check could not run. */
  | { kind: "NOT_CHECKED"; detail: string };

export interface ReconciliationOutcome {
  protocolId: string;
  status: Extract<InboxStatus, "VALIDATED" | "APPLIED">;
  provenance: DecisionProvenance;
  note: string;
  /**
   * Always zero, and returned rather than assumed.
   *
   * A test asserting `executorCalls === 0` is checking this module's own arithmetic, which proves
   * nothing on its own. It earns its place next to the structural test that no executor is
   * reachable from here: the field makes the claim explicit in every outcome, so a future version
   * that did call something would have to lie in a value rather than merely omit a mention.
   */
  executorCalls: 0;
}

/**
 * Reconciles one pre-cutover directive against evidence. Never produces an effect.
 *
 * Throws for an id that is not pre-cutover. That is deliberate and the alternative was considered:
 * returning a benign status would make this function a way to mark ANY entry APPLIED without going
 * through the consumer, which is a hole shaped exactly like the one it was written to close.
 */
export function reconcilePreCutoverDirective(
  entry: InboxEntry,
  evidence: EffectEvidence,
): ReconciliationOutcome {
  if (!isPreCutoverDirective(entry.protocolId)) {
    throw new Error(
      `${entry.protocolId} is not a pre-cutover directive. Reconciliation bypasses judgement, so ` +
        "it may only ever be applied to entries that already had theirs, by hand, before the " +
        "consumer existed. Send this through assessDecision instead.",
    );
  }

  // Every pre-cutover entry is by definition an instruction nobody here asked for; that is why
  // they accumulated. Recorded rather than derived, so a reader is not left inferring it.
  const provenance: DecisionProvenance = "UNSOLICITED_DIRECTIVE";

  if (evidence.kind === "PROVEN") {
    return {
      protocolId: entry.protocolId,
      status: "APPLIED",
      provenance,
      note: `Carried out before the consumer was wired. Effect proven: ${evidence.detail}`,
      executorCalls: 0,
    };
  }

  return {
    protocolId: entry.protocolId,
    status: "VALIDATED",
    provenance,
    note:
      `Carried out before the consumer was wired, and the effect could not be proven from here ` +
      `(${evidence.kind}: ${evidence.detail}). Left VALIDATED rather than guessed either way. ` +
      "Not replayed: a directive whose effect is unverified is still not a request for a second " +
      "one.",
    executorCalls: 0,
  };
}
