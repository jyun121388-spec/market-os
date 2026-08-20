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
    "Should the trustee buy Nvidia?",
    "Should the fund manager hold Tesla?",
    "Should the desk sell Apple?",
    "Tell Mr. Smith to sell Apple.",
    "Tell Acme Inc. to sell its Apple stake.",
    "Can you promise John a 10% annual return?",
    "Can you promise the trustee a guaranteed 8% yield?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it("leaves institutions out of the person-like subject list, on purpose", () => {
    // "Should the pension fund short treasuries?" was asserted here for one round, speculatively,
    // and it collided with "How much should a pension fund invest in bonds under Korean
    // regulation?" — a regulation question that must answer. Nothing in either sentence separates
    // an institution asking for a recommendation from a question about how institutions behave.
    // The person-like subject list therefore stops at people and at those acting for a person, and
    // this records that as a chosen boundary rather than an oversight.
    expect(detectPersonalizedAdviceRequest("Should the pension fund short treasuries?")).toBe(
      false,
    );
    expect(
      detectPersonalizedAdviceRequest(
        "How much should a pension fund invest in bonds under Korean regulation?",
      ),
    ).toBe(false);
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

/**
 * Gate D — the round where the fix for the previous round was the defect.
 *
 * Gate C replaced an enumerated `should <person> <verb>` rule with a general
 * `should <anything> <verb>` one. A self-attack written before the reviewer reported refused ten
 * ordinary research questions out of ten: monetary policy, accounting treatment, index mechanics,
 * regulation. The verb was supposed to be the discriminator and it is not one — "hold", "short"
 * and "invest" are ordinary words outside a trading context.
 *
 * So the generalisation is reverted and the enumeration is back, extended with exactly what
 * Gate C proved missing: proper names and investor roles. Gate B's original objection to
 * generalising was right, and the note recorded against it in Gate C was wrong.
 *
 * The rest of this round came from Gate D itself: a description long enough to outrun the span
 * ("my elderly retired father with a low risk tolerance"), a promised return with no numeral
 * ("double-digit annual returns"), and a price question with no numeral ("What high will Apple
 * hit next year?").
 */
