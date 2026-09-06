import { describe, expect, it } from "vitest";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import {
  capabilityGapProposals,
  clusterProposals,
  observedEvidence,
} from "@/server/evolution/proposal";
import {
  CAPABILITY_AXES,
  PROVIDER_CAPABILITIES,
  type ProviderCapabilityProfile,
} from "@/server/fabric/providerCapability";
import { scheduleNextWork } from "@/server/evolution/scheduler";
import { scheduleAutonomousWork, type EnvironmentProbe } from "../scripts/autonomy-context";
import { detectWeaknesses } from "@/server/evolution/detect";
import { BACKFILLED_LEDGER } from "@/server/evolution/ledger";

/**
 * Proposals, held to the structure that is the only thing separating them from fabrication.
 *
 * Four local-model findings and one Codex reproduction claim have already been rejected on this
 * project, and every one of them was fluent, confident and correctly formatted. Nothing about
 * their prose distinguished them from real findings. So the tests below check the SHAPE of the
 * reasoning — that an observation exists, that inference is labelled as inference, that a claimed
 * cost is stated — rather than trying to judge whether the reasoning is good.
 */

const proposals = capabilityGapProposals();

describe("every proposal", () => {
  it("rests on at least one thing that was actually observed", () => {
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(observedEvidence(proposal).length, proposal.id).toBeGreaterThan(0);
    }
  });

  it("keeps inference labelled as inference", () => {
    for (const proposal of proposals) {
      for (const item of proposal.evidence) {
        expect(["OBSERVED", "INFERRED"]).toContain(item.standing);
        // An observation that cannot be checked is an assertion. Every item names where to look.
        expect(item.source.length, `${proposal.id}: ${item.statement}`).toBeGreaterThan(10);
      }
    }
  });

  /**
   * A proposal with no stated downside has not been thought about. This is the field most likely
   * to be filled in with "none" by anything generating these, so it is the one worth pinning.
   */
  it("states a real cost, not the absence of one", () => {
    for (const proposal of proposals) {
      expect(proposal.expectedRisk.length, proposal.id).toBeGreaterThan(40);
      expect(proposal.expectedRisk.toLowerCase()).not.toMatch(/^(none|no risk|n\/a)/);
    }
  });

  it("names the governed actions carrying it out would require", () => {
    for (const proposal of proposals) {
      expect(proposal.requiredGovernance.length, proposal.id).toBeGreaterThan(0);
      for (const action of proposal.requiredGovernance) {
        // A proposal citing an action the policy engine has never heard of would route to nobody.
        expect(GOVERNED_ACTIONS, `${proposal.id} cites ${action}`).toContain(action);
      }
    }
  });

  it("says how it would be checked", () => {
    for (const proposal of proposals) {
      expect(proposal.requiredVerify.length, proposal.id).toBeGreaterThan(0);
    }
  });
});

describe("what the matrix currently proposes", () => {
  it("raises verification debt for exactly the providers never seen live", () => {
    const debt = proposals.filter((p) => p.id.startsWith("CAP-DEBT-")).map((p) => p.id);
    // FRED left this list on 2026-09-06 (HG-002): every one of its cells now carries live
    // evidence, so the generator has nothing to propose for it — which is the generator working,
    // not a control weakened to fit.
    expect(debt.sort()).toEqual(["CAP-DEBT-ECOS", "CAP-DEBT-OPENDART"]);
    // SEC and FRED have been observed, so there is nothing to verify and no proposal to make.
    expect(debt).not.toContain("CAP-DEBT-SEC_EDGAR");
    expect(debt).not.toContain("CAP-DEBT-FRED");
  });

  it("raises a ceiling only where a real response established one", () => {
    const ceilings = proposals.filter((p) => p.id.startsWith("CAP-CEILING-")).map((p) => p.id);
    // FRED's ceiling appeared on 2026-09-06 from five NOT_SUPPORTED cells measured live.
    expect(ceilings.sort()).toEqual(["CAP-CEILING-FRED", "CAP-CEILING-SEC_EDGAR"]);
  });

  it("routes each debt proposal to the gate that would clear it", () => {
    const byId = new Map(proposals.map((p) => [p.id, p]));
    expect(byId.get("CAP-DEBT-FRED"), "HG-002 is resolved; no FRED debt to route").toBeUndefined();
    expect(byId.get("CAP-DEBT-ECOS")?.blockedBy).toBe("HG-003");
    expect(byId.get("CAP-DEBT-OPENDART")?.blockedBy).toBe("HG-004");
    // A ceiling is not blocked on anything; nothing external would change it.
    expect(byId.get("CAP-CEILING-SEC_EDGAR")?.blockedBy).toBeUndefined();
  });

  /**
   * The generator can only restate the matrix. If a proposal ever asserts something the matrix
   * does not, it was written rather than derived, and the guarantee is gone.
   */
  it("is a pure function of the matrix", () => {
    expect(capabilityGapProposals()).toEqual(proposals);
    expect(capabilityGapProposals([])).toEqual([]);
  });
});

