import { describe, expect, it } from "vitest";
import type { AskMarketResult } from "@/server/domain/askMarket";
import { verify } from "@/server/verify/evaluate";
import { verificationInputFromAskMarket } from "@/server/verify/fromAskMarket";

/**
 * Verify against the third real output shape, and the first that is not arithmetic.
 *
 * `adversarial_resilience` had never done any work. It returned NOT_APPLICABLE for every
 * calculation — correctly, a period-over-period change recommends nothing — and
 * INSUFFICIENT_EVIDENCE for everything else. Technically honest, and it meant the dimension named
 * after this project's largest legal risk had never once been pointed at output that could
 * actually carry it.
 *
 * Ask Market is the only path that can. It takes a free-text question and answers with a curated
 * set of figures, and the question can be "should I buy this".
 */

const answer = (over: Partial<AskMarketResult> = {}): AskMarketResult => ({
  status: "FACTORS_FOUND",
  query: "Apple Inc",
  seriesFactors: [],
  causalFactors: [],
  companyFacts: [
    {
      concept: "Revenues",
      sourceCode: "SEC_EDGAR",
      fiscalPeriod: "Q3",
      fiscalYear: 2026,
      periodStart: "2026-03-29",
      periodEnd: "2026-06-27",
      unit: "USD",
      value: 109_417_000_000,
      form: "10-Q",
    },
  ],
  ...over,
});

describe("verificationInputFromAskMarket", () => {
  it("produces no claim for an answer that shows nothing", () => {
    // NOT_FOUND puts no figure in front of anyone. A verdict over an absent output would be
    // assurance about nothing — the same reason the Filing Diff adapter skips INSUFFICIENT_DATA.
    expect(
      verificationInputFromAskMarket(
        answer({ status: "NOT_FOUND", companyFacts: [], seriesFactors: [], causalFactors: [] }),
      ),
    ).toBeNull();
  });

  it("types the answer as FACT, because nothing in it was derived", () => {
    const input = verificationInputFromAskMarket(answer());
    expect(input?.claimType).toBe("FACT");
    // Calling it a CALCULATION would misstate where the numbers came from, which is exactly what
    // provenance_integrity exists to catch.
    expect(verify(input!).dimensions.provenance_integrity.status).toBe("PASS");
  });

  it("puts every rendered line in front of the dimension, not a summary of them", () => {
    const input = verificationInputFromAskMarket(
      answer({
        causalFactors: [
          {
            fromVariable: "policy rate",
            toVariable: "equity valuation",
            direction: "NEGATIVE",
            confidence: "MEDIUM",
            mechanism: "discount rates rise",
            lag: "1-2 quarters",
            counterexamples: "1990s",
          },
        ],
      }),
    );
    expect(input?.advice?.figureCount).toBe(2);
    expect(input?.advice?.renderedText.join(" ")).toContain("policy rate");
  });
});

