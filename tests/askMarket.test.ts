import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";

describe("detectPersonalizedAdviceRequest", () => {
  it("catches the LEGAL_GUARDRAILS.md canonical example (Korean)", () => {
    expect(detectPersonalizedAdviceRequest("삼성전자 지금 살까?")).toBe(true);
  });

  it("catches an English equivalent", () => {
    expect(detectPersonalizedAdviceRequest("Should I buy Samsung Electronics now?")).toBe(true);
  });

  it("catches sell requests", () => {
    expect(detectPersonalizedAdviceRequest("Should I sell my Tesla position?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("매도 타이밍인가요?")).toBe(true);
  });

  it("catches allocation and guaranteed-return requests", () => {
    expect(detectPersonalizedAdviceRequest("What should I allocate to bonds?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Is there a guaranteed return here?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("삼성전자에 얼마나 투자해야 하나요?")).toBe(true);
  });

  it("catches definitive price-target requests", () => {
    expect(detectPersonalizedAdviceRequest("Will USD/KRW hit 1400 by March?")).toBe(true);
  });

  it("does NOT flag a legitimate factual question", () => {
    expect(detectPersonalizedAdviceRequest("What is driving inflation right now?")).toBe(false);
    expect(detectPersonalizedAdviceRequest("Samsung Electronics revenue trend")).toBe(false);
    expect(detectPersonalizedAdviceRequest("한국은행 기준금리 현황")).toBe(false);
  });

  it("does NOT flag a question that merely mentions buying/selling in a factual context", () => {
    expect(
      detectPersonalizedAdviceRequest("How does the Fed's bond buying program affect yields?"),
    ).toBe(false);
  });

  it("P1: catches bypass phrasings not adjacent to the verb", () => {
    expect(detectPersonalizedAdviceRequest("Buy Tesla now, seriously")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Sell my whole ETF position right now")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I purchase more Nvidia?")).toBe(true);
  });

  it("P1: catches buy-or-sell / worth-buying / recommendation phrasings", () => {
    expect(detectPersonalizedAdviceRequest("Samsung Electronics — buy or sell?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Is this ETF worth buying?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Can you recommend a stock to buy this week?")).toBe(
      true,
    );
  });

  it("P1: catches Korean bypass phrasings without an explicit '지금'", () => {
    expect(detectPersonalizedAdviceRequest("삼성전자 살까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("이 ETF 사도 될까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("추천 종목 하나만 알려주세요")).toBe(true);
  });

  // 2026-08-17 guardrail audit. Each case below is a phrasing a real user would plausibly type
  // that the detector previously let through. "Price target" is the most serious of them: price
  // targets are named explicitly in LEGAL_GUARDRAILS.md's hard-prohibitions list, and only the
  // "target price" word order was covered.
  it("catches price-target requests in either word order and in Korean", () => {
    expect(detectPersonalizedAdviceRequest("What's your price target for AAPL?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Apple target price?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("삼성전자 목표가 알려줘")).toBe(true);
    expect(detectPersonalizedAdviceRequest("목표 주가가 얼마인가요?")).toBe(true);
  });

  it("catches 'should I invest' with no object, and hold/exit phrasings", () => {
    // `should i (…|invest in|…)` required an object, so the bare form slipped through.
    expect(detectPersonalizedAdviceRequest("Should I invest?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I hold?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I take profits here?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I cut my losses on this one?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Hold or sell?")).toBe(true);
  });

  it("catches entry/exit-timing and position-sizing phrasings", () => {
    expect(detectPersonalizedAdviceRequest("Is now a good time to get in?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I add to my position?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Should I trim my holding?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("How much of my portfolio should be in tech?")).toBe(
      true,
    );
    expect(detectPersonalizedAdviceRequest("Best stocks to buy this year?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("What would you buy right now?")).toBe(true);
  });

  it("catches Korean take-profit / stop-loss / entry / weighting phrasings", () => {
    expect(detectPersonalizedAdviceRequest("지금 익절할까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("손절해야 하나요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("지금 들어가도 될까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("반도체 비중 조절해야 할까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("지금이 사기 좋은 때인가요?")).toBe(true);
  });

  // These two were named as known open bypasses in docs/CODEX_REVIEW_PACKET.md's guardrail
  // section — written down as suggested reviewer inputs rather than fixed. Closing them here
  // means a re-reviewer finds them already handled instead of confirming a documented hole.
  it("catches the bypasses the Codex packet named as still-open", () => {
    expect(detectPersonalizedAdviceRequest("would now be a wise time to add to my position")).toBe(
      true,
    );
    expect(detectPersonalizedAdviceRequest("is Samsung Electronics a buy right now")).toBe(true);
    // The proximity rule happened to catch the "right now" variant; the bare third-person
    // framing needed its own pattern.
    expect(detectPersonalizedAdviceRequest("is Samsung Electronics a buy")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Is TSLA a sell?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("thinking about adding to my position in AAPL")).toBe(
      true,
    );
    expect(detectPersonalizedAdviceRequest("any thoughts on whether to increase my stake")).toBe(
      true,
    );
  });

  // The detector deliberately favours false positives, but it still has to leave real analytical
  // questions alone — a guardrail that redirects everything is indistinguishable from a broken
  // product, and would push users toward tools with no guardrail at all. Each case below shares
  // vocabulary with a pattern above ("target", "hold", "exit", "position", "buying") and must
  // still pass through.
  it("still does NOT flag analytical questions that use nearby vocabulary", () => {
    expect(detectPersonalizedAdviceRequest("What is the Fed's inflation target?")).toBe(false);
    expect(detectPersonalizedAdviceRequest("How did Apple's revenue trend last year?")).toBe(false);
    expect(detectPersonalizedAdviceRequest("Which sectors hold the most debt?")).toBe(false);
    expect(detectPersonalizedAdviceRequest("Is the exit of foreign capital continuing?")).toBe(
      false,
    );
    expect(
      detectPersonalizedAdviceRequest("How large is the position of foreign investors in KOSPI?"),
    ).toBe(false);
    expect(detectPersonalizedAdviceRequest("반도체 업종 실적 추이")).toBe(false);
    expect(detectPersonalizedAdviceRequest("한국은행 기준금리 인상 배경")).toBe(false);
  });
});
