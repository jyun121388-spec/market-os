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
});
