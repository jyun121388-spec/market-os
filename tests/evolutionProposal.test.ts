import { describe, expect, it } from "vitest";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import { capabilityGapProposals, observedEvidence } from "@/server/evolution/proposal";

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
