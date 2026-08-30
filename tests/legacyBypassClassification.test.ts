import { describe, expect, it } from "vitest";
import { classify } from "../scripts/legacy-bypass-readiness";
import { REQUEST_DEVELOPMENT_CORPUS } from "./fixtures/requestDevelopmentCorpus";

/**
 * The readiness metric's own guardrails, because the metric was wrong for three packets.
 *
 * `scripts/legacy-bypass-readiness.ts` reported `0 safety exposures / 13 legitimate recognition
 * gaps`. That number was carried into three escalation packets as fact and it was invalid twice
 * over:
 *
 *   DENOMINATOR. It regex-scraped the corpus source rather than importing it, and its character
 *   class excluded any query containing an apostrophe — 47 of 500 typed cases silently absent, with
 *   the reported 493 padded by strings that were not corpus queries. Systematically biased against
 *   possessives and contractions, which is most of natural English.
 *
 *   CLASSIFICATION. It never read `expected` at all, so every UNSUPPORTED bypass became a
 *   "legitimate recognition gap" — including NEGATIVE CONTROLS the corpus says must be refused. A
 *   safety divergence and a throughput win were the same bucket.
 *
 * These tests exist so neither can return silently. A measurement nobody can check is how the first
 * one survived.
 */

describe("the corpus denominator", () => {
  it("is exactly the 500 cases the corpus declares", () => {
    // The readiness script fails closed on any other number. If this fixture legitimately grows,
    // both this test and CANONICAL_DENOMINATOR must be updated deliberately — which is the point.
    expect(REQUEST_DEVELOPMENT_CORPUS).toHaveLength(500);
  });

  it("contains queries the old regex could not see", () => {
    // The specific defect, pinned to a shape rather than a count: an apostrophe inside a
    // double-quoted TypeScript string. `[^"'`\n]` excluded every one of these.
    const withApostrophe = REQUEST_DEVELOPMENT_CORPUS.filter((c) => c.query.includes("'"));
    expect(withApostrophe.length).toBeGreaterThan(20);
    // And they are not junk — they carry both expectations, so dropping them skewed both halves.
    expect(withApostrophe.some((c) => c.expected === "ANSWERABLE")).toBe(true);
    expect(withApostrophe.some((c) => c.expected === "REFUSED")).toBe(true);
  });

  it("keeps every case's expectation and operation available for classification", () => {
    // The second defect was reading none of these. If a field the classifier depends on ever goes
    // missing, this fails rather than the metric quietly degrading to "status only".
    for (const c of REQUEST_DEVELOPMENT_CORPUS) {
      expect(c.id, c.query).toMatch(/^DEV-(EN|KO)-\d+$/);
      expect(["ANSWERABLE", "REFUSED"]).toContain(c.expected);
      expect(c.operation.length).toBeGreaterThan(0);
    }
  });
});

describe("bypass classification", () => {
  it("calls a refused request that REACHED a planner an exposure", () => {
    // THE CASE THE OLD METRIC COULD NOT SEE. A negative control admitted by the bypass, where the
    // door really did call the model. This is the only thing that counts as a safety exposure.
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", true)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
    expect(classify("REFUSED", "PROHIBITED_ADVICE", "UNSUPPORTED", true)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
  });

  it("does not call a refused request an exposure when the door refused it downstream", () => {
    // Measured, not assumed, and this is the correction to my OWN first attempt at the fix: I
    // labelled these exposures from provenance alone, then reproduced DEV-EN-214/215 and found the
    // legacy envelope refuses them — "no construction establishes which acts on which" — with the
    // planner never called. Eligibility being too permissive is real; it is not the same defect.
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", false)).toBe(
      "REFUSED_DOWNSTREAM",
    );
  });

  it("treats an unprobed refused request as unproven rather than safe", () => {
    // null means no door probe happened. It must not silently become an exposure OR a clean bill;
    // it lands in the same bucket as a refusal but the row carries plannerCalled=null so a reader
    // can tell the difference.
    expect(classify("REFUSED", "MALFORMED", "UNSUPPORTED", null)).toBe("REFUSED_DOWNSTREAM");
  });

  it("never counts a deterministic operation as recognition throughput", () => {
    // A DEFINITION or observation request answered through the planner is the deterministic path
    // being bypassed, not capability. The old metric counted all nine of these as "legitimate
    // recognition gaps we would lose".
    for (const op of ["DEFINITION", "CURRENT_OBSERVATION", "OBSERVED_CHANGE"]) {
      expect(classify("ANSWERABLE", op, "UNSUPPORTED", true), op).toBe("DETERMINISTIC_VIA_PLANNER");
      expect(classify("ANSWERABLE", op, "UNSUPPORTED", false), op).toBe(
        "DETERMINISTIC_VIA_PLANNER",
      );
    }
  });

  it("counts only a genuinely answerable non-deterministic request as recognition debt", () => {
    expect(classify("ANSWERABLE", "ATTRIBUTED_REPORTED_OBSERVATION", "UNSUPPORTED", false)).toBe(
      "TRUE_RECOGNITION_GAP",
    );
    expect(classify("ANSWERABLE", "STORED_MECHANISM", "UNSUPPORTED", false)).toBe(
      "TRUE_RECOGNITION_GAP",
    );
  });

  it("reports a canonical safety refusal separately, whatever the corpus says", () => {
    // PROHIBITED/AMBIGUOUS from the canonical parser dominates: the request is refused on this
    // product's own authority, so how the corpus labelled it does not soften the bypass.
    expect(classify("ANSWERABLE", "STORED_MECHANISM", "PROHIBITED", false)).toBe(
      "CANONICAL_SAFETY_BYPASS",
    );
    expect(classify("REFUSED", "PROHIBITED_ADVICE", "AMBIGUOUS", true)).toBe(
      "CANONICAL_SAFETY_BYPASS",
    );
  });
});
