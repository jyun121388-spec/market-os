import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import {
  ADVICE_GUARDRAIL_CORPUS,
  type Concept,
  type CorpusCase,
} from "./fixtures/adviceGuardrailCorpus";

/**
 * Measures the guardrail instead of pinning it.
 *
 * Every other guardrail test in this repository asserts a specific phrase, and each was added
 * because somebody found that phrase failing. That records the failures already found. It cannot
 * say how many remain, and after twenty rounds of adding cases the suite looked like coverage.
 *
 * `./fixtures/adviceGuardrailCorpus` is built from the seven prohibitions in
 * `docs/LEGAL_GUARDRAILS.md` and from the questions the product exists to answer, in both
 * supported languages, written without reference to the pattern list. 117 of its 120 cases appear
 * in no existing test. This file turns it into two numbers and holds them.
 *
 * The thresholds below are ratchets, not targets: they are set at the measured value, so the rate
 * may improve freely and cannot worsen silently. Improving one of them tightens it in the same
 * commit — a ratchet nobody tightens is a ceiling.
 */

const REFUSE = ADVICE_GUARDRAIL_CORPUS.filter((c) => c.label === "MUST_REFUSE");
const ALLOW = ADVICE_GUARDRAIL_CORPUS.filter((c) => c.label === "MUST_ALLOW");

const falseNegatives = REFUSE.filter((c) => !detectPersonalizedAdviceRequest(c.query));
const falsePositives = ALLOW.filter((c) => detectPersonalizedAdviceRequest(c.query));

const list = (cases: CorpusCase[]) =>
  cases.map((c) => `[${c.concept}/${c.lang}] ${c.query}`).join("\n  ");

describe("the corpus itself", () => {
  it("is labelled and balanced enough for a rate to mean something", () => {
    expect(REFUSE.length).toBeGreaterThanOrEqual(50);
    expect(ALLOW.length).toBeGreaterThanOrEqual(50);
  });

  it("covers every hard prohibition and every legitimate category", () => {
    const seen = new Set<Concept>(ADVICE_GUARDRAIL_CORPUS.map((c) => c.concept));
    const required: Concept[] = [
      "PERSONALISED_TRADE",
      "PORTFOLIO_CONSTRUCTION",
      "AUTOMATED_TRADING",
      "GUARANTEED_RETURN",
      "PRICE_PREDICTION",
      "LOSS_PROTECTION",
      "FUND_ALLOCATION",
      "MACRO_RESEARCH",
      "COMPANY_ANALYSIS",
      "ACCOUNTING_TERM",
      "HISTORICAL_FACT",
      "POLICY_ANALYSIS",
      "MARKET_MECHANICS",
      "THIRD_PARTY_REPORTING",
    ];
    for (const concept of required) expect(seen, `no case for ${concept}`).toContain(concept);
  });

  it("asks each prohibition in both supported languages", () => {
    const prohibitions: Concept[] = [
      "PERSONALISED_TRADE",
      "PORTFOLIO_CONSTRUCTION",
      "AUTOMATED_TRADING",
      "GUARANTEED_RETURN",
      "PRICE_PREDICTION",
      "LOSS_PROTECTION",
      "FUND_ALLOCATION",
    ];
    for (const concept of prohibitions) {
      const langs = new Set(
        ADVICE_GUARDRAIL_CORPUS.filter((c) => c.concept === concept).map((c) => c.lang),
      );
      expect(langs, `${concept} is only asked in ${[...langs].join("/")}`).toEqual(
        new Set(["en", "ko"]),
      );
    }
  });

  it("has no duplicate queries, which would weight a rate toward one phrasing", () => {
    const queries = ADVICE_GUARDRAIL_CORPUS.map((c) => c.query);
    expect(new Set(queries).size).toBe(queries.length);
  });
});

describe("measured guardrail performance", () => {
  /**
   * The false-negative rate — prohibited requests the guardrail answers instead of redirecting.
   *
   * Measured at 36 of 63 when this corpus was first run on 2026-08-21 — loss protection catching
   * nothing at all, automated trading one case in six — and at 1 of 63 after the four unenforced
   * prohibitions were implemented in the same session (IR-085). Twenty review gates had worked on
   * this surface, and every one of them worked on personalised trade and price prediction, which
   * are the two that measured well. Nobody had asked about the other five.
   *
   * The one remaining miss is "How high can Nvidia go from here?", and it is deliberate. It is
   * the GAP-INDEX-LEVEL family: nothing in the sentence separates it from "How high can inflation
   * go?" without knowing whether the subject is an instrument or an indicator, and refusing macro
   * forecasts is the worse error. A pattern for it would be the enumeration this file has been
   * burned by four times. It stays open, recorded, and counted.
   *
   * Recorded as IR-085 and as measured debt in `docs/REVIEW_DEBT.md`. NOT release-critical for the
   * frozen candidate, and the reason is specific rather than reassuring: `askMarket` returns the
   * same sourced factor data either way, so a miss costs the redirect status and the disclaimer,
   * not the emission of a recommendation — the product has no LLM and cannot produce advice. It
   * becomes release-critical the moment HG-006 is approved, because then this is the request-side
   * control on a path that CAN.
   */
  it("does not answer more prohibited requests than it did when last measured", () => {
    expect(
      falseNegatives.length,
      `false negatives:\n  ${list(falseNegatives)}`,
    ).toBeLessThanOrEqual(1);
  });

  /**
   * The false-positive rate — legitimate questions redirected.
   *
   * Measured at 4 of 57. All four are the same two shapes in two languages: a stop-loss MECHANISM
   * question, and a question about a price target somebody else published. Both are cases where
   * the prohibited vocabulary appears as the subject of a factual question rather than as a
   * request, which is the distinction the subject classifier already makes for "should X buy Y"
   * and which nothing makes for these.
   *
   * Over-blocking is the smaller harm and is deliberately tolerated, but it is tolerated at a
   * measured rate rather than an unknown one.
   */
  it("does not redirect more legitimate questions than it did when last measured", () => {
    expect(
      falsePositives.length,
      `false positives:\n  ${list(falsePositives)}`,
    ).toBeLessThanOrEqual(4);
  });

  /**
   * A per-concept floor, so an overall improvement cannot hide a category going backwards.
   *
   * The aggregate rate is the number that gets quoted and it is the easiest to game: adding twenty
   * easy cases to a well-covered prohibition would improve it while nothing got safer.
   */
  it("keeps every prohibition's coverage at or above where it was measured", () => {
    const floor: Partial<Record<Concept, number>> = {
      PERSONALISED_TRADE: 18,
      PORTFOLIO_CONSTRUCTION: 10,
      AUTOMATED_TRADING: 6,
      GUARANTEED_RETURN: 8,
      PRICE_PREDICTION: 8,
      LOSS_PROTECTION: 5,
      FUND_ALLOCATION: 7,
    };
    for (const [concept, minimum] of Object.entries(floor)) {
      const cases = REFUSE.filter((c) => c.concept === concept);
      const caught = cases.filter((c) => detectPersonalizedAdviceRequest(c.query)).length;
      expect(
        caught,
        `${concept}: ${caught} of ${cases.length} caught, floor ${minimum}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("still refuses the two examples LEGAL_GUARDRAILS.md names by hand", () => {
    // These two are the specification, not a sample of it. A corpus-wide rate that improved while
    // either of these regressed would be a worse outcome than no change at all.
    expect(detectPersonalizedAdviceRequest("삼성전자 지금 살까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Will KRW hit 1400 by March?")).toBe(true);
  });
});
