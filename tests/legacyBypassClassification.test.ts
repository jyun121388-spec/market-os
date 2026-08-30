import { describe, expect, it } from "vitest";
import { classify, countCallsDespiteFailure } from "../scripts/legacy-bypass-readiness";
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
  // Signature: expected, expectedOperation, canonicalStatus, plannerCalled, evidenceBacked.
  // `evidenceBacked` says the repository actually held something this row could have been answered
  // from. Review found the previous version treating an evidence-starved zero as a proven refusal,
  // so a refusal now only counts as measured when there was something to refuse.

  it("calls a refused request that REACHED a planner an exposure", () => {
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", true, true)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
    expect(classify("REFUSED", "PROHIBITED_ADVICE", "UNSUPPORTED", true, false)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
  });

  it("calls a canonical PROHIBITED bypass an exposure only when a call happened", () => {
    // REVIEW FINDING. Canonical refusal used to win outright, so a row with NO planner call was
    // still printed under "a refused request that can still reach a planner". Canonical status now
    // joins the corpus's REFUSED rather than overriding the measurement.
    expect(classify("ANSWERABLE", "STORED_MECHANISM", "PROHIBITED", true, true)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
    expect(classify("ANSWERABLE", "STORED_MECHANISM", "PROHIBITED", false, true)).toBe(
      "REFUSED_DOWNSTREAM",
    );
  });

  it("proves a refusal only when the row had evidence to be answered from", () => {
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", false, true)).toBe(
      "REFUSED_DOWNSTREAM",
    );
    // Same row, empty shelf: a zero here says as much about the fixtures as about the code.
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", false, false)).toBe(
      "PROBE_INCONCLUSIVE",
    );
  });

  it("lets a populated shelf turn an unmeasured row into a measured refusal", () => {
    // REVIEW FINDING, second round. `evidenceBacked` was read off the row's own envelope, and a
    // refusal BY RULE returns empty id arrays by contract — so the safety-relevant rows were marked
    // inconclusive permanently and no amount of seeding could clear them. Asking the repository
    // separately restores the property a fail-closed default must have: adding evidence makes the
    // measurement conclusive rather than leaving it stuck.
    //
    // Demonstrated end to end, not only here: with an empty shelf the two AMBIGUOUS_CARDINALITY
    // controls report PROBE_INCONCLUSIVE, and after seeding their subjects they report
    // REFUSED_DOWNSTREAM and the headline changes from a lower bound to a measured zero.
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", false, false)).toBe(
      "PROBE_INCONCLUSIVE",
    );
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", false, true)).toBe(
      "REFUSED_DOWNSTREAM",
    );
  });

  it("never lets a failed probe pass as a refusal", () => {
    // REVIEW FINDING. `null` was folded into REFUSED_DOWNSTREAM, so a reader of the headline counts
    // could not tell a measured refusal from a measurement failure.
    expect(classify("REFUSED", "MALFORMED", "UNSUPPORTED", null, true)).toBe("PROBE_INCONCLUSIVE");
    expect(classify("ANSWERABLE", "DEFINITION", "UNSUPPORTED", null, true)).toBe(
      "PROBE_INCONCLUSIVE",
    );
  });

  it("never counts a deterministic operation as recognition throughput", () => {
    // A DEFINITION or observation request is answered deterministically with the planner at zero
    // calls. The old metric counted all nine of these as "legitimate recognition gaps we would
    // lose", which had the sign backwards.
    for (const op of ["DEFINITION", "CURRENT_OBSERVATION", "OBSERVED_CHANGE"]) {
      expect(classify("ANSWERABLE", op, "UNSUPPORTED", true, true), op).toBe(
        "DETERMINISTIC_VIA_PLANNER",
      );
      // And with no call it is unrecognised, not "answered by the planner" — review asked for the
      // distinction because the class name asserted a call that had not been observed.
      expect(classify("ANSWERABLE", op, "UNSUPPORTED", false, true), op).toBe(
        "DETERMINISTIC_NOT_RECOGNISED",
      );
    }
  });

  it("derives the deterministic set from the contracts rather than a second list", () => {
    // STORED_MECHANISM and ATTRIBUTED_REPORTED_OBSERVATION are planner-permitted, so they are
    // genuine recognition debt rather than a door mix-up.
    expect(
      classify("ANSWERABLE", "ATTRIBUTED_REPORTED_OBSERVATION", "UNSUPPORTED", false, true),
    ).toBe("TRUE_RECOGNITION_GAP");
    expect(classify("ANSWERABLE", "STORED_MECHANISM", "UNSUPPORTED", false, true)).toBe(
      "TRUE_RECOGNITION_GAP",
    );
  });
});

describe("a call that happened is a call, even when the run then failed", () => {
  it("keeps the count when the pipeline throws AFTER the planner was called", async () => {
    // REVIEW FINDING, HIGH, and it is the very defect I criticised in the old metric. `called` was
    // incremented inside the sink and then DISCARDED by the catch, which returned null. A refused
    // request that demonstrably reached the model was reported as unproven and classified as
    // not-an-exposure. Fail-open.
    const result = await countCallsDespiteFailure(async (sink) => {
      await sink();
      throw new Error("output validation rejected the plan");
    });
    expect(result.called).toBe(true);
    expect(result.threw).toContain("output validation");
  });

  it("reports no call as no call, and says the run threw", async () => {
    const result = await countCallsDespiteFailure(async () => {
      throw new Error("refused before the planner");
    });
    expect(result.called).toBe(false);
    expect(result.threw).toContain("refused before");
  });

  it("classifies a refused request that reached the planner before throwing as an exposure", () => {
    // The end-to-end consequence of the fix: the preserved `true` reaches `classify` and lands in
    // the safety count instead of vanishing into REFUSED_DOWNSTREAM.
    expect(classify("REFUSED", "AMBIGUOUS_CARDINALITY", "UNSUPPORTED", true, true)).toBe(
      "FALSE_ELIGIBILITY_EXPOSURE",
    );
  });
});
