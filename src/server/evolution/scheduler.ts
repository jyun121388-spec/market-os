import {
  evaluateAction,
  type ActionDescriptor,
  type ActionKind,
  type ExecutionStatus,
  type PolicyDecision,
} from "../governance/policy";
import { capabilityGapProposals, clusterProposals, type Proposal } from "./proposal";

/**
 * The meta-loop, in engineering-control form only.
 *
 * Evolution proposes, Governance classifies, and this decides what an agent may pick up next
 * without asking anyone. It is the wiring between three layers that already existed separately,
 * and it is the piece that makes a finished phase yield the next one instead of a question.
 *
 * **It cannot approve anything.** Every authority below is derived from `evaluateAction`, which
 * reads the governing documents; this module contributes no permission of its own. The one thing
 * it adds is the rule that a proposal is only as permitted as its most restricted required action
 * — which is the property that stops a work item consisting of "add a test, then deploy to
 * production" from being scheduled as an auto-allowed test.
 *
 * SHADOW ONLY. It reads the ledger and the capability matrix, calls a pure policy function, and
 * returns a list. It executes nothing, writes nothing, and no v1 file imports it. There is
 * deliberately no `execute()` here: a scheduler that could run its own output would be a path from
 * "Evolution noticed something" to "production changed" with no human in it, which is the specific
 * thing `docs/EVOLUTION_ENGINE.md` forbids.
 */

/**
 * What an agent may do with a proposal, right now, without asking.
 *
 * Distinct from a `PolicyDecision`, which answers "is this action permitted?" for ONE action. A
 * proposal usually needs several, and the answer for the proposal is not the answer for any one of
 * them.
 */
export type ExecutionAuthority =
  /** Every required action is auto-allowed. Pick it up. */
  | "AGENT_MAY_PROCEED"
  /** Permitted, but the stated verification must pass before the work is committed. */
  | "AGENT_MAY_PROCEED_AFTER_VERIFY"
  /** At least one required action needs a human. Record it and move to the next item. */
  | "REQUIRES_HUMAN"
  /** At least one required action is settled policy against. No gate will open it. */
  | "FORBIDDEN"
  /** Policy permits every action; the environment cannot currently perform one. */
  | "BLOCKED_BY_ENVIRONMENT";

export interface GovernanceTrace {
  action: ActionKind;
  decision: PolicyDecision;
  execution: ExecutionStatus;
}

export interface ScheduledWork {
  proposal: Proposal;
  authority: ExecutionAuthority;
  /** Every governed action this proposal needs, with what the policy engine said about each. */
  governance: GovernanceTrace[];
  /** What must be true before this can be committed. Empty only when nothing is required. */
  requiredEvidence: string[];
  /** The gate or credential standing in the way, where one is. */
  blockedBy?: string;
  /** Why this sits where it does in the queue. */
  rankReason: string;
}

export interface NextWorkQueue {
  /** Work an agent may start now, most valuable first. */
  actionable: ScheduledWork[];
  /**
   * Work that cannot start, each with the reason.
   *
   * Kept in the SAME result rather than thrown away. A deferred item must never remove other
   * items from the actionable queue, and it must never end the loop — that is the whole failure
   * mode this scheduler exists to prevent, and a test asserts it directly.
   */
  deferred: ScheduledWork[];
}

const SEVERITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * The authority for a whole proposal is that of its most restricted required action.
 *
 * FORBIDDEN outranks REQUIRES_HUMAN outranks BLOCKED_BY_ENVIRONMENT outranks
 * AGENT_MAY_PROCEED_AFTER_VERIFY outranks AGENT_MAY_PROCEED. Taking the most PERMISSIVE instead —
 * or, worse, taking the first action's answer — would let a proposal that happens to list
 * `ADD_TEST` first carry a production deployment along behind it.
 */
const AUTHORITY_SEVERITY: Record<ExecutionAuthority, number> = {
  FORBIDDEN: 0,
  REQUIRES_HUMAN: 1,
  BLOCKED_BY_ENVIRONMENT: 2,
  AGENT_MAY_PROCEED_AFTER_VERIFY: 3,
  AGENT_MAY_PROCEED: 4,
};

function authorityOf(decision: PolicyDecision, execution: ExecutionStatus): ExecutionAuthority {
  if (decision === "DENIED") return "FORBIDDEN";
  if (decision === "DEFERRED_HUMAN_GATE") return "REQUIRES_HUMAN";
  // Execution is checked AFTER the decision, never instead of it. An action a human must approve
  // is not reclassified as an environment problem just because a credential also happens to be
  // missing — that would turn a governance question into an infrastructure one, which is the
  // conflation the whole policy/execution split exists to prevent.
  if (execution !== "READY") return "BLOCKED_BY_ENVIRONMENT";
  if (decision === "AUTO_ALLOWED_WITH_VERIFY") return "AGENT_MAY_PROCEED_AFTER_VERIFY";
  return "AGENT_MAY_PROCEED";
}

