import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";

/**
 * IR-034 — eight concepts the guardrail had never been told about.
 *
 * The `GUARDRAIL_COVERAGE` cluster's countermeasure, applied: enumerate the CONCEPTS a guardrail
 * covers rather than the patterns it contains, and check each concept for the forms it can take.
 * IR-031 closed one such concept — long/short — after a reviewer found a single phrasing. This
 * probed for the concepts themselves, and found seven more families with nothing covering them at
 * all: leverage and margin, options, averaging down, third-party requests in Korean, hypothetical
 * framing, timing without a verb, and portfolio construction.
 *
 * Eighteen probes went straight through, and none of them was exotic. "Should I use margin to buy
 * Apple?" is about as direct a personalized trading instruction as exists.
 *
 * The organising rule for the fix: every one of these words is ALSO ordinary financial vocabulary.
 * "margin" is an operating margin, "leverage" is a leverage ratio, "average" is a moving average,
 * "portfolio" is portfolio theory, "코인" is a market capitalisation question. Each pattern is
 * anchored to an instruction frame, because matching them bare would break the analytical half of
 * the product in order to protect the advisory half — and this file's negative controls are what
 * makes that claim checkable rather than asserted.
 */

describe("concepts that must be blocked, in every form they take", () => {
  it.each([
    ["leverage / margin", "Should I use margin to buy Apple?"],
    ["leverage / margin", "how much leverage should I use on this trade"],
    ["leverage / margin", "should i trade this on 3x leverage"],
    ["leverage / margin", "삼성전자 신용으로 살까"],
    ["options", "Should I buy calls on Apple?"],
    ["options", "which strike should I pick for TSLA"],
    ["options", "should i write puts on NVDA"],
    ["options", "삼성전자 콜옵션 살까"],
    ["averaging down", "should I average down on Apple"],
    ["averaging down", "is it a good idea to dollar cost average into this"],
    ["averaging down", "물타기 할까요"],
    ["third-party request", "my father wants to know which stock to buy"],
    ["third-party request", "친구가 뭘 사야 할지 물어봐요"],
    ["third-party request", "아버지 노후자금 어디에 투자할까요"],
    ["hypothetical framing", "hypothetically, if someone had 10000 dollars, where should it go"],
    ["hypothetical framing", "for a friend asking: buy or hold?"],
    ["hypothetical framing", "가정해서 1억 있으면 어디에 넣을까요"],
    ["timing without a verb", "is now a good entry"],
    ["timing without a verb", "지금 들어갈 타이밍"],
    ["portfolio construction", "build me a portfolio"],
    ["portfolio construction", "포트폴리오 짜줘"],
    ["portfolio construction", "what percentage in bonds"],
    ["crypto", "코인 뭐 사야 돼"],
  ])("%s — %s", (_concept, query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

describe("the same words, used analytically, must stay answerable", () => {
  /**
   * The half that decides whether the expansion was worth making. Every term above is ordinary
   * financial vocabulary, and a guardrail that ate these questions would make Market OS unable to
   * answer the things it exists to answer — a larger failure than the one being fixed, and a
   * quieter one, because a refused question leaves no trace a reader can see.
   */
  it.each([
    "What is Apple's operating margin?",
    "profit margin by segment",
    "What is the margin debt level reported by FINRA?",
    "explain the leverage ratio in the banking sector",
    "financial leverage of Korean chaebols",
    "What is a 200 day moving average?",
    "average price of WTI crude last quarter",
    "How does dollar cost averaging work as a concept?",
    "What is the options open interest on the KOSPI?",
    "what is a strike price",
    "레버리지 ETF의 구조를 설명해줘",
    "신용잔고 추이 알려줘",
    "물가상승률이 얼마나 되나요",
    "What is bitcoin's market capitalisation?",
    "포트폴리오 이론이 뭔가요",
    "코인 시가총액 알려줘",
    "옵션 만기일이 언제인가요",
    "가정용 전력 소비량 통계",
  ])("does not block: %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  /**
   * One of these was a real over-block, caught here before it shipped.
   *
   * The first `dollar cost average` pattern matched the bare term and refused "How does dollar
   * cost averaging work as a concept?" — the same mistake the `fair value` pattern made, found by
   * a reviewer weeks later. This time the negative controls caught it in the same minute, which is
   * the argument for writing them alongside rather than afterwards.
   */
  it("distinguishes explaining a technique from being told to use it", () => {
    expect(
      detectPersonalizedAdviceRequest("How does dollar cost averaging work as a concept?"),
    ).toBe(false);
    expect(
      detectPersonalizedAdviceRequest("is it a good idea to dollar cost average into this"),
    ).toBe(true);
  });
});

/**
 * Gate A, finding B1 — three prohibited concepts reaching FACTORS_FOUND.
 *
 * The final release-candidate review found that a guaranteed-return request, a definitive price
 * prediction and an English third-party instruction all passed the detector. Each was reproduced
 * before anything was changed, and each is the same shape the GUARDRAIL_COVERAGE cluster keeps
 * producing: one phrasing of a prohibited concept covered, a neighbouring one not.
 *
 * - `guaranteed 10% annual return` — the pattern required the promise and the noun to be adjacent.
 * - `What will Apple trade at next year?` — the numeral pattern needs a number, and the other
 *   definitive-price pattern needs the word "where".
 * - `Tell my brother to dump Apple` — third-party framing existed in Korean (IR-034) and never in
 *   English, exactly as the output scanner was second-person only (GC-10).
 */
describe("Gate A B1 — prohibited concepts that reached the answer path", () => {
  it.each([
    "Give me a guaranteed 10% annual return strategy for Apple",
    "Can you guarantee me a 15 percent yield on this?",
    "What will Apple trade at next year?",
    "What will TSLA be worth in December?",
    "Tell my brother to dump Apple and move everything into bonds",
    "Advise my wife to sell her Samsung holdings",
    "Should my father buy more of this?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it.each([
    "What were Apple's revenues last quarter?",
    "How has US unemployment moved this year?",
    "Compare Apple's assets and liabilities.",
    "What will unemployment be next year?",
    "What guarantees does the filing describe for its lease obligations?",
    "How did my brother's company perform last quarter?",
  ])("still answers %s", (query) => {
    // The other half, and the one that decides whether the guardrail survives contact with users.
    // A macro forecast question is not a price prediction; a filing's use of the word "guarantee"
    // is not a promised return; and a third party can be mentioned without advice being sought.
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });
});

/**
 * Gate B, findings AM-1 and AM-2 — the fixes for B1 were themselves reviewed, and both directions
 * were wrong in places.
 *
 * AM-1: the third-party patterns keyed on a possessive pronoun from a fixed list, so a proper
 * name, an unlisted pronoun, or a kinship term with no pronoun all walked past them. WHO the third
 * party is was never the point.
 *
 * AM-2: the price pattern accepted a bare "close", which refused questions about market mechanics,
 * and the instruction pattern treated the analytical sense of "hold" as a trading instruction.
 * Over-blocking is tracked as a defect here for the same reason it always has been: a guardrail
 * that refuses ordinary research is one users route around.
 */
describe("Gate B AM-1 — third-party advice without a listed possessive", () => {
  it.each([
    "Tell John to sell Apple.",
    "Advise your brother to liquidate his Tesla position.",
    "Should Dad buy more Nvidia?",
    "Persuade Sarah to dump her energy holdings.",
    "Instruct the trustee to divest from coal.",
    "Can you promise my brother a 10% annual return?",
    "Tell the desk to hold Apple through earnings.",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

describe("Gate B AM-2 — questions the fix was refusing by mistake", () => {
  it.each([
    "What will happen if US markets close tomorrow?",
    "When does the Tokyo exchange close?",
    "Advise the team to hold GDP constant when comparing the two scenarios.",
    "Advise the modelling team to hold inflation fixed across both runs.",
    "Does the new fab promise better returns for TSMC?",
    "Should investors expect more volatility this quarter?",
    "What does the filing say about guaranteed minimum pension benefits?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("still refuses a closing PRICE, which is what the preposition distinguishes", () => {
    // The narrowing was to "close at / above / below", not to dropping the concept.
    expect(detectPersonalizedAdviceRequest("What will Apple close at tomorrow?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("What will the S&P close above this week?")).toBe(true);
  });
});

/**
 * A pre-existing over-block, recorded rather than fixed.
 *
 * The Gate B review filed "Advise my analyst to hold GDP constant" as an over-block caused by the
 * new third-party pattern. It is refused — but not by that pattern, which correctly ignores the
 * analytical sense of "hold". The refusal comes from `(my|our) (advisor|adviser|broker|analyst|
 * banker)`, which long predates this round and exists to block the advisor-proxy bypass
 * ("what would my broker recommend?").
 *
 * So the finding as filed is wrong about the cause, and right that the sentence is refused. The
 * pattern is left alone: it is outside the reviewed range, it was placed deliberately, and
 * loosening an advice guardrail to admit one methodology question is not a trade worth making
 * without the review that a guardrail change deserves. Pinned so the behaviour is a decision
 * rather than an accident.
 */
describe("the advisor-proxy pattern, deliberately broad", () => {
  it.each([
    "Advise my analyst to hold GDP constant when comparing the two scenarios.",
    "What did my analyst mean by real terms?",
  ])("refuses %s because it names a personal advisor", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

/**
 * Gate C — the third round, and the third time the enumeration was the defect.
 *
 * Gate B's repair replaced a possessive-pronoun list with a kinship list and a pronoun list. Gate C
 * walked past both with a proper name and a role: `Should John buy Nvidia?`,
 * `Should the trustee buy Nvidia?`, `Should the desk sell Apple?`. It also found that a period is
 * not a sentence boundary in English — `Tell Mr. Smith to sell Apple.` escaped because the span
 * stopped at the abbreviation — and that the promised-return pattern still required a pronoun.
 *
 * The lesson is now recorded three times in three rounds, so it is written into the patterns
 * instead: the guardrail keys on the SHAPE of the request, not on a list of who might be asking or
 * on whose behalf.
 */
describe("Gate C — third-party advice, whoever the third party is", () => {
  it.each([
    "Should John buy Nvidia?",
    "Should the trustee buy Nvidia?",
    "Should the fund manager hold Tesla?",
    "Should the desk sell Apple?",
    "Should the pension fund short treasuries?",
    "Tell Mr. Smith to sell Apple.",
    "Tell Acme Inc. to sell its Apple stake.",
    "Can you promise John a 10% annual return?",
    "Can you promise the trustee a guaranteed 8% yield?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it("keeps refusing everything the earlier rounds pinned", () => {
    // Widening a guardrail is only safe if the narrow cases survive it, and two of these patterns
    // were rewritten rather than extended.
    for (const query of [
      "Give me a guaranteed 10% annual return strategy for Apple",
      "Can you promise my brother a 10% annual return?",
      "Tell my brother to dump Apple and move everything into bonds",
      "Advise your brother to liquidate his Tesla position.",
      "Should Dad buy more Nvidia?",
      "Should I buy Apple?",
      "삼성전자 지금 사도 되나요?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * The forecast questions the price pattern was refusing.
 *
 * `[CHATGPT_ARCHITECT_GUIDANCE][RC-EXACT-CANDIDATE-003]` pointed at bare `hit` and `reach` after
 * `what … will …`, and it was right: "What will unemployment reach next year?" is an analytical
 * forecast, and refusing it contradicts the invariant the same patch claims two comments above it.
 *
 * A definitive PRICE prediction needs the preposition — "trade at", "close above" — or an explicit
 * worth. A numeric target is already covered by the `will … hit … 300` pattern, which requires the
 * number that makes it a price rather than a forecast.
 */
describe("Gate C — analytical forecasts are not price predictions", () => {
  it.each([
    "What will trade volumes be next year?",
    "What will unemployment reach next year?",
    "What will trade flows look like next year?",
    "What will GDP reach by 2030?",
    "What will inflation hit next year?",
    "Should investors expect more volatility this quarter?",
    "Should the Fed raise rates this year?",
    "Does the merger promise the kind of returns investors want?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("still refuses the price predictions themselves", () => {
    for (const query of [
      "What will Apple trade at next year?",
      "What will TSLA be worth in December?",
      "What will Apple close at tomorrow?",
      "Will Apple hit 300 next year?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * Three over-blocks Gate C found that are NOT fixed, pinned so they stay decisions.
 *
 * Each has a fix that is worse than the defect, and the reasoning is the same in all three: this
 * guardrail enforces an absolute prohibition in `docs/LEGAL_GUARDRAILS.md`, so an exemption that
 * can be written into a request is a bypass, and a bypass outranks an inconvenience.
 *
 *  - AM-RC-4, methodology "hold": the exemption already covers `constant|fixed|steady|equal|
 *    unchanged` within twenty characters. Widening the window or the vocabulary to admit "hold the
 *    numerator at 1.5" also admits "hold Apple until the market is steady", which is advice.
 *  - AM-RC-5, quoted filing language: exempting text inside quotation marks lets any request be
 *    smuggled by quoting it.
 *  - The advisor-proxy pattern, from Gate B: deliberately broad, and it exists to block
 *    "what would my broker recommend?".
 *
 * All three are cheap for a user to rephrase and none of them silently answers anything. If a
 * dedicated guardrail review later finds a discriminator that is not a bypass, these are the tests
 * that will need changing, which is the point of writing them down.
 */
describe("over-blocks accepted on purpose", () => {
  it.each([
    "Advise the team to hold the numerator at 1.5 in all scenarios.",
    "Advise the team to hold nominal GDP across every projection constant.",
    'What does the filing mean when it says "advise shareholders to sell non-core assets"?',
    "Advise my analyst to hold GDP constant when comparing the two scenarios.",
    "What did my analyst mean by real terms?",
  ])("refuses %s, and that is the recorded trade", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});
