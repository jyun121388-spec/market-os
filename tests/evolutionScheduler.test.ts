import { describe, expect, it } from "vitest";
import * as scheduler from "@/server/evolution/scheduler";
import {
  evaluateStopSentinel,
  isWorkExhausted,
  scheduleNextWork,
} from "@/server/evolution/scheduler";
import type { Proposal } from "@/server/evolution/proposal";
import type { ActionKind } from "@/server/governance/policy";

/**
 * The meta-loop: Evolution proposes, Governance classifies, the scheduler decides what an agent
 * may pick up without asking.
 *
 * Two properties matter more than anything else here, and they pull in opposite directions.
 *
 * It must never let a gated action through. A work item is only as permitted as its most
 * restricted required action, so "add a test, then deploy to production" is not an auto-allowed
 * test — and if that rule is ever loosened, the loop becomes a path from "Evolution noticed
 * something" to "production changed" with no human in it.
 *
 * And it must never stop because something is gated. A deferred item that empties the queue would
 * turn every missing credential into the end of the session, which is the failure this whole
 * mechanism exists to prevent.
 */

const proposal = (id: string, requiredGovernance: ActionKind[], observed = 1): Proposal => ({
  id,
  observation: `${id} observation`,
  evidence: Array.from({ length: observed }, (_, i) => ({
    standing: "OBSERVED" as const,
    statement: `observed item ${i}`,
    source: "test fixture",
  })),
  systemicWeakness: null,
  hypothesis: "test hypothesis",
  proposedChange: "test change",
  expectedBenefit: "test benefit",
  expectedRisk: "a real cost, stated at length so the shape checks elsewhere stay satisfied",
  requiredVerify: ["a targeted test"],
  requiredGovernance,
});

describe("a work item is only as permitted as its most restricted action", () => {
  it("does not let an auto-allowed action carry a human gate along behind it", () => {
    // The single most important assertion in this file.
    const queue = scheduleNextWork({
      proposals: [proposal("MIXED", ["ADD_TEST", "DEPLOY_PRODUCTION"])],
      context: { verificationGreen: true },
    });
    expect(queue.actionable).toEqual([]);
    expect(queue.deferred[0].authority).toBe("REQUIRES_HUMAN");
  });

  it("does not let it carry a denied action either", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("MIXED", ["ADD_TEST", "PERSONALIZED_ADVICE_OUTPUT"])],
      context: { verificationGreen: true },
    });
    expect(queue.actionable).toEqual([]);
    expect(queue.deferred[0].authority).toBe("FORBIDDEN");
  });

  it("reports the whole trace, so the reason is inspectable rather than asserted", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("MIXED", ["ADD_TEST", "DEPLOY_PRODUCTION"])],
      context: { verificationGreen: true },
    });
    expect(queue.deferred[0].governance).toEqual([
      { action: "ADD_TEST", decision: "AUTO_ALLOWED", execution: "READY" },
      { action: "DEPLOY_PRODUCTION", decision: "DEFERRED_HUMAN_GATE", execution: "READY" },
    ]);
  });

  it("keeps a verification requirement rather than rounding it up to unconditional", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("V", ["ADD_TEST", "FIX_REPRODUCED_DEFECT"])],
      context: { verificationGreen: true },
    });
    expect(queue.actionable[0].authority).toBe("AGENT_MAY_PROCEED_AFTER_VERIFY");
    expect(queue.actionable[0].requiredEvidence.length).toBeGreaterThan(0);
  });
});

describe("a governance question is not an infrastructure problem", () => {
  /**
   * An action a human must approve stays REQUIRES_HUMAN even when a credential is also missing.
   * Reclassifying it as an environment block would file a decision the user is entitled to make
   * as a thing to fix, which is the exact conflation the policy/execution split exists to stop.
   */
  it("keeps a gated action gated even when the environment is also broken", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("G", ["DEPLOY_PRODUCTION"])],
      context: { credentialsAvailable: false, providerKeyAvailable: false },
    });
    expect(queue.deferred[0].authority).toBe("REQUIRES_HUMAN");
  });

  it("reports a permitted-but-uncallable action as an environment block", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("P", ["CALL_FREE_PROVIDER"])],
      context: { providerKeyAvailable: false, withinDocumentedRateLimit: true } as never,
    });
    expect(queue.deferred[0].authority).toBe("BLOCKED_BY_ENVIRONMENT");
    expect(queue.deferred[0].blockedBy).toContain("BLOCKED_PROVIDER_KEY");
  });
});

