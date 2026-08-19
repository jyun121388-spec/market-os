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
  // Recorded completions are ADDED to whatever the caller supplies, never replaced by it. The
  // first version treated `completed` as an override, which meant marking one item done silently
  // un-completed the other six — a caller asking a narrow question got a wrong wide answer.
  //
  // Without the record at all, the queue returned the same items after every phase and could never
  // converge: an absence read as a state, which is the defect class this whole layer exists to
  // notice, in the layer itself.
  const completed = new Set([
    ...COMPLETED_WORK.map((w) => w.proposalId),
    ...(options.completed ?? []),
  ]);
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

/**
 * Work the loop has actually done, with the evidence for each.
 *
 * The scheduler could not distinguish "not started" from "finished and unrecorded", so it returned
 * the same nine items after every phase and could never converge. That is the same defect class it
 * exists to find — an absence read as a state — and it made the queue's own count untrustworthy in
 * exactly the way a summary written from memory is.
 *
 * A completion needs EVIDENCE, not a tick. Each entry names the commit and what was produced, so a
 * reader can check the claim rather than take it. An entry with no artefact is a claim that work
 * happened, which is the thing this project keeps refusing to accept from anyone else.
 */
export interface CompletedWork {
  proposalId: string;
  /** The commit that carried it. */
  commit: string;
  /** What exists now that did not before. */
  evidence: string;
  /**
   * What the countermeasure did NOT cover, where it did not cover everything.
   *
   * A partially-addressed cause must not read as a closed one. Where this is set the cluster stays
   * live in the ledger, and the note says what a later pass would still have to do.
   */
  remaining?: string;
}

export const COMPLETED_WORK: CompletedWork[] = [
  {
    proposalId: "CLUSTER-IDENTITY_MODELLING",
    commit: "df35ba7, f63005f",
    evidence:
      "tests/orderingDeterminism.test.ts enumerates all 12 domain orderings and requires each to " +
      "be total or waived with a reason; tests/ingestTargetConvention.test.ts pins the join key " +
      "five ingest scripts write and one reader reconstructs.",
    remaining:
      "Two Ask Market orderings can still tie and are deferred by the freeze as IR-033, held in " +
      "the test's DEFERRED_BY_FREEZE list.",
  },
  {
    proposalId: "CLUSTER-GUARDRAIL_COVERAGE",
    commit: "6e06e35",
    evidence:
      "Probed for CONCEPTS rather than phrasings and found eight families with no coverage at " +
      "all; 18 direct instructions were reproduced, then closed, with an 18-question " +
      "must-not-flag corpus in tests/askMarketConceptCoverage.test.ts.",
  },
  {
    proposalId: "CLUSTER-FIXTURE_REALISM",
    commit: "030e93e",
    evidence:
      "tests/fixtureRealism.test.ts measures each fixture's cardinality on the dimensions that " +
      "produced real defects, and pairs every single-valued dimension with the inline test that " +
      "covers it instead.",
  },
  {
    proposalId: "CLUSTER-SILENT_DEGRADATION",
    commit: "ea9c79a",
    evidence:
      "Ask Market shows 10 of 1428 held facts with no signal (IR-035). Measured and surfaced in " +
      "the shadow verdict — the real run now reports those answers TRUNCATED.",
    remaining:
      "Disclosing the shortfall on the page itself is a v1 change the freeze defers; only the " +
      "shadow half is done.",
  },
  {
    proposalId: "CLUSTER-CONCURRENCY",
    commit: "7859ccf",
    evidence:
      "Enumerated every read-then-write in the domain layer. All were transactional or " +
      "constraint-protected except signUp, whose race was reproduced (IR-036): the constraint " +
      "holds, the error shape does not.",
    remaining: "IR-036's two-line handler fix is deferred by the freeze.",
  },
  {
    proposalId: "CLUSTER-PROVENANCE",
    commit: "2b78fbd",
    evidence:
      "Audited every page at the rendering layer. Every figure names its source; the causal " +
      "graph's schema-required `evidence` field is dropped before the page (IR-037), pinned so " +
      "fixing it breaks the test.",
    remaining: "IR-037's additive render is deferred by the freeze.",
  },
  {
    proposalId: "CLUSTER-ENVIRONMENT_DRIFT",
    commit: "recorded with this entry",
    evidence:
      "Four hypotheses probed against the real environments — CI's blanked DATABASE_URL, CRLF " +
      "in file-content assertions, the no-database path, and ADMIN_EMAILS in a production " +
      "build — and all four refuted. tests/environmentModes.test.ts pins the two mechanisms " +
      "those answers depend on: the DATABASE_URL rewiring, and one identical skip idiom across " +
      "all 39 integration files.",
    remaining:
      "Four refuted hypotheses are four questions answered, not a proof of soundness. Windows " +
      "versus Linux behaviour is still only observed on Windows, because CI is the only Linux " +
      "runner and nothing compares the two.",
  },
  {
    proposalId: "CAP-CEILING-SEC_EDGAR",
    commit: "4f19eee",
    evidence:
      "Checked the generalized invariant — provider response success is not a complete dataset " +
      "— across the remaining provider abstractions, and found IR-038: EDGAR derived truncation " +
      "from its own page cap, so 101 held against 501 declared reported complete. Reproduced and " +
      "fixed on the live path.",
  },
  {
    proposalId: "CLUSTER-EVIDENCE_FABRICATION",
    commit: "recorded with this entry",
    evidence:
      "Turned the discipline into an instrument. tests/documentedCounts.test.ts checks the suite " +
      "size PROJECT_STATE claims against the files that exist, requires the headline to record a " +
      "passing run rather than a partial one, and requires the figures a reader cannot re-run to " +
      "carry a date. It caught its own file on the first run — 87 exist, the document said 86.",
    remaining:
      'Only the numeric claims are instrumented. A prose claim in a state document — "verified", "complete", "reviewed" — is still unfalsifiable from inside the repository.',
  },
];

