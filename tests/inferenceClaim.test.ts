import { describe, expect, it } from "vitest";
import {
  figuresIn,
  verifyInferenceClaim,
  type PremiseVerification,
} from "@/server/domain/inferenceClaim";

/**
 * Verifying an inference, and being precise about what that can and cannot mean.
 *
 * The claim under test is never "this inference is true". It is four checkable things: the
 * premises verified, there are some, every figure in the text comes from one of them, and
 * confidence is present and in range. The third is the one a language model fails.
 */

const premise = (figures: string[], status = "VERIFIED", claimId = "c1"): PremiseVerification => ({
  claimId,
  status,
  figures,
});

describe("the check a model actually fails", () => {
  it("refuses a figure that appears in the text and in no premise", () => {
    const result = verifyInferenceClaim({
      claimText: "Growth slowed to 2.1% from 3.4% a year earlier.",
      confidence: 0.6,
      premises: [premise(["3.4%"])],
    });
    expect(result.status).toBe("UNSUPPORTED_FIGURE");
    expect(result.unsupportedFigures).toEqual(["2.1%"]);
  });

  it("accepts prose whose every figure is established", () => {
    const result = verifyInferenceClaim({
      claimText: "Growth slowed to 2.1% from 3.4% a year earlier.",
      confidence: 0.6,
      premises: [premise(["2.1%"]), premise(["3.4%"], "VERIFIED", "c2")],
    });
    expect(result.status).toBe("VERIFIED");
  });

  it("does not accept a bare number as evidence for a percentage", () => {
    // "2.1" and "2.1%" are different claims about the world and a reader treats them differently.
    const result = verifyInferenceClaim({
      claimText: "Growth slowed to 2.1%.",
      confidence: 0.6,
      premises: [premise(["2.1"])],
    });
    expect(result.status).toBe("UNSUPPORTED_FIGURE");
  });

  it("treats thousands separators as cosmetic, on both sides", () => {
    expect(figuresIn("The index closed at 2,845.")).toEqual(["2845"]);
    const result = verifyInferenceClaim({
      claimText: "The index closed at 2,845.",
      confidence: 0.5,
      premises: [premise(["2845"])],
    });
    expect(result.status).toBe("VERIFIED");
  });

  it("names every unsupported figure, not just the first", () => {
    const result = verifyInferenceClaim({
      claimText: "Revenue rose 12% to 48.2bn while margin reached 31%.",
      confidence: 0.7,
      premises: [premise(["12%"])],
    });
    expect(result.unsupportedFigures.sort()).toEqual(["31%", "48.2"]);
  });

  it("passes prose with no figures at all", () => {
    const result = verifyInferenceClaim({
      claimText: "Export demand appears to be the binding constraint.",
      confidence: 0.4,
      premises: [premise([])],
    });
    expect(result.status).toBe("VERIFIED");
  });
});

describe("an inference is at most as good as what it rests on", () => {
  it("refuses when any premise did not verify", () => {
    const result = verifyInferenceClaim({
      claimText: "Growth slowed.",
      confidence: 0.6,
      premises: [premise([]), premise([], "VALUE_MISMATCH", "c2")],
    });
    expect(result.status).toBe("PREMISE_NOT_VERIFIED");
    expect(result.detail).toContain("c2 (VALUE_MISMATCH)");
  });

  it.each(["EVIDENCE_MISSING", "EVIDENCE_NOT_FOUND", "VALUE_MISMATCH", "UNSUPPORTED_CLAIM_TYPE"])(
    "treats %s as disqualifying, not as a caveat",
    (status) => {
      const result = verifyInferenceClaim({
        claimText: "Growth slowed.",
        confidence: 0.6,
        premises: [premise([], status)],
      });
      expect(result.status).toBe("PREMISE_NOT_VERIFIED");
    },
  );

  it("refuses an inference with no premises", () => {
    // Not a degenerate pass. An inference resting on nothing is an assertion, and the most
    // dangerous output a generation path can produce is a confident one with no evidence behind
    // it — which under a "no premises, nothing to contradict" rule would verify cleanly.
    const result = verifyInferenceClaim({
      claimText: "The market will stabilise.",
      confidence: 0.9,
      premises: [],
    });
    expect(result.status).toBe("NO_PREMISES");
  });
});

describe("confidence is re-checked rather than assumed", () => {
  it.each([undefined, null])("refuses %s confidence", (confidence) => {
    const result = verifyInferenceClaim({
      claimText: "Growth slowed.",
      confidence,
      premises: [premise([])],
    });
    expect(result.status).toBe("CONFIDENCE_MISSING");
  });

  it.each([-0.1, 1.1, 42])("refuses out-of-range confidence %s", (confidence) => {
    const result = verifyInferenceClaim({
      claimText: "Growth slowed.",
      confidence,
      premises: [premise([])],
    });
    expect(result.status).toBe("CONFIDENCE_OUT_OF_RANGE");
  });

  it("accepts the boundaries", () => {
    for (const confidence of [0, 1]) {
      expect(
        verifyInferenceClaim({ claimText: "x", confidence, premises: [premise([])] }).status,
      ).toBe("VERIFIED");
    }
  });
});

describe("what the VERIFIED status is careful not to say", () => {
  it("says well-founded, and explicitly not correct", () => {
    // A verifier that let a caller read VERIFIED as "true" would be the Claim Ledger's own failure
    // mode: a label doing work the check never did.
    const result = verifyInferenceClaim({
      claimText: "Export demand appears to be the binding constraint.",
      confidence: 0.4,
      premises: [premise([])],
    });
    expect(result.status).toBe("VERIFIED");
    expect(result.detail).toContain("not that it is correct");
  });

  it("has no partial-credit status in its vocabulary", () => {
    // Every failure path returns a named reason and none of them is a softened pass.
    const statuses = new Set<string>();
    statuses.add(verifyInferenceClaim({ claimText: "x", confidence: null, premises: [] }).status);
    statuses.add(verifyInferenceClaim({ claimText: "x", confidence: 2, premises: [] }).status);
    statuses.add(verifyInferenceClaim({ claimText: "x", confidence: 0.5, premises: [] }).status);
    statuses.add(
      verifyInferenceClaim({
        claimText: "x",
        confidence: 0.5,
        premises: [premise([], "VALUE_MISMATCH")],
      }).status,
    );
    statuses.add(
      verifyInferenceClaim({ claimText: "9", confidence: 0.5, premises: [premise([])] }).status,
    );
    expect(
      [...statuses].filter((s) => s.includes("VERIFIED") && s !== "PREMISE_NOT_VERIFIED"),
    ).toHaveLength(0);
  });
});
