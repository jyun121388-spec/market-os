import { describe, expect, it } from "vitest";
import {
  packetDefects,
  planTransmission,
  renderPacket,
  trueIdlePacket,
} from "@/server/escalation/packet";
import type { DecisionPacket } from "@/server/escalation/packet";
import { evaluateStopSentinel, scheduleNextWork } from "@/server/evolution/scheduler";

/**
 * A Human Gate asks a question. It does not end the session.
 *
 * Three separate failures are pinned here, and they are separate on purpose because each one has a
 * different way of looking reasonable at the time.
 *
 * 1. **A gate stopping everything.** The gated action defers; nothing else does. This is the one
 *    that feels responsible while being wrong — declining to proceed reads as caution right up
 *    until you notice the other twelve independent tasks that also stopped.
 * 2. **Idling without asking.** Establishing that nothing safe remains and then simply stopping
 *    leaves a question nobody was asked, about gates only a human can open. Silence is not a
 *    decision to remain idle; it is the absence of one.
 * 3. **A missing credential stopping the message.** Write auth is HG-001. It blocks transmission,
 *    never composition, and never the loop — and a queued message must never be described as a
 *    transmitted one.
 */

const gatePacket = (): DecisionPacket => ({
  id: "ESC-009",
  type: "SECURITY_DECISION",
  severity: "P1",
  currentState: "HG-009 is documented and undecided; the dependent action has not been attempted.",
  decisionRequired: "Should the gated action proceed under the recommended default?",
  whyHumanDecisionRequired:
    "Governance classifies it DEFERRED_HUMAN_GATE, so no automatic decision is available.",
  options: [
    { label: "Proceed under the default", detail: "Lowest-risk path, reversible." },
    { label: "Hold until reviewed", detail: "Nothing regresses; the item stays recorded." },
  ],
  recommendedDefault: "Hold until reviewed.",
  impactIfDeferred: "Only the gated action waits.",
  workThatWillContinue: ["Verify coverage", "Fabric capability gaps", "Evolution recurrence"],
  evidence: ["docs/HUMAN_GATE_QUEUE.md HG-009"],
});

describe("a Human Gate defers its own action and nothing else", () => {
  it("never empties the queue of work that does not depend on it", () => {
    // This machine's real environment: no GitHub credential (HG-001), no provider keys
    // (HG-002..HG-004). Passing it rather than the default is the point — the default context
    // gates nothing, so a test written against it would prove the property in a world where no
    // gate exists.
    const queue = scheduleNextWork({
      context: {
        verificationGreen: true,
        credentialsAvailable: false,
        providerKeyAvailable: false,
        includedModelQuotaAvailable: true,
      },
    });
    const gated = queue.deferred.filter((w) => w.blockedBy);
    expect(gated.length, "no gated work to test against").toBeGreaterThan(0);

    // The property: every gated item is deferred, and being deferred is all it does. Nothing in
    // `actionable` is there because of a gate, and nothing left it because of one.
    for (const item of gated) {
      expect(queue.actionable).not.toContain(item);
    }
    // And the sentinel does not treat their existence as permission to stop.
    const sentinel = evaluateStopSentinel({
      queue,
      unresolvedFailures: 0,
      advanceableBlockers: 0,
      unhandledReviewFindings: 0,
      discoveryCandidates: 3,
      orphanedDocumentedWork: 0,
      trueIdleEscalation: "QUEUED",
    });
    expect(sentinel.mayStop, "discovery found candidates, so the loop must not stop").toBe(false);
  });

  it("does not let an open escalation become a stop condition", () => {
    const sentinel = evaluateStopSentinel({
      queue: { actionable: [], deferred: [] },
      unresolvedFailures: 0,
      advanceableBlockers: 0,
      unhandledReviewFindings: 0,
      discoveryCandidates: 0,
      orphanedDocumentedWork: 0,
      trueIdleEscalation: "POSTED",
      receivedDecisions: 0,
      controlBusWatcher: "ALIVE",
      openEscalations: 4,
    });
    const escalationCondition = sentinel.conditions.find((c) =>
      c.name.includes("open escalations"),
    );
    expect(escalationCondition?.satisfied).toBe(true);
    expect(sentinel.mayStop).toBe(true);
  });
});

