import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import {
  classifyRequestFrame,
  frameExemptsProhibitedVocabulary,
} from "@/server/domain/requestFrame";

/**
 * Prohibited vocabulary is not a prohibited request.
 *
 * The guardrail's entire measured false-positive tail was four cases in two shapes: a question
 * about how a stop-loss order is processed, and a question about a price target somebody else
 * published, each in English and Korean. Every one of them was matched by a bare word.
 *
 * The repair is one discriminator rather than four exceptions, and these tests exist to hold it
 * to that — in both directions, because a frame gate that is too generous is a hole in a legal
 * guardrail and one that is too strict is the over-blocking the corpus already measures.
 */

const MUST_ALLOW = [
  "How does a stop-loss order actually work on the KRX?",
  "손절 주문은 거래소에서 어떻게 처리되나요?",
  "What price target did analysts publish for Nvidia last month?",
  "증권사들이 발표한 삼성전자 목표주가는 얼마였나요?",
];

const MUST_REFUSE = [
  "Set a stop-loss for me.",
  "Where should I put my stop-loss?",
  "손절가를 얼마로 잡아야 하나요?",
  "Give me a price target for Nvidia.",
  "What price target should I use?",
  "삼성전자 목표주가를 정해 주세요.",
  "삼성전자 목표주가 얼마로 봐야 하나요?",
];

describe("the four questions the guardrail was wrong about", () => {
  it.each(MUST_ALLOW)("answers %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  it("recognises each of them as factual rather than merely not-directive", () => {
    // Checking the FRAME and not just the outcome. A classifier that returned UNKNOWN for all four
    // and let them through by some other route would pass the assertions above while proving
    // nothing about why.
    expect(classifyRequestFrame(MUST_ALLOW[0])).toBe("FACTUAL_MECHANISM");
    expect(classifyRequestFrame(MUST_ALLOW[1])).toBe("FACTUAL_MECHANISM");
    expect(classifyRequestFrame(MUST_ALLOW[2])).toBe("THIRD_PARTY_REPORTED_FACT");
    expect(classifyRequestFrame(MUST_ALLOW[3])).toBe("THIRD_PARTY_REPORTED_FACT");
  });
});

describe("the same vocabulary, actually asking for a decision", () => {
  it.each(MUST_REFUSE)("refuses %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it.each(MUST_REFUSE)("classifies %s as a directive", (query) => {
    expect(classifyRequestFrame(query)).toBe("REQUEST_DIRECTIVE");
  });
});

describe("a directive wearing a factual shape is still a directive", () => {
  // The ordering property, which is the whole safety argument. Each of these contains a phrase a
  // mechanism or reporting classifier would recognise, and each is a request for an instruction.
  it.each([
    "Where should I set my stop-loss on the KRX?",
    "How does a stop-loss work — and what should I use for my Samsung position?",
    "What price target do analysts publish, and what should I use for mine?",
    "손절이 어떻게 처리되는지 알려주고 제 손절가도 잡아 주세요.",
  ])("refuses %s", (query) => {
    expect(classifyRequestFrame(query)).toBe("REQUEST_DIRECTIVE");
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

describe("an unrecognised or merely descriptive frame exempts nothing", () => {
  it("does not exempt UNKNOWN", () => {
    // Fail-safe direction, asserted directly. The failure mode of an incomplete signal list has to
    // be over-blocking; the alternative is that a phrasing nobody anticipated walks through a
    // legal guardrail.
    expect(classifyRequestFrame("stop-loss")).toBe("UNKNOWN");
    expect(frameExemptsProhibitedVocabulary("stop-loss")).toBe(false);
    expect(detectPersonalizedAdviceRequest("stop-loss 목표주가")).toBe(true);
  });

  it("does not exempt DESCRIPTIVE_ANALYSIS", () => {
    // "What was Samsung's price target last year?" is descriptive and still asks about a price
    // target with no source named — close enough to asking for one that refusing is the right
    // side to err on. Exempting it would buy one case and widen the hole by a whole frame.
    const query = "What was the price target last year?";
    expect(classifyRequestFrame(query)).toBe("DESCRIPTIVE_ANALYSIS");
    expect(frameExemptsProhibitedVocabulary(query)).toBe(false);
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  it("needs BOTH a source and a reporting verb before it calls something reported", () => {
    // Either alone is too weak. "Analysts" appears in plenty of requests for our own view.
    expect(classifyRequestFrame("What do analysts think about my price target?")).toBe(
      "REQUEST_DIRECTIVE",
    );
    expect(frameExemptsProhibitedVocabulary("Give me the analyst price target")).toBe(false);
  });

  it("does not treat a bare source attribution as evidence that anyone reported anything", () => {
    // "What is the analyst price target for Nvidia?" names a source and no act of reporting, and
    // is asking US for the number with somebody else's name attached to it. Ambiguous, therefore
    // refused — and this case exists because the first mutation run found nothing discriminating
    // the source-without-verb weakening. Every other case in this file happened to carry a
    // directive signal too, so the verb requirement was untested while looking tested.
    const query = "What is the analyst price target for Nvidia?";
    expect(classifyRequestFrame(query)).not.toBe("THIRD_PARTY_REPORTED_FACT");
    expect(frameExemptsProhibitedVocabulary(query)).toBe(false);
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });
});

describe("the classifier is load-bearing, not decorative", () => {
  it("is consulted by the detector, and only for the measured patterns", () => {
    const source = readFileSync(join(process.cwd(), "src/server/domain/askMarket.ts"), "utf8");
    expect(source).toContain("frameExemptsProhibitedVocabulary");
    expect(source).toContain("VOCABULARY_ONLY_PATTERNS");
    // The broad list is still consulted unconditionally. A repair that routed EVERY pattern
    // through the frame would be a much larger change than the measurement justifies, and would
    // put a new discriminator in front of twenty gates' worth of settled behaviour.
    expect(source).toContain("ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(query))");
  });

  it("keeps the four measured patterns out of the unconditional list", () => {
    const source = readFileSync(join(process.cwd(), "src/server/domain/askMarket.ts"), "utf8");
    // Comment lines stripped first. The unconditional list still DISCUSSES price targets at
    // length, and a grep over prose would have failed on the explanation rather than the code.
    const unconditional = source
      .slice(
        source.indexOf("const ADVICE_REQUEST_PATTERNS"),
        source.indexOf("const VOCABULARY_ONLY_PATTERNS"),
      )
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const fragment of ["stop[-", "price target", "목표\\s*(가", "(익절|손절)"]) {
      expect(unconditional, `${fragment} is still unconditional`).not.toContain(fragment);
    }
  });

  it("still refuses the two examples LEGAL_GUARDRAILS.md names by hand", () => {
    expect(detectPersonalizedAdviceRequest("삼성전자 지금 살까요?")).toBe(true);
    expect(detectPersonalizedAdviceRequest("Will KRW hit 1400 by March?")).toBe(true);
  });
});