describe("cluster proposals", () => {
  const clusters = clusterProposals();

  it("turns every detected cluster into a prediction, not just a count", () => {
    // "IDENTITY_MODELLING, 9 instances" tells a reader something recurred and nothing about what
    // to do next. The Engine's stated purpose is the prediction.
    expect(clusters.length).toBe(detectWeaknesses(BACKFILLED_LEDGER).length);
    for (const proposal of clusters) {
      expect(proposal.prediction, proposal.id).toBeTruthy();
    }
  });

  /**
   * The field that makes a prediction a claim rather than a slogan. It is also the one most likely
   * to be quietly dropped, which is why it is asserted separately and asserted to be substantial.
   */
  it("states what would show each prediction wrong", () => {
    for (const proposal of clusters) {
      expect(proposal.falsifiedBy, proposal.id).toBeTruthy();
      expect(proposal.falsifiedBy!.length, proposal.id).toBeGreaterThan(40);
      // A falsifier that restates the prediction is not a falsifier.
      expect(proposal.falsifiedBy, proposal.id).not.toBe(proposal.prediction);
    }
  });

  it("draws its evidence from the ledger rather than from the countermeasure", () => {
    const identity = clusters.find((p) => p.id === "CLUSTER-IDENTITY_MODELLING");
    expect(identity).toBeDefined();
    const observed = observedEvidence(identity!);
    // One observed item per ledger instance, each quoting that entry's lesson verbatim.
    const weakness = detectWeaknesses(BACKFILLED_LEDGER).find(
      (w) => w.category === "IDENTITY_MODELLING",
    );
    expect(observed.length).toBe(weakness!.instances.length);
    for (const item of observed) {
      expect(weakness!.lessons).toContain(item.statement);
      expect(item.source).toMatch(/^evolution\/ledger\.ts — /);
    }
  });

  it("cannot claim a cluster is broader or worse than the ledger says", () => {
    for (const weakness of detectWeaknesses(BACKFILLED_LEDGER)) {
      const proposal = clusters.find((p) => p.id === `CLUSTER-${weakness.category}`)!;
      expect(proposal.observation).toContain(`${weakness.instances.length} recorded instances`);
      expect(proposal.observation).toContain(weakness.worstSeverity);
      for (const subsystem of weakness.subsystems) {
        expect(proposal.observation).toContain(subsystem);
      }
    }
  });

  it("has a countermeasure for every category, so a new one cannot generate an empty proposal", () => {
    // A category added to the ledger with no entry here would produce a proposal with undefined
    // fields — a silently empty recommendation, which is worse than no recommendation.
    const covered = new Set(clusters.map((p) => p.systemicWeakness));
    for (const category of new Set(BACKFILLED_LEDGER.map((e) => e.category))) {
      const instances = BACKFILLED_LEDGER.filter((e) => e.category === category).length;
      if (instances >= 2)
        expect(covered, `${category} has ${instances} instances`).toContain(category);
    }
  });

  it("is a pure function of the ledger", () => {
    expect(clusterProposals([])).toEqual([]);
    expect(clusterProposals()).toEqual(clusters);
  });
});