describe("the loop may not idle without having asked", () => {
  const allQuiet = {
    queue: { actionable: [], deferred: [] },
    unresolvedFailures: 0,
    advanceableBlockers: 0,
    unhandledReviewFindings: 0,
    discoveryCandidates: 0,
    orphanedDocumentedWork: 0,
    // Added with the control bus: a decision can arrive without anyone here discovering it, and a
    // stopped watcher means the next one is never read. Both fail closed, so these existing tests
    // had to say which world they describe.
    receivedDecisions: 0,
    controlBusWatcher: "ALIVE" as const,
  };

  it("refuses to stop when the true-idle escalation state is unknown", () => {
    // Fails closed like every other sentinel input. Silence about whether the question was asked
    // is not evidence that it was.
    const sentinel = evaluateStopSentinel(allQuiet);
    expect(sentinel.mayStop).toBe(false);
    const condition = sentinel.conditions.find((c) => c.name.includes("true idle"));
    expect(condition?.satisfied).toBe(false);
    expect(condition?.detail).toContain("silent stop");
  });

  it("refuses to stop when idle was reached but never escalated", () => {
    expect(evaluateStopSentinel({ ...allQuiet, trueIdleEscalation: "NONE" }).mayStop).toBe(false);
  });

  it("accepts a queued escalation, because HG-001 blocks the sending and not the asking", () => {
    expect(evaluateStopSentinel({ ...allQuiet, trueIdleEscalation: "QUEUED" }).mayStop).toBe(true);
    expect(evaluateStopSentinel({ ...allQuiet, trueIdleEscalation: "POSTED" }).mayStop).toBe(true);
  });

  it("builds an idle packet that names the gates rather than reporting progress", () => {
    const packet = trueIdlePacket({
      id: "IDLE-001",
      completed: ["provenance enumeration", "dimension reachability"],
      remainingGates: ["HG-001", "HG-002", "HG-003", "HG-004"],
      discoveryNote: "Nine discovery passes returned nothing startable.",
      unlockOptions: [
        { label: "Issue a GitHub token", detail: "Unblocks the escalation channel's write half." },
        { label: "Provide a free FRED key", detail: "Unblocks live capability verification." },
      ],
      evidence: ["docs/EVOLUTION_LEDGERS.md"],
    });
    expect(packetDefects(packet)).toEqual([]);
    const body = renderPacket(packet);
    expect(body.startsWith("[ESCALATION][IDLE-001]")).toBe(true);
    expect(body).toContain("TRUE_IDLE_DECISION");
    // The honest admission that makes an idle packet different from every other one.
    expect(body).toContain("Nothing independent remains");
  });
});

describe("a missing write credential queues the message and never stops the loop", () => {
  it("queues, names the retry condition as a state change, and continues", () => {
    for (const capability of ["NO_CREDENTIAL", "READ_ONLY", "AUTH_FAILURE"] as const) {
      const plan = planTransmission(gatePacket(), capability, false);
      expect(plan.action, capability).toBe("QUEUE");
      expect(plan.state).toBe("ESCALATION_QUEUED_NOT_TRANSMITTED");
      expect(plan.retryCondition).toBe("CREDENTIAL_STATE_CHANGED");
      expect(plan.continueWork, "a transport failure is not an engineering condition").toBe(true);
    }
  });

  it("will not call a message posted merely because it was sent", () => {
    // The distinction that decides whether anyone actually knows: the plan for an available
    // credential is still QUEUED_NOT_TRANSMITTED, and only a read-back may change that. Recording
    // POSTED on the strength of having attempted it is how a question goes unanswered forever
    // while the record says it was asked.
    const plan = planTransmission(gatePacket(), "WRITE_AVAILABLE", false);
    expect(plan.action).toBe("POST");
    expect(plan.state).toBe("ESCALATION_QUEUED_NOT_TRANSMITTED");
    expect(plan.reason).toContain("read it back");
  });

  it("does not re-ask a question that is already on the issue", () => {
    // Ids are stable across sessions, so the reconciler sees the same escalation on every run.
    const plan = planTransmission(gatePacket(), "WRITE_AVAILABLE", true);
    expect(plan.action).toBe("NONE");
    expect(plan.state).toBe("ALREADY_POSTED");
    expect(plan.continueWork).toBe(true);
  });

  it("refuses a packet that would leak, and still does not stop the loop", () => {
    const leaky = {
      ...gatePacket(),
      currentState: "auth fails with ghp_ABCDEFGHIJKLMNOP012345678",
    };
    const plan = planTransmission(leaky, "WRITE_AVAILABLE", false);
    expect(plan.action).toBe("NONE");
    expect(plan.state).toBe("ESCALATION_BLOCKED_CONTENT");
    expect(plan.continueWork).toBe(true);
    expect(plan.reason).not.toContain("ghp_");
  });
});

describe("a packet asks one answerable question", () => {
  it("rejects a packet with nothing to choose between", () => {
    expect(packetDefects({ ...gatePacket(), options: [] })).toContain(
      "fewer than two options is not a decision",
    );
  });

  it("rejects a packet carrying two questions", () => {
    const two = {
      ...gatePacket(),
      decisionRequired: "Should we proceed? And should the key be rotated?",
    };
    expect(packetDefects(two).join(" ")).toContain("more than one question");
  });

  it("rejects a packet that would need a repository investigation to answer", () => {
    expect(packetDefects({ ...gatePacket(), evidence: [] }).join(" ")).toContain("no evidence");
  });
});
