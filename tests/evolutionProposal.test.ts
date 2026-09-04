import { describe, expect, it } from "vitest";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import {
  capabilityGapProposals,
  clusterProposals,
  observedEvidence,
} from "@/server/evolution/proposal";
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
    expect(debt.sort()).toEqual(["CAP-DEBT-ECOS", "CAP-DEBT-FRED", "CAP-DEBT-OPENDART"]);
    // SEC has been observed, so there is nothing to verify and no proposal to make.
    expect(debt).not.toContain("CAP-DEBT-SEC_EDGAR");
  });

  it("raises a ceiling only where a real response established one", () => {
    const ceilings = proposals.filter((p) => p.id.startsWith("CAP-CEILING-")).map((p) => p.id);
    expect(ceilings).toEqual(["CAP-CEILING-SEC_EDGAR"]);
  });

  it("routes each debt proposal to the gate that would clear it", () => {
    const byId = new Map(proposals.map((p) => [p.id, p]));
    expect(byId.get("CAP-DEBT-FRED")?.blockedBy).toBe("HG-002");
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