/**
 * Why the loop may or may not stop, stated as evidence rather than as a feeling.
 *
 * `isWorkExhausted` answers one question — is anything startable — and the continuation protocol
 * asks six. Reporting the queue's answer as the whole answer is how "the queue is empty" becomes
 * "the project is done", which is the same collapse as reading a skip as a pass.
 *
 * Every field is supplied by the caller except the queue, because the scheduler cannot observe a
 * failing build or an unread review finding and must not pretend to. An unsupplied field is
 * `undefined` and blocks the sentinel rather than defaulting to "fine" — the whole point is that
 * unknown is not success.
 */
export interface StopSentinelInput {
  queue: NextWorkQueue;
  /** Failing tests, CI, build, typecheck or migration that could still be investigated. */
  unresolvedFailures?: number;
  /** Blockers a person could still advance with code, tests, docs or analysis. */
  advanceableBlockers?: number;
  /** Review findings recorded but never reproduced, accepted or rejected. */
  unhandledReviewFindings?: number;
  /** Escalations posted and not yet answered. NOT a stop condition — recorded, not obeyed. */
  openEscalations?: number;
  /**
   * Candidates found by looking past the queue: second-order checklist, evidence clusters, and
   * work a state document names as next but nothing has scheduled.
   *
   * Required, and the reason for it is a contradiction this sentinel actually shipped:
   * SESSION_HANDOFF said financial semantics were unworked while the sentinel reported
   * `mayStop: true`, because an empty queue was allowed to answer on its own. An empty queue is a
   * statement about the QUEUE. Discovery has to have been run and come back empty before it is a
   * statement about the work.
   */
  discoveryCandidates?: number;
  /** Work named as next in a state document but absent from the queue with no reason recorded. */
  orphanedDocumentedWork?: number;
  /**
   * Whether the true-idle decision packet has actually left, or been durably queued to leave.
   *
   * Idling is itself a decision, and one nobody outside this machine can see being taken. A loop
   * that establishes it has nothing safe left and then simply stops has converted an asynchronous
   * question into a silent one: the gates that would unblock it are exactly the things a human
   * could act on, and nobody was told they had become the only remaining work.
   *
   * So the last thing the sentinel requires is evidence that the question was asked. QUEUED counts
   * — a missing GitHub credential is HG-001 and blocks the transmission, not the asking — but
   * NONE does not, and neither does silence, which fails closed like every other input here.
   */
  trueIdleEscalation?: "POSTED" | "QUEUED" | "NONE";
}

export interface StopSentinel {
  /** True only when every condition below is satisfied. */
  mayStop: boolean;
  /** Each condition, and whether it holds. A bare boolean would not be checkable. */
  conditions: { name: string; satisfied: boolean; detail: string }[];
  /** What remains, and why none of it can be started here. */
  remaining: string[];
}

export function evaluateStopSentinel(input: StopSentinelInput): StopSentinel {
  const { queue } = input;

  const unknown = (label: string, value: number | undefined) =>
    value === undefined
      ? { satisfied: false, detail: `${label} was never established, and unknown is not zero.` }
      : { satisfied: value === 0, detail: `${value} ${label}.` };

  const conditions = [
    {
      name: "no startable task",
      satisfied: queue.actionable.length === 0,
      detail: `${queue.actionable.length} startable, ${queue.deferred.length} deferred.`,
    },
    { name: "no unresolved failing check", ...unknown("failing checks", input.unresolvedFailures) },
    {
      name: "no blocker advanceable by code, tests, docs or analysis",
      ...unknown("advanceable blockers", input.advanceableBlockers),
    },
    {
      name: "no review finding left unhandled",
      ...unknown("unhandled review findings", input.unhandledReviewFindings),
    },
    {
      name: "second-order discovery ran and found nothing",
      ...unknown("discovery candidates", input.discoveryCandidates),
    },
    {
      name: "no documented work orphaned outside the queue",
      ...unknown("orphaned documented tasks", input.orphanedDocumentedWork),
    },
    {
      name: "true idle has been escalated, not merely reached",
      satisfied: input.trueIdleEscalation === "POSTED" || input.trueIdleEscalation === "QUEUED",
      detail:
        input.trueIdleEscalation === undefined
          ? "No true-idle escalation state supplied. Stopping without having asked is a silent stop."
          : `True-idle escalation: ${input.trueIdleEscalation}.`,
    },
    {
      // Deliberately always satisfied. An open escalation is an asynchronous request for a
      // decision, and treating it as a stop condition would let one unanswered question halt every
      // independent task in the repository — the exact failure the protocol forbids.
      name: "open escalations do not block (recorded, not obeyed)",
      satisfied: true,
      detail: `${input.openEscalations ?? 0} open; work independent of them continues.`,
    },
  ];

  return {
    mayStop: conditions.every((c) => c.satisfied),
    conditions,
    remaining: queue.deferred.map(
      (w) => `${w.proposal.id}: ${w.authority}${w.blockedBy ? ` (${w.blockedBy})` : ""}`,
    ),
  };
}