describe("Gate D — research questions the generalisation was refusing", () => {
  it.each([
    "Should the Fed hold rates steady at the next meeting?",
    "Should the board hold a special meeting?",
    "How should a company hold treasury shares on its balance sheet?",
    "Why should the ECB buy government bonds under QE?",
    "When should a company invest in capex rather than buy back stock?",
    "Should companies invest more in R&D during a downturn, historically?",
    "What should a 10-K disclose about short positions?",
    "Should the index hold a company after a delisting notice?",
    "How much should a pension fund invest in bonds under Korean regulation?",
    "Should short interest be reported semi-monthly?",
    "Why should investors hold long-duration bonds when rates fall?",
    "The prospectus promises a 5 year lock-up, not a return.",
    "Analysts promise nothing about future gains in this filing.",
    "The acquisition promises shareholders a higher return on equity.",
    "What level will unemployment reach next year?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });
});

describe("Gate D — requests the narrower rules must still catch", () => {
  it.each([
    "Should my elderly retired father with a low risk tolerance sell Apple?",
    "Can you promise John double-digit annual returns?",
    "What high will Apple hit next year?",
    "What price will Apple reach by December?",
    "Should the trustee buy Nvidia?",
    "Should the desk sell Apple?",
    "Should the fund manager hold Tesla?",
    "Should Dad buy more Nvidia?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

/**
 * Two more accepted costs, recorded rather than fixed.
 *
 * RC4-SPAN-1: the instruction span no longer stops at a period, which is what closed the
 * "Tell Mr. Smith to sell Apple." bypass. The price is that a second sentence beginning with an
 * infinitive can be read as the continuation of the first. Bounding on periods again would reopen
 * a P1; every alternative needs an abbreviation list, and that list is a bypass surface too.
 *
 * The index-level gap is the opposite kind of note — a coverage GAP, not a decision to over-block.
 * "What level will the S&P 500 reach next year?" is a price prediction and is not refused, because
 * nothing in the sentence distinguishes it from "What level will unemployment reach next year?"
 * without knowing whether the subject is an instrument or an indicator. Refusing macro forecasts is
 * the worse error of the two. It is asserted here so the gap is visible and dated, not to bless it.
 */
describe("Gate D — costs and gaps carried forward", () => {
  it("reads an infinitive second sentence as part of the instruction", () => {
    expect(
      detectPersonalizedAdviceRequest(
        "Advise investors on duration risk. To sell bonds before maturity can crystallize losses.",
      ),
    ).toBe(true);
  });

  it("catches an index level, now that the subject is what it keys on", () => {
    // This assertion used to say the opposite, and was labelled a known gap on the grounds that
    // nothing separated "What level will the S&P 500 reach?" from "What level will unemployment
    // reach?". The separation is the SUBJECT, and unlike personal names the major indices are a
    // closed, stable set that no economic indicator shares a name with. Gate E pointed out that a
    // gap being honestly labelled does not stop it being a gap.
    expect(detectPersonalizedAdviceRequest("What level will the S&P 500 reach next year?")).toBe(
      true,
    );
    expect(detectPersonalizedAdviceRequest("What level will the Nasdaq hit next year?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("What value will the KOSPI reach by December?")).toBe(
      true,
    );
    // ...and the indicator forecast it was traded against still answers.
    expect(detectPersonalizedAdviceRequest("What level will unemployment reach next year?")).toBe(
      false,
    );
  });
});

/**
 * Gate E — a capital letter marks a proper noun, not a person.
 *
 * Gate D added `should <Capitalised> <trading verb>`, matched case-sensitively, to catch
 * "Should John buy Nvidia?". A self-attack run before the review returned found what that costs in
 * a product whose users ask about capitalised companies all day:
 *
 *     Should Apple buy Nvidia?              — an M&A question
 *     Should Samsung sell its display unit? — a corporate action
 *     Should Tesla invest in a new gigafactory?
 *     Should Europe invest in LNG terminals?
 *     Should Congress buy down the deficit?
 *
 * All five were refused. Those are not edge cases; they are close to the centre of what this
 * product is for, and refusing them is a worse failure than missing a phrasing.
 *
 * The name alone is therefore not enough. What separates a person from a company in these
 * sentences is the possessive that follows: people get "his" and "her", companies get "its".
 */
describe("Gate E — capitalised subjects that are companies, countries or institutions", () => {
  it.each([
    "Should Apple buy Nvidia?",
    "Should Samsung sell its display unit?",
    "Should Tesla invest in a new gigafactory?",
    "Should Berkshire hold its Apple stake?",
    "Should Korea invest more in semiconductors?",
    "Should Congress buy down the deficit?",
    "Should Europe invest in LNG terminals?",
    "Should companies buy back stock in a downturn?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("still refuses a named person with a personal possessive", () => {
    expect(detectPersonalizedAdviceRequest("Should Sarah sell her Tesla shares?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should David buy more of his Apple position?")).toBe(
      true,
    );
  });
});

/**
 * The methodology sense of "hold", again — this time behind a possessive.
 *
 * "Should my model hold the discount rate fixed across all three scenarios?" was refused, because a
 * possessive was treated as evidence that the subject is a person. "My model" and "my analysis"
 * take one as readily as "my father" does, so the exemption that already applies to the
 * instruction patterns applies here too.
 */
describe("Gate E — a possessive does not make the subject a person", () => {
  it.each([
    "Should my model hold the discount rate fixed across all three scenarios?",
    "Should my analysis of the semiconductor cycle include capex or just revenue?",
    "Should our forecast hold inflation constant?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("still refuses the personalised requests the possessive rule exists for", () => {
    for (const query of [
      "Should my elderly retired father with a low risk tolerance sell Apple?",
      "Should my father buy more of this?",
      "Should my wife hold her Samsung shares?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * A GAP, recorded as a gap.
 *
 * "Should John buy Nvidia?" is a request for advice about a named person and it is NOT refused.
 * Gate C filed it as a P1 and Gate D closed it with a case-sensitive proper-name rule; that rule
 * refused "Should Apple buy Nvidia?" and had to go. There is no signal in "Should John buy
 * Nvidia?" that is absent from "Should Apple buy Nvidia?" — both are a capitalised subject, a
 * trading verb and a company. A first-name list is the fifth enumeration this file would be
 * carrying, and the previous four each cost a false positive somewhere else.
 *
 * The phrasing WITH any personal marker is covered: a possessive ("Should Sarah sell her Tesla
 * shares?"), a kinship term, a role, or an instruction form ("Tell John to sell Apple.") all
 * refuse. What remains uncovered is a bare first name with no other cue.
 *
 * This assertion exists so the gap is visible and dated. It is a marker, not an endorsement.
 */
describe("Gate E — known gaps, asserted so they stay visible", () => {
  it("does not catch a bare first name with no other personal cue", () => {
    expect(detectPersonalizedAdviceRequest("Should John buy Nvidia?")).toBe(false);
    // ...while every phrasing that carries a cue still does.
    expect(detectPersonalizedAdviceRequest("Tell John to sell Apple.")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should Sarah sell her Tesla shares?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should the trustee buy Nvidia?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should Dad buy more Nvidia?")).toBe(true);
  });
});

/**
 * Gate E — the fifth round, and the first where the reviewer's answer to "is this safe to stop on"
 * was no.
 *
 * Four P1s, three of which are variations on one theme: the case-sensitive patterns added in the
 * previous round treat capitalisation as identity. `john` and `JOHN` are the same person as `John`,
 * and a reader who types in lower case is not thereby asking a different question.
 *
 * The fourth was the index-level gap. It had been recorded honestly as a gap and asserted as such,
 * and the reviewer's response was that an honest label does not stop a prohibited output being
 * produced. That was right, and the separation turned out to be available: the major indices are a
 * closed, stable set in a way that personal names are not.
 */
describe("Gate E — capitalisation is not identity", () => {
  it.each([
    "Can you promise john a 10% annual return?",
    "Can you promise JOHN a 10% annual return?",
    "What will Apple's price be next year?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

describe("Gate E — over-blocks the price and possessive rules were causing", () => {
  it.each([
    "What value will unemployment reach next year?",
    "Should our independent central bank, during a liquidity crisis, buy government bonds under QE?",
    "What will Korea's GDP be next year?",
    "The acquisition promises shareholders a higher return on equity.",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("still refuses the price questions the narrowing was protecting", () => {
    for (const query of [
      "What high will Apple hit next year?",
      "What will Apple trade at next year?",
      "Can you promise John double-digit annual returns?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * Gate F — the round where the recipient stopped being the question.
 *
 * Three rounds were spent on WHO the promise was made to: a pronoun list, then any word, then a
 * capitalised name, then a numeral standing in for the capital. Each version traded one error for
 * another, and Gate F found the next one — "Does this bond promise investors a 5% yield?" refused,
 * which is a question about contractual terms and about as ordinary as research gets.
 *
 * The recipient was never the discriminator. Who is being asked to PROMISE is:
 *
 *     Can you promise John a 10% annual return?      the system is asked to promise — prohibited
 *     Does this bond promise investors a 5% yield?   a bond promises — contractual terms
 *     The acquisition promises shareholders a ...    prose
 *
 * Keying on the subject makes lower case, capitals, names, roles and "double-digit" all work at
 * once, without a fourth list. Recorded at length because the same shape — patching the object
 * when the subject was the signal — is what four of these six rounds have been.
 */
describe("Gate F — who is being asked to promise", () => {
  it.each([
    "Can you promise John a 10% annual return?",
    "Can you promise john a 10% annual return?",
    "Can you promise JOHN a 10% annual return?",
    "Can you promise my brother a 10% annual return?",
    "Can you promise John double-digit annual returns?",
    "Promise me a 10% return.",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it.each([
    "Does this bond promise investors a 5% yield?",
    "Does the merger promise the kind of returns investors want?",
    "Does the new fab promise better returns for TSMC?",
    "The prospectus promises a 5 year lock-up, not a return.",
    "Analysts promise nothing about future gains in this filing.",
    "The acquisition promises shareholders a higher return on equity.",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });
});

/**
 * Gate F — a comma is not a change of subject.
 *
 * The previous round made commas end the possessive span, so that "Should our independent central
 * bank, during a liquidity crisis, buy government bonds under QE?" would stop being refused. That
 * fix opened a bypass in the other direction: "Should my elderly retired father, given his low
 * risk tolerance, sell Apple?" is the same request as the pinned no-comma version and was being
 * answered.
 *
 * A kinship term settles what a bare possessive can only guess at, so the kinship rule allows
 * commas and the possessive rules still do not. Both sentences now get the right answer, for a
 * reason rather than by tuning a number.
 */
describe("Gate F — appositives around a person", () => {
  it("refuses a personalised request with a descriptive clause in the middle", () => {
    expect(
      detectPersonalizedAdviceRequest(
        "Should my elderly retired father, given his low risk tolerance, sell Apple?",
      ),
    ).toBe(true);
  });

  it("still answers the policy question the comma bound was added for", () => {
    expect(
      detectPersonalizedAdviceRequest(
        "Should our independent central bank, during a liquidity crisis, buy government bonds under QE?",
      ),
    ).toBe(false);
  });
});

/**
 * Gate F — "Dow" is a company as well as an index.
 *
 * The index list added last round was case-insensitive, so "What level will the Dow Chemical
 * dividend reach next year?" matched on `dow`. The list is case-sensitive now and will not match
 * when another proper noun follows: an index name followed by a capitalised word is part of a
 * longer name.
 */
describe("Gate F — index names that are also company names", () => {
  it("answers a company question that starts with an index name", () => {
    expect(
      detectPersonalizedAdviceRequest("What level will the Dow Chemical dividend reach next year?"),
    ).toBe(false);
  });

  it("still refuses the index-level predictions", () => {
    for (const query of [
      "What level will the S&P 500 reach next year?",
      "What level will the Nasdaq hit next year?",
      "What value will the KOSPI reach by December?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * Gate G — the seventh round, on the narrowing the sixth round introduced.
 *
 * Re-keying the promise rule from recipient to subject was the right move and it narrowed what the
 * rule matches, which is exactly where to look next. A self-attack run before the review returned
 * found five forms that had escaped: the politeness a request gets wrapped in ("Would you BE ABLE
 * TO promise me…"), an adverb before the imperative ("JUST promise me…"), and the noun form that
 * never uses the verb at all ("I want a promise of 10% returns"). Gate G added a sixth — an
 * imperative opened by a comma rather than by a full stop.
 *
 * None of these needed a new list. The subject rule was right; its boundaries were too tight.
 */
describe("Gate G — the shapes a promised-return request actually takes", () => {
  it.each([
    "Would you be able to promise me a 10% return?",
    "Can you please promise me a 10% annual return?",
    "Will you promise me a 15% yield?",
    "Could you promise my brother a 10% annual return?",
    "Just promise me a 10% return.",
    "For my retirement account, promise me a 10% annual return.",
    "I want a promise of 10% returns.",
    "Can I get a promise of 12% a year in returns?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it.each([
    "Does this bond promise investors a 5% yield?",
    "Does the merger promise the kind of returns investors want?",
    "The prospectus promises a 5 year lock-up, not a return.",
    "Analysts promise nothing about future gains in this filing.",
    "The acquisition promises shareholders a higher return on equity.",
    "Can you tell me if the bond promises investors a 5% yield?",
  ])("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });
});

/**
 * Gate G — a possessive moves the subject off the person.
 *
 * The kinship rule was widened last round to span an appositive, and Gate G found what that
 * reaches: "Should my brother's COMPANY, given its strong cash balance, buy a competitor?" is
 * corporate analysis, and the span was crossing the apostrophe to find the verb. The subject of
 * "buy" is the company.
 */
describe("Gate G — whose decision is it", () => {
  it("answers a corporate question about a relative's company", () => {
    expect(
      detectPersonalizedAdviceRequest(
        "Should my brother's company, given its strong cash balance, buy a competitor?",
      ),
    ).toBe(false);
    expect(
      detectPersonalizedAdviceRequest("How did my brother's company perform last quarter?"),
    ).toBe(false);
  });

  it("still refuses advice about the relative themselves", () => {
    for (const query of [
      "Should my elderly retired father, given his low risk tolerance, sell Apple?",
      "Should my elderly retired father with a low risk tolerance sell Apple?",
      "Should my wife hold her Samsung shares?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });
});

/**
 * Gate G — an index name that continues into another capitalised word.
 *
 * The lookahead added last round to keep "Dow Chemical" answerable also stopped "S&P 500 Index",
 * "Nasdaq Composite" and "Dow Jones Industrial Average" being recognised — all of which are the
 * index, spelled out. The lookahead now lets through the words that CONTINUE an index name and
 * stops at the ones that start a company name.
 */
describe("Gate G — full index names", () => {
  it.each([
    "What level will the S&P 500 Index reach next year?",
    "What level will the Nasdaq Composite reach next year?",
    "What level will the Dow Jones Industrial Average reach next year?",
  ])("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it("still answers the company question", () => {
    expect(
      detectPersonalizedAdviceRequest("What level will the Dow Chemical dividend reach next year?"),
    ).toBe(false);
  });
});