describe("adversarial_resilience, finally doing something", () => {
  it("passes a plain factor list", () => {
    const result = verify(verificationInputFromAskMarket(answer())!);
    expect(result.dimensions.adversarial_resilience.status).toBe("PASS");
  });

  /**
   * The control that matters most, and the one a naive detector fails.
   *
   * This is the product's REAL refusal message, verbatim. It contains the words "buy/sell
   * recommendations" — as a negation. A detector that cannot read a negation would condemn the
   * exact sentence that does the refusing, and the fix for that would be to weaken the detector,
   * which is how a guardrail quietly becomes decorative.
   */
  it("does not flag the refusal message for describing what it refuses to do", () => {
    const redirect =
      "Market OS doesn't give personalized buy/sell recommendations. Here's a factor analysis " +
      "instead — the economic and company variables currently relevant to this topic, sourced " +
      "from tracked data, for you to interpret yourself.";
    const result = verify(
      verificationInputFromAskMarket(
        answer({ status: "PERSONALIZED_ADVICE_REDIRECTED", redirectMessage: redirect })!,
      )!,
    );
    expect(result.dimensions.adversarial_resilience.status).toBe("PASS");
    expect(result.dimensions.adversarial_resilience.rationale).toContain("Declines to advise");
  });

  it.each([
    ["you should buy this before earnings", "an action addressed to the reader"],
    ["we recommend buying on any dip", "a recommendation"],
    ["target price $250", "a price target"],
    ["Apple carries a strong buy rating", "a rating"],
    ["guaranteed return of 12% a year", "a guarantee"],
    ["this will rise to $300 by December", "a price prediction"],
    ["애플 적정가는 250달러입니다", "a Korean fair-value claim"],
    ["삼성전자 매수 의견", "a Korean buy rating"],
  ])("fails on %s (%s)", (line) => {
    const result = verify(
      verificationInputFromAskMarket(
        answer({
          causalFactors: [
            {
              fromVariable: "x",
              toVariable: "y",
              direction: "POSITIVE",
              confidence: "LOW",
              mechanism: line,
              lag: "none",
              counterexamples: "none",
            },
          ],
        }),
      )!,
    );
    expect(result.dimensions.adversarial_resilience.status).toBe("FAIL");
    expect(result.verdict).toBe("REJECTED");
  });

  it.each([
    "Revenues: 109417000000 USD for 2026-06-27 (10-Q, SEC_EDGAR)",
    "policy rate → equity valuation (NEGATIVE, confidence MEDIUM): discount rates rise",
    "Market OS doesn't give personalized buy/sell recommendations.",
    "US 10Y Treasury Yield: 4.25 percent as of 2026-08-01 (FRED)",
  ])("does not fail on legitimate output: %s", (line) => {
    // Over-flagging our own output is the larger harm here, the mirror image of the request-side
    // detector, which is deliberately tuned to over-block. These four are what the product
    // actually renders.
    const result = verify(
      verificationInputFromAskMarket(
        answer({
          companyFacts: [],
          causalFactors: [
            {
              fromVariable: "a",
              toVariable: "b",
              direction: "POSITIVE",
              confidence: "LOW",
              mechanism: line,
              lag: "none",
              counterexamples: "none",
            },
          ],
        }),
      )!,
    );
    expect(result.dimensions.adversarial_resilience.status).toBe("PASS");
  });
});

describe("the shortfall nobody was told about", () => {
  /**
   * Ask Market caps company facts at ten and matching series at five. Against the real database
   * that is ten of 1428 held facts — a 99.3% shortfall with nothing on the page saying so.
   *
   * A limit is a reasonable product decision. An UNDISCLOSED limit is the SILENT_DEGRADATION
   * cluster in miniature: failure by returning less, with no signal, which is how 1000 of 2240
   * filings once read as a complete filing history. Verify has a dimension for exactly this, and
   * the adapter had been passing it nothing — so the verdict said nothing either.
   *
   * This is the shortfall we impose, not one a provider imposes, which makes it the one kind of
   * incompleteness entirely within our power to disclose.
   */
  it("reports TRUNCATED when the answer shows a fraction of what is held", () => {
    const input = verificationInputFromAskMarket(answer(), {
      companyFactsHeld: 1428,
      seriesMatchesHeld: 0,
    })!;
    expect(input.completeness).toEqual({ providerTotal: 1428, fetched: 1, truncated: true });

    const result = verify(input);
    expect(result.dimensions.data_completeness.status).toBe("FAIL");
    expect(result.verdict).toBe("TRUNCATED");
  });

  it("does not cry truncation when the answer shows everything held", () => {
    // The control. Most answers are small, and a permanent truncation warning on every one of
    // them would be worth exactly as much as no warning at all.
    const result = verify(
      verificationInputFromAskMarket(answer(), { companyFactsHeld: 1, seriesMatchesHeld: 0 })!,
    );
    expect(result.dimensions.data_completeness.status).not.toBe("FAIL");
    expect(result.verdict).not.toBe("TRUNCATED");
  });

  it("says nothing about completeness when the caller could not count", () => {
    // Absent holdings must not become "complete". An adapter with no evidence reports no evidence.
    const input = verificationInputFromAskMarket(answer())!;
    expect(input.completeness).toBeUndefined();
    expect(verify(input).dimensions.data_completeness.status).toBe("INSUFFICIENT_EVIDENCE");
  });
});
