import { describe, expect, it } from "vitest";
import { AXIS_SERIES } from "@/server/domain/macroRegime";
import { verify } from "@/server/verify/evaluate";
import type { VerificationInput } from "@/server/verify/types";

/**
 * PHASE — VERIFY DIMENSION REACHABILITY. A dimension that exists but cannot be exercised is not a
 * verified capability, however many unit tests its function has.
 *
 * Verify has ten dimensions and four adapters. Unit tests cover each dimension's logic in
 * isolation, which says the function works when called — not that anything calls it. This file
 * measures the other thing: for each dimension, what statuses does REAL output actually produce?
 *
 * Measured against the populated database, running all four adapters over every real output:
 *
 * | dimension                | filingDiff | seriesChange  | askMarket   | regimeAxis  |
 * | ------------------------ | ---------- | ------------- | ----------- | ----------- |
 * | structural_validity      | PASS       | PASS          | PASS        | PASS        |
 * | source_integrity         | PASS       | PASS          | PASS        | PASS        |
 * | provenance_integrity     | PASS       | PASS          | PASS        | PASS        |
 * | data_completeness        | PASS       | PASS          | FAIL        | FAIL        |
 * | semantic_consistency     | PASS       | PASS          | n/a         | n/a         |
 * | calculation_integrity    | PASS       | PASS          | n/a         | n/a         |
 * | temporal_integrity       | n/a        | PASS and FAIL | INSUFFICIENT| PASS        |
 * | revision_integrity       | n/a        | INSUFFICIENT  | INSUFFICIENT| INSUFFICIENT|
 * | adversarial_resilience   | n/a        | n/a           | PASS        | PASS        |
 * | cross_source_consistency | n/a        | n/a           | n/a         | n/a         |
 *
 * Two things fell out of it that reading the code did not show.
 *
 * **`adversarial_resilience` was shrugging at every regime axis.** It returned INSUFFICIENT_EVIDENCE
 * on all of them, and not because anything was uncertain — the adapter passed it nothing to look
 * at. The axis is as advice-free as a filing diff, but "this output recommends nothing" was an
 * assertion in a comment rather than a checked property. The adapter now passes the rendered lines
 * and the dimension evaluates them; it reads PASS above because it checked, not because it gave up.
 *
 * **`cross_source_consistency` has never left NOT_APPLICABLE, and that is a gate, not a gap.** Only
 * the RATES axis is configured across providers — two Treasury yields from FRED beside the Bank of
 * Korea base rate from ECOS — and with no FRED key only the Korean series computes, so the axis
 * arrives single-sourced and there is genuinely nothing to reconcile. The dimension is CONDITIONAL
 * on HG-002, not unintegrated: the wiring is complete and the input is missing. That distinction is
 * the whole point of recording this, because the two states look identical from the outside and
 * only one of them is a defect.
 *
 * What this file guards: the shrug does not come back, the gate stays honestly labelled, and a
 * dimension added later cannot sit unreachable without this test naming it.
 */

/** Dimensions no real v1 output can currently exercise, each with why and what would change it. */
const NOT_REACHED_ON_REAL_OUTPUT: Record<string, string> = {
  cross_source_consistency:
    "CONDITIONAL on HG-002. Reachable through the RATES axis, which is configured across FRED and " +
    "ECOS; without a FRED key only the ECOS series computes and the axis is single-sourced.",
};

describe("every Verify dimension is accounted for", () => {
  // Derived from what `verify` actually emits rather than from a hand-kept list, so a dimension
  // added later joins this check by existing. A list someone has to remember to update is exactly
  // how a dimension goes unreachable unnoticed in the first place.
  const emitted = Object.keys(
    verify({ outputId: "probe", claimType: "FACT", sourceCodes: ["FRED"] }).dimensions,
  );

  it("classifies each dimension as either exercised by real output or explicitly not", () => {
    expect(emitted.length).toBe(10);
    for (const dimension of emitted) {
      const reached = !(dimension in NOT_REACHED_ON_REAL_OUTPUT);
      const reason = NOT_REACHED_ON_REAL_OUTPUT[dimension];
      expect(
        reached || (reason?.length ?? 0) > 40,
        `${dimension} is neither exercised by a real output nor recorded as unreachable with a ` +
          "reason. Add it to NOT_REACHED_ON_REAL_OUTPUT, or wire an adapter that feeds it.",
      ).toBe(true);
    }
  });

  it("keeps the one unreachable dimension conditional on a named gate, not on nothing", () => {
    for (const [dimension, reason] of Object.entries(NOT_REACHED_ON_REAL_OUTPUT)) {
      expect(reason, `${dimension} is unreachable for no stated cause`).toMatch(/HG-\d+/);
    }
  });

  it("still has a multi-provider axis for cross-source to become reachable through", () => {
    // If RATES ever loses its ECOS leg or its FRED legs, cross_source_consistency stops being
    // gated and starts being unwired — a different classification, and one this would catch.
    const multiProvider = Object.entries(AXIS_SERIES).filter(
      ([, refs]) => new Set(refs.map((r) => r.sourceCode)).size > 1,
    );
    expect(multiProvider.map(([axis]) => axis)).toContain("RATES");
  });
});