/**
 * IR-129: the third capability state, which generated nothing.
 *
 * `NOT_VERIFIED` produces verification debt. `NOT_SUPPORTED` produces a ceiling that should stop
 * generating work. `CONDITIONAL` — measured available on a real response, under a stated
 * limitation — produced neither, and so produced nothing at all. HG-002 closed every FRED
 * `NOT_VERIFIED` cell, `CAP-DEBT-FRED` correctly stopped being generated, five `CONDITIONAL` cells
 * replaced it, and the one piece of work every measurement in that session pointed at was absent
 * from the task graph. The scheduler reported `NO_SAFE_MEANINGFUL_NODE` while a meaningful node
 * existed and could not be seen.
 */
describe("a capability measured available under a limitation is work, not a ceiling", () => {
  const byId = (id: string) => capabilityGapProposals().find((p) => p.id === id);

  it("proposes a bounded follow-up for the provider that has such cells", () => {
    const followUp = byId("CAP-FOLLOWUP-FRED");
    expect(followUp, "FRED has five CONDITIONAL cells and must generate a follow-up").toBeDefined();
    // Every axis it names must actually be CONDITIONAL in the matrix — the proposal may not invent
    // scope for itself, which is the property that separates a generated proposal from a wish.
    const fred = PROVIDER_CAPABILITIES.find((p) => p.sourceCode === "FRED")!;
    const conditional = CAPABILITY_AXES.filter((a) => fred.axes[a].state === "CONDITIONAL");
    expect(conditional.length).toBeGreaterThan(0);
    for (const axis of conditional) expect(followUp!.observation).toContain(axis);
    expect(followUp!.evidence).toHaveLength(conditional.length);
    for (const e of followUp!.evidence) expect(e.standing).toBe("OBSERVED");
  });

  it("is a different proposal from the debt and the ceiling, not an alias of either", () => {
    // The states must not collapse. A ceiling says stop looking; debt says nobody has looked; this
    // says the provider can already do it and we are not asking.
    const fred = PROVIDER_CAPABILITIES.find((p) => p.sourceCode === "FRED")!;
    expect(CAPABILITY_AXES.some((a) => fred.axes[a].state === "NOT_SUPPORTED")).toBe(true);
    expect(CAPABILITY_AXES.some((a) => fred.axes[a].state === "NOT_VERIFIED")).toBe(false);
    expect(byId("CAP-CEILING-FRED")).toBeDefined();
    expect(byId("CAP-DEBT-FRED"), "HG-002 closed FRED's verification debt").toBeUndefined();
    // And the ceiling still names only NOT_SUPPORTED axes, so the two did not merge.
    const ceiling = byId("CAP-CEILING-FRED")!;
    for (const axis of CAPABILITY_AXES.filter((a) => fred.axes[a].state === "CONDITIONAL")) {
      expect(ceiling.observation).not.toContain(axis);
    }
  });

  it("derives the provider identity from the profile rather than labelling it", () => {
    expect(byId("CAP-FOLLOWUP-FRED")!.provider).toBe("FRED");
    // SEC EDGAR issues no key, so it is not a `KeyedProvider` and resolves to undefined. That is
    // the derivation being total rather than a special case — and see the recorded limitation:
    // an unnamed action falls back to the conjunction, which currently over-blocks it.
    expect(byId("CAP-FOLLOWUP-SEC_EDGAR")!.provider).toBeUndefined();
  });

  it("requires a real response before it will generate work for itself", () => {
    // Eligibility is mechanical: LIVE_RESPONSE only. A CONDITIONAL transcribed from documentation
    // is an assumption, and generating work from an assumption is the PROVIDER_ASSUMPTION cluster's
    // own failure mode reproduced inside the generator that is supposed to notice it.
    const invented: ProviderCapabilityProfile = {
      ...PROVIDER_CAPABILITIES.find((p) => p.sourceCode === "ECOS")!,
      sourceCode: "INVENTED",
      axes: {
        ...PROVIDER_CAPABILITIES.find((p) => p.sourceCode === "ECOS")!.axes,
        revision_history: {
          state: "CONDITIONAL",
          field: "documented only",
          basis: "the documentation says so",
          provenance: "PROVIDER_DOCUMENTATION",
        },
      },
    };
    const ids = capabilityGapProposals([invented]).map((p) => p.id);
    expect(ids).not.toContain("CAP-FOLLOWUP-INVENTED");
  });

  it("generates nothing for a provider with no conditional cells", () => {
    const none: ProviderCapabilityProfile = {
      ...PROVIDER_CAPABILITIES.find((p) => p.sourceCode === "ECOS")!,
      sourceCode: "NOTHING_CONDITIONAL",
    };
    expect(CAPABILITY_AXES.some((a) => none.axes[a].state === "CONDITIONAL")).toBe(false);
    expect(capabilityGapProposals([none]).map((p) => p.id)).not.toContain(
      "CAP-FOLLOWUP-NOTHING_CONDITIONAL",
    );
  });
});