describe("a blocked item must never end the session", () => {
  it("keeps every startable item when something else is gated", () => {
    const queue = scheduleNextWork({
      proposals: [
        proposal("GATED", ["DEPLOY_PRODUCTION"]),
        proposal("FINE", ["ADD_TEST"]),
        proposal("BLOCKED", ["CALL_FREE_PROVIDER"]),
      ],
      context: { verificationGreen: true, providerKeyAvailable: false },
    });
    expect(queue.actionable.map((w) => w.proposal.id)).toEqual(["FINE"]);
    expect(queue.deferred.map((w) => w.proposal.id).sort()).toEqual(["BLOCKED", "GATED"]);
    expect(isWorkExhausted(queue)).toBe(false);
  });

  /**
   * Exhaustion means nothing is STARTABLE, not that nothing is left. A queue of purely blocked
   * work is blocked, not finished, and treating the two alike is how a missing API key becomes
   * "the project is done".
   */
  it("calls a queue of only-blocked work blocked, and reports it as such", () => {
    const queue = scheduleNextWork({
      proposals: [proposal("GATED", ["DEPLOY_PRODUCTION"])],
      context: {},
    });
    expect(isWorkExhausted(queue)).toBe(true);
    expect(queue.deferred.length).toBe(1);
    // The distinction survives into the result: a caller can see there IS work and why it cannot
    // start, rather than being handed an empty object.
    expect(queue.deferred[0].blockedBy ?? queue.deferred[0].authority).toBeTruthy();
  });
});

describe("a finished phase yields the next one without being asked", () => {
  /**
   * The property this phase exists to prove. Completing the top item must produce a different top
   * item from the same evidence, with no confirmation step anywhere in the path.
   */
  it("advances to a different item once the top one is marked complete", () => {
    const first = scheduleNextWork({ context: { verificationGreen: true } });
    expect(first.actionable.length).toBeGreaterThan(1);
    const top = first.actionable[0].proposal.id;

    const second = scheduleNextWork({
      context: { verificationGreen: true },
      completed: [top],
    });
    expect(second.actionable.map((w) => w.proposal.id)).not.toContain(top);
    expect(second.actionable.length).toBe(first.actionable.length - 1);
    expect(isWorkExhausted(second)).toBe(false);
  });

  it("empties only when everything startable has actually been completed", () => {
    const context = { verificationGreen: true, providerKeyAvailable: false };
    const all = scheduleNextWork({ context });
    const done = all.actionable.map((w) => w.proposal.id);
    const after = scheduleNextWork({ context, completed: done });
    expect(isWorkExhausted(after)).toBe(true);
    // And even then the blocked items are still reported, so "exhausted" never means "nothing
    // remains" — it means nothing remains that this agent may start.
    expect(after.deferred.length).toBeGreaterThan(0);
  });

  /**
   * An unspecified environment reads as available, and that is worth pinning rather than
   * discovering.
   *
   * The policy engine only tightens on an explicit `false`, so a caller who says nothing about
   * provider keys gets a queue that assumes they exist. That makes the queue optimistic, not
   * unsafe — nothing is bypassed, an agent just picks up work it may not be able to finish. The
   * remedy is for the caller to supply what it knows, and this test exists so the behaviour stays
   * a decision instead of becoming a surprise.
   */
  it("treats an unstated environment as available, optimistically", () => {
    const stated = scheduleNextWork({ context: { providerKeyAvailable: false } });
    const unstated = scheduleNextWork({ context: {} });
    expect(unstated.actionable.length).toBeGreaterThan(stated.actionable.length);
    expect(unstated.deferred.length).toBeLessThan(stated.deferred.length);
  });
});

