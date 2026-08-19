/**
 * Turning a received decision into work, without letting a public comment become an instruction.
 *
 * The watcher's job ends at "a message arrived". This module answers the much harder question of
 * whether it may be obeyed, and the separation is deliberate: transport that could also authorise
 * would mean anyone able to comment on a public issue could direct this repository.
 *
 * Four gates, in order, each of which has to pass before the next is asked:
 *
 * 1. **Does it answer a question we asked?** A decision with no matching `[ESCALATION]` is not a
 *    decision, it is an instruction from a stranger. TEST-001 is exactly this shape and is why the
 *    state exists rather than an exception being thrown.
 * 2. **Has it already been applied?** Transport redelivers; engineering must not. This is where
 *    at-least-once delivery becomes exactly-once application.
 * 3. **Does it name actions Governance permits?** The bus is not root authority. An instruction to
 *    spend money, deploy to production, run a destructive migration or disclose a secret is
 *    refused identically whether it arrives by comment or any other route.
 * 4. **Is it still about this repository, at this HEAD?** A decision written against a state that
 *    has moved is answered with a refresh request rather than a guess.
 *
 * Only then does it become a startable work item.
 */

import type { ActionKind } from "../governance/policy";
import { evaluateAction } from "../governance/policy";
import type { InboxEntry } from "./state";

export type DecisionVerdict =
  | "APPLICABLE"
  | "NO_MATCHING_ESCALATION"
  | "ALREADY_APPLIED"
  | "FORBIDDEN_BY_GOVERNANCE"
  | "STALE_AGAINST_HEAD"
  | "TEST_MESSAGE_NOT_A_DECISION";

export interface DecisionAssessment {
  protocolId: string;
  verdict: DecisionVerdict;
  /** Why, in words. A verdict with no account of itself is not an audit record. */
  reason: string;
  /** Actions the decision implies, as Governance sees them. Empty when nothing was extracted. */
  impliedActions: ActionKind[];
}

export interface ConsumerContext {
  /** Protocol ids for which WE posted an escalation. The only ids a decision may answer. */
  openEscalationIds: string[];
  /** Protocol ids already carried out. */
  appliedIds: string[];
  /** The commit a decision was written against, when it names one. */
  currentHead?: string;
  /** Environment facts, passed through to Governance unchanged. */
  governanceContext?: Parameters<typeof evaluateAction>[0]["context"];
}

/**
 * Action kinds named in a decision body.
 *
 * Extraction is intentionally literal: the body must NAME the action kind for it to be recognised.
 * Inferring intent from prose was considered and rejected — a paraphrase detector that is wrong in
 * the permissive direction converts a discussion of an action into authorisation for it, and the
 * whole point of this gate is that it cannot be talked past.
 *
 * The consequence is that a decision naming nothing extracts nothing, and a decision that would
 * require a governed action must say which. That is a real burden on whoever writes the decision,
 * and it is the correct place for the burden to sit.
 */
export function impliedActions(body: string, known: ActionKind[]): ActionKind[] {
  return known.filter((kind) => new RegExp(`\\b${kind}\\b`).test(body));
}

export function assessDecision(
  entry: InboxEntry,
  context: ConsumerContext,
  knownActions: ActionKind[],
): DecisionAssessment {
  const base = { protocolId: entry.protocolId, impliedActions: [] as ActionKind[] };

  // A TEST id may travel the same wires and must never move the same levers. Checked first, so a
  // test message cannot even reach the governance evaluation and cause a side effect there.
  if (/^TEST-/.test(entry.protocolId)) {
    return {
      ...base,
      verdict: "TEST_MESSAGE_NOT_A_DECISION",
      reason:
        "A TEST-prefixed id exercises the transport and authorises nothing. It is acknowledged " +
        "and never applied.",
    };
  }

  if (context.appliedIds.includes(entry.protocolId)) {
    return {
      ...base,
      verdict: "ALREADY_APPLIED",
      reason:
        `${entry.protocolId} has already been applied. The transport may redeliver a comment; ` +
        "the engineering change behind it happens once.",
    };
  }

  if (!context.openEscalationIds.includes(entry.protocolId)) {
    return {
      ...base,
      verdict: "NO_MATCHING_ESCALATION",
      reason:
        `No [ESCALATION][${entry.protocolId}] was posted from here, so this answers no question ` +
        "we asked. Not applied.",
    };
  }

  // A decision that names a commit is a decision about that commit. If HEAD has moved past it, the
  // reasoning may no longer hold, and guessing whether it still does is exactly the judgement a
  // decision was requested for in the first place.
  const namedHead = /\b([0-9a-f]{7,40})\b/.exec(
    entry.body.match(/HEAD[:\s]+([0-9a-f]{7,40})/)?.[1] ?? "",
  );
  if (namedHead && context.currentHead && !context.currentHead.startsWith(namedHead[1])) {
    return {
      ...base,
      verdict: "STALE_AGAINST_HEAD",
      reason:
        `Written against ${namedHead[1]}, which is not the current HEAD. Reply ` +
        "[ESCALATION_REFRESH_REQUIRED] with the difference rather than guessing.",
    };
  }

  const actions = impliedActions(entry.body, knownActions);
  const forbidden = actions.filter((kind) => {
    const evaluation = evaluateAction({ kind, context: context.governanceContext });
    return evaluation.decision === "DENIED" || evaluation.decision === "DEFERRED_HUMAN_GATE";
  });

  if (forbidden.length > 0) {
    return {
      protocolId: entry.protocolId,
      impliedActions: actions,
      verdict: "FORBIDDEN_BY_GOVERNANCE",
      reason:
        `The decision names ${forbidden.join(", ")}, which policy does not permit an agent to ` +
        "carry out. GitHub is a transport bus and not a root authority, so arriving by comment " +
        "changes nothing about the rule.",
    };
  }

  return {
    protocolId: entry.protocolId,
    impliedActions: actions,
    verdict: "APPLICABLE",
    reason:
      `Answers [ESCALATION][${entry.protocolId}], has not been applied, and names ` +
      `${actions.length === 0 ? "no governed action" : actions.join(", ")}. Startable.`,
  };
}

export interface ControlEvent {
  kind: "DECISION_APPLICABLE" | "DECISION_REJECTED";
  protocolId: string;
  detail: string;
}

/**
 * The wake signal: what an idle scheduler finds when a decision has landed.
 *
 * Idle means the engineering queue is empty and the watcher is alive, never that the process is
 * gone. A decision arriving therefore has to be able to CREATE work — otherwise "idle" would be a
 * one-way door and the whole bus would only function while something else happened to be running.
 */
export function controlEvents(
  entries: InboxEntry[],
  context: ConsumerContext,
  knownActions: ActionKind[],
): ControlEvent[] {
  return entries
    .filter((entry) => entry.status === "RECEIVED_UNVALIDATED")
    .map((entry) => {
      const assessment = assessDecision(entry, context, knownActions);
      return {
        kind: assessment.verdict === "APPLICABLE" ? "DECISION_APPLICABLE" : "DECISION_REJECTED",
        protocolId: assessment.protocolId,
        detail: assessment.reason,
      } as const;
    });
}

/** How many received decisions are startable right now. Feeds the scheduler and the sentinel. */
export function startableDecisionCount(
  entries: InboxEntry[],
  context: ConsumerContext,
  knownActions: ActionKind[],
): number {
  return controlEvents(entries, context, knownActions).filter(
    (event) => event.kind === "DECISION_APPLICABLE",
  ).length;
}