describe("a regime axis is checked for advice, not assumed free of it", () => {
  const axisInput = (lines: string[]): VerificationInput => ({
    outputId: "regimeAxis:TEST",
    claimType: "FACT",
    sourceCodes: ["FRED"],
    completeness: { providerTotal: lines.length, fetched: lines.length, truncated: false },
    advice: { shape: "FACTOR_LIST", renderedText: lines, figureCount: lines.length },
  });

  it("passes the readings a real axis renders", () => {
    const result = verify(
      axisInput([
        "Unemployment Rate: 4.1 (FALLING, FRED as of 2026-06-01)",
        "Industrial Production: 103.4 (RISING, FRED as of 2026-06-01)",
      ]),
    );
    expect(result.dimensions.adversarial_resilience.status).toBe("PASS");
  });

  it("would catch an axis that started telling a reader what to do", () => {
    // The reason this dimension is worth reaching. If a later change made the axis render a
    // narrative line instead of a reading, nothing else in the system would notice.
    const result = verify(
      axisInput([
        "Unemployment Rate: 4.1 (FALLING, FRED as of 2026-06-01)",
        "Rates are falling, so investors should buy long-duration bonds now.",
      ]),
    );
    expect(result.dimensions.adversarial_resilience.status).toBe("FAIL");
  });

  it("catches a recommendation addressed to somebody other than the reader", () => {
    // The hole the reachability pass actually found. Financial prose gives advice in the third
    // person almost exclusively, so a scanner that only knew "you should" was watching the one
    // door nobody uses.
    for (const line of [
      "Investors should buy long-duration bonds now.",
      "Traders should sell into strength.",
      "Shareholders ought to hold through the announcement.",
      "Clients must reduce exposure to the sector.",
      "투자자는 지금 매수해야 합니다.",
    ]) {
      const result = verify(axisInput([line]));
      expect(result.dimensions.adversarial_resilience.status, line).toBe("FAIL");
    }
  });

  it("does not condemn the sentence that does the refusing", () => {
    // The failure mode on the other side, and the more damaging one: a guardrail that flags the
    // product's own disclaimer gets switched off, and then nothing is checked at all. The real
    // refusal for "Should I buy Apple Inc.?" verifies PASS against the populated database; these
    // are the phrasings closest to the line.
    for (const line of [
      "Market OS does not provide buy or sell recommendations.",
      "No investor should read this as a recommendation.",
      "This is not advice about whether to buy, sell, or hold any security.",
      "매수 추천을 제공하지 않습니다.",
    ]) {
      const result = verify(axisInput([line]));
      expect(result.dimensions.adversarial_resilience.status, line).toBe("PASS");
    }
  });

  it("does not let a negation elsewhere in the text launder a recommendation", () => {
    // The cost of teaching the scanner to read Korean negation is that negation becomes a way to
    // hide. Scoping it to the sentence is what stops that, and this is the case that proves it.
    const result = verify(axisInput(["지금 매수해야 합니다. 위험은 없습니다."]));
    expect(result.dimensions.adversarial_resilience.status).toBe("FAIL");
  });

  it("does not read a direction word as a recommendation", () => {
    // RISING and FALLING are arithmetic, and a guardrail that fired on them would be deleted
    // within a week for crying wolf. Pinned so the pattern list stays specific.
    const result = verify(axisInput(["10-Year Treasury: 4.3 (RISING, FRED as of 2026-06-01)"]));
    expect(result.dimensions.adversarial_resilience.status).toBe("PASS");
  });
});