/**
 * Environment facts the scheduler cannot discover for itself.
 *
 * Absent fields stay absent rather than defaulting to `true`. A scheduler that assumed a
 * credential exists would produce a queue an agent cannot actually work through, and the failure
 * would show up as a mysterious mid-task block rather than as a scheduling decision.
 */
export interface SchedulerContext {
  credentialsAvailable?: boolean;
  providerKeyAvailable?: boolean;
  includedModelQuotaAvailable?: boolean;
  verificationGreen?: boolean;
}

function classify(proposal: Proposal, context: SchedulerContext): ScheduledWork {
  const governance: GovernanceTrace[] = proposal.requiredGovernance.map((kind) => {
    const descriptor: ActionDescriptor = { kind, context };
    const evaluation = evaluateAction(descriptor);
    return {
      action: kind,
      decision: evaluation.decision,
      execution: evaluation.execution,
    };
  });

  const authority = governance.reduce<ExecutionAuthority>((worst, trace) => {
    const candidate = authorityOf(trace.decision, trace.execution);
    return AUTHORITY_SEVERITY[candidate] < AUTHORITY_SEVERITY[worst] ? candidate : worst;
  }, "AGENT_MAY_PROCEED");

  const blockedTrace = governance.find(
    (t) => authorityOf(t.decision, t.execution) === "BLOCKED_BY_ENVIRONMENT",
  );

  return {
    proposal,
    authority,
    governance,
    requiredEvidence: proposal.requiredVerify,
    blockedBy:
      proposal.blockedBy ??
      (blockedTrace ? `${blockedTrace.action}: ${blockedTrace.execution}` : undefined),
    rankReason: `${proposal.systemicWeakness ?? "no cluster"} · ${observedCount(proposal)} observed evidence item(s)`,
  };
}

const observedCount = (proposal: Proposal) =>
  proposal.evidence.filter((e) => e.standing === "OBSERVED").length;

/**
 * Builds the next work queue from current evidence.
 *
 * Deterministic and pure: same ledger, same matrix, same context, same queue. Nothing here
 * consults a model, and nothing here can assert anything the underlying proposals do not.
 *
 * `completed` lets a caller mark work as done, which is what makes the loop a loop — a finished
 * phase drops out and the next item rises without anyone being asked whether to continue.
 */
export function scheduleNextWork(
  options: {
    context?: SchedulerContext;
    completed?: string[];
    proposals?: Proposal[];
  } = {},
): NextWorkQueue {
  const context = options.context ?? {};
  const completed = new Set(options.completed ?? []);
  const proposals = (options.proposals ?? [...clusterProposals(), ...capabilityGapProposals()])
    .filter((p) => !completed.has(p.id))
    .map((p) => classify(p, context));

  // Most observed evidence first, then worst severity of the underlying cluster, then id. Evidence
  // count leads deliberately: a cause with nine recorded instances is better established than one
  // with two, and severity alone would let a single dramatic P0 outrank a pattern.
  const rank = (a: ScheduledWork, b: ScheduledWork) => {
    const byEvidence = observedCount(b.proposal) - observedCount(a.proposal);
    if (byEvidence !== 0) return byEvidence;
    const severity = (w: ScheduledWork) => {
      const match = /\b(P[0-3])\b/.exec(w.proposal.observation);
      return match ? SEVERITY_RANK[match[1]] : 9;
    };
    const bySeverity = severity(a) - severity(b);
    if (bySeverity !== 0) return bySeverity;
    return a.proposal.id.localeCompare(b.proposal.id);
  };

  const startable = new Set<ExecutionAuthority>([
    "AGENT_MAY_PROCEED",
    "AGENT_MAY_PROCEED_AFTER_VERIFY",
  ]);

  return {
    actionable: proposals.filter((w) => startable.has(w.authority)).sort(rank),
    deferred: proposals.filter((w) => !startable.has(w.authority)).sort(rank),
  };
}

/**
 * The loop's own stopping condition, stated so it can be checked rather than felt.
 *
 * True only when nothing is startable. A queue containing only deferred items is NOT exhausted
 * work — it is blocked work, and the difference matters: the first should end a session and the
 * second should never be allowed to.
 */
export function isWorkExhausted(queue: NextWorkQueue): boolean {
  return queue.actionable.length === 0;
}