describe("the scheduler cannot do anything", () => {
  /**
   * There is deliberately no `execute`, `apply`, `run` or `commit` here. A scheduler that could
   * run its own output would close the loop from "Evolution noticed something" to "production
   * changed" with nothing in between, which `docs/EVOLUTION_ENGINE.md` forbids in as many words.
   */
  it("exports no way to carry out the work it schedules", () => {
    const exported = Object.keys(scheduler);
    // COMPLETED_WORK is data — a record of what was done, with the commit for each. Data cannot
    // carry work out; the check that matters is that no export is a verb.
    expect(exported.sort()).toEqual([
      "COMPLETED_WORK",
      "evaluateStopSentinel",
      "isWorkExhausted",
      "scheduleNextWork",
    ]);
    for (const name of exported) {
      expect(name).not.toMatch(/execute|apply|run|commit|perform|mutate/i);
    }
  });

  it("is a pure function of its inputs", () => {
    const a = scheduleNextWork({ context: { verificationGreen: true } });
    const b = scheduleNextWork({ context: { verificationGreen: true } });
    expect(a.actionable.map((w) => w.proposal.id)).toEqual(b.actionable.map((w) => w.proposal.id));
    expect(scheduleNextWork({ proposals: [] }).actionable).toEqual([]);
  });
});

describe("against the real ledger and capability matrix", () => {
  it("has converged: nothing startable, five items gated on provider keys", () => {
    const queue = scheduleNextWork({
      context: {
        verificationGreen: true,
        credentialsAvailable: false,
        providerKeyAvailable: false,
        includedModelQuotaAvailable: true,
      },
    });

    // Real state after every cluster and capability proposal was worked and recorded: nothing
    // startable remains, and the five items needing a provider key stay deferred. The queue
    // CONVERGING is the point — before COMPLETED_WORK existed it returned the same nine items
    // forever, and a queue that never empties can never make "exhausted" mean anything.
    expect(queue.actionable.length).toBe(0);
    expect(queue.deferred.map((w) => w.proposal.id)).toEqual(
      expect.arrayContaining(["CAP-DEBT-FRED", "CAP-DEBT-ECOS", "CAP-DEBT-OPENDART"]),
    );
    for (const blocked of queue.deferred) {
      expect(blocked.blockedBy, blocked.proposal.id).toBeTruthy();
    }
  });

  it("ranks the best-evidenced cause first", () => {
    const queue = scheduleNextWork({ context: { verificationGreen: true } });
    const observed = (w: (typeof queue.actionable)[number]) =>
      w.proposal.evidence.filter((e) => e.standing === "OBSERVED").length;
    for (let i = 1; i < queue.actionable.length; i++) {
      expect(observed(queue.actionable[i - 1])).toBeGreaterThanOrEqual(
        observed(queue.actionable[i]),
      );
    }
  });
});