/**
 * IR-129 at the boundary: the generated proposal is a candidate, never a permission.
 *
 * The decision that authorised the generator is explicit that scheduler and Human-Gate policy stay
 * authoritative after generation. These are the controls that hold it to that.
 */
describe("the conditional follow-up reaches the scheduler as ordinary gated work", () => {
  const gates =
    "## HG-003 — g\n\n**Status**: `PENDING_USER` · n\n\n## HG-004 — g\n\n**Status**: `PENDING_USER` · n\n";
  const probe = (env: Record<string, string | undefined>): EnvironmentProbe => ({
    env,
    gateRegister: () => gates,
    stateDocument: () => "# state\n",
    githubAuth: () => "AUTHENTICATED",
  });

  it("is blocked when its own provider's key is absent, and the reason names that provider", () => {
    const { queue } = scheduleAutonomousWork({ probe: probe({}) });
    expect(queue.actionable.map((w) => w.proposal.id)).not.toContain("CAP-FOLLOWUP-FRED");
    const followUp = queue.deferred.find((w) => w.proposal.id === "CAP-FOLLOWUP-FRED")!;
    expect(followUp.authority).toBe("BLOCKED_BY_ENVIRONMENT");
    expect(followUp.blockedBy).toContain("FRED");
  });

  it("becomes startable on its own provider's key, and only that key", () => {
    // The two repairs composing: IR-129 puts the node in the graph, IR-127 stops an unrelated
    // absent credential from holding it. Neither alone produces this.
    const { queue } = scheduleAutonomousWork({ probe: probe({ FRED_API_KEY: "x" }) });
    expect(queue.actionable.map((w) => w.proposal.id)).toEqual(["CAP-FOLLOWUP-FRED"]);
    // ECOS and OpenDART work stays exactly where it was, gates included.
    const ids = queue.deferred.map((w) => w.proposal.id);
    expect(ids).toContain("CAP-DEBT-ECOS");
    expect(ids).toContain("CAP-DEBT-OPENDART");
  });

  it("does not make a forged or unknown provider identity runnable", () => {
    // Fails closed: an identity the policy engine does not recognise is never cleared by any key.
    const forged = {
      ...capabilityGapProposals().find((p) => p.id === "CAP-FOLLOWUP-FRED")!,
      provider: "BLOOMBERG" as never,
    };
    const queue = scheduleNextWork({
      proposals: [forged],
      context: {
        verificationGreen: true,
        providerKeys: { FRED: true, ECOS: true, OPENDART: true },
        providerKeyAvailable: true,
      },
    });
    expect(queue.actionable).toEqual([]);
    expect(queue.deferred[0].authority).toBe("BLOCKED_BY_ENVIRONMENT");
  });

  it("keeps the unnamed conjunction pinned, so IR-127 is not loosened by the new node", () => {
    const { queue } = scheduleAutonomousWork({ probe: probe({ FRED_API_KEY: "x" }) });
    for (const id of ["CLUSTER-PROVIDER_ASSUMPTION", "CLUSTER-SEMANTIC_RECENCY"]) {
      const work = queue.deferred.find((w) => w.proposal.id === id)!;
      expect(work.proposal.provider, `${id} must stay unnamed`).toBeUndefined();
      expect(work.blockedBy).toBe("CALL_FREE_PROVIDER: BLOCKED_PROVIDER_KEY");
    }
  });
});