describe("the stop sentinel", () => {
  const empty = { actionable: [], deferred: [] };
  // Every count the sentinel needs, all established. Discovery is in here because an empty queue
  // must no longer answer on its own — the sentinel shipped a contradiction where SESSION_HANDOFF
  // named unworked areas while mayStop was true.
  const full = {
    unresolvedFailures: 0,
    advanceableBlockers: 0,
    unhandledReviewFindings: 0,
    discoveryCandidates: 0,
    orphanedDocumentedWork: 0,
    // Added when idling became something the loop has to ASK about rather than merely reach.
    // These two tests failed the moment that condition landed, which is the right way round: the
    // sentinel fails closed on an input it was never given, so every existing caller had to say
    // whether the question had been sent. QUEUED, not POSTED — HG-001 blocks the transmission and
    // never the asking, and pretending otherwise would make a missing credential look like a
    // reason to keep working forever.
    trueIdleEscalation: "QUEUED" as const,
    // And again with the control bus. Each of these went red the moment its condition landed,
    // which is the intended shape — a new sentinel input existing callers can ignore is one that
    // defaults to satisfied, and a condition that defaults to satisfied is not a condition.
    receivedDecisions: 0,
    controlBusWatcher: "ALIVE" as const,
  };

  it("permits stopping only when every condition is satisfied", () => {
    const sentinel = evaluateStopSentinel({ queue: empty, ...full });
    expect(sentinel.mayStop).toBe(true);
  });

  /**
   * The condition that matters most, and the one a prose summary gets wrong. A queue with anything
   * startable is not a finished project, however tidy the report reads.
   */
  it("refuses while anything is startable", () => {
    // Constructed rather than taken from the live queue, which has since converged. The property
    // under test is the sentinel's, not the ledger's, and tying it to real data would make it pass
    // or fail for reasons that have nothing to do with the sentinel.
    const queue = scheduleNextWork({
      proposals: [
        {
          id: "SOMETHING-STARTABLE",
          observation: "a startable item",
          evidence: [{ standing: "OBSERVED", statement: "seen", source: "test fixture" }],
          systemicWeakness: null,
          hypothesis: "h",
          proposedChange: "c",
          expectedBenefit: "b",
          expectedRisk: "a stated cost, long enough to satisfy the shape checks elsewhere",
          requiredVerify: ["a test"],
          requiredGovernance: ["ADD_TEST"],
        },
      ],
    });
    expect(queue.actionable.length).toBeGreaterThan(0);
    expect(evaluateStopSentinel({ queue, ...full }).mayStop).toBe(false);
  });

  /**
   * An unsupplied count is not zero. The scheduler cannot see a failing build or an unread review
   * finding, so a caller that does not say blocks the sentinel rather than being assumed fine —
   * unknown is not success, applied to the thing that decides whether to stop.
   */
  it.each([
    "unresolvedFailures",
    "advanceableBlockers",
    "unhandledReviewFindings",
    "discoveryCandidates",
    "orphanedDocumentedWork",
  ])("refuses when %s was never established", (field) => {
    const input: Parameters<typeof evaluateStopSentinel>[0] = { queue: empty, ...full };
    delete (input as unknown as Record<string, unknown>)[field];
    const sentinel = evaluateStopSentinel(input);
    expect(sentinel.mayStop).toBe(false);
    expect(sentinel.conditions.find((c) => !c.satisfied)?.detail).toContain("never established");
  });

  /**
   * An escalation is a question waiting for an answer, not a halt. If one could stop the sentinel,
   * a single unanswered decision would freeze every independent task in the repository.
   */
  it("does not let an open escalation block the sentinel", () => {
    const sentinel = evaluateStopSentinel({ queue: empty, ...full, openEscalations: 3 });
    expect(sentinel.mayStop).toBe(true);
    expect(sentinel.conditions.find((c) => c.name.includes("escalation"))?.detail).toContain("3");
  });

  /**
   * The contradiction that prompted this. An empty queue used to be enough for mayStop, so the
   * sentinel reported that stopping was fine while SESSION_HANDOFF named two unworked areas in
   * plain text. An empty queue is a statement about the queue.
   */
  it("refuses on an empty queue when discovery has not been run", () => {
    const sentinel = evaluateStopSentinel({
      queue: empty,
      unresolvedFailures: 0,
      advanceableBlockers: 0,
      unhandledReviewFindings: 0,
      // discoveryCandidates and orphanedDocumentedWork deliberately absent
    });
    expect(sentinel.mayStop).toBe(false);
  });

  it("refuses when a document names work the queue does not carry", () => {
    const sentinel = evaluateStopSentinel({ queue: empty, ...full, orphanedDocumentedWork: 2 });
    expect(sentinel.mayStop).toBe(false);
    expect(sentinel.conditions.find((c) => c.name.includes("orphaned"))?.detail).toContain("2");
  });

  it("says what remains even when it permits stopping", () => {
    // "Nothing startable" must never be reported as "nothing remains". The deferred work and its
    // reasons travel with the verdict.
    const queue = scheduleNextWork({ context: { providerKeyAvailable: false } });
    const sentinel = evaluateStopSentinel({ queue, ...full });
    expect(sentinel.remaining.length).toBeGreaterThan(0);
    expect(sentinel.remaining.join(" ")).toMatch(/HG-00\d|BLOCKED/);
  });
});
