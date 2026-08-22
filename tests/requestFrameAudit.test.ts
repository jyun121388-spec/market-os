import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import {
  classifyRequestFrame,
  frameExemptsProhibitedVocabulary,
  type RequestFrame,
} from "@/server/domain/requestFrame";

/**
 * An audit of the frame discriminator's structural properties, verified rather than assumed.
 *
 * `tests/requestFrame.test.ts` checks that the thing behaves correctly on the cases it was built
 * for. This file checks the eight claims the DESIGN makes about itself — the ones a reader would
 * otherwise have to take on the strength of a comment. They are different questions, and the
 * holdout result (IR-090) is a standing reminder that behaving correctly on known cases proves
 * very little.
 *
 * Each property is stated as the claim, then attacked. Where a property can be checked
 * exhaustively over the type it is, rather than sampled.
 */

const ALL_FRAMES: RequestFrame[] = [
  "REQUEST_DIRECTIVE",
  "FACTUAL_MECHANISM",
  "THIRD_PARTY_REPORTED_FACT",
  "DESCRIPTIVE_ANALYSIS",
  "UNKNOWN",
];

const askMarketSource = readFileSync(join(process.cwd(), "src/server/domain/askMarket.ts"), "utf8");
const frameSource = readFileSync(join(process.cwd(), "src/server/domain/requestFrame.ts"), "utf8");

describe("PROPERTY 1 — the directive frame is evaluated before any factual exemption", () => {
  /**
   * Adversarial by construction: every case below contains a phrase that WOULD satisfy a mechanism
   * or reporting signal, and is a request for an instruction. If the order were reversed, each
   * would be exempted by the half of itself that looks factual.
   */
  it.each([
    "How does a stop-loss work, and where should I set mine on Samsung?",
    "Explain how margin calls work and then tell me how much leverage to use.",
    "What price target did analysts publish, and what should I use for my position?",
    "Analysts published a target — give me one for my portfolio too.",
    "손절이 어떻게 체결되는지 설명하고 제 손절가도 정해 주세요.",
    "증권사들이 발표한 목표주가 알려주고 제 목표가도 잡아 주세요.",
  ])("classifies as a directive despite a factual cue: %s", (query) => {
    expect(classifyRequestFrame(query)).toBe("REQUEST_DIRECTIVE");
    expect(frameExemptsProhibitedVocabulary(query)).toBe(false);
  });

  it("puts the directive check first in the source, not merely in the outcome", () => {
    // Behaviour could pass by luck if the mechanism signals happened not to fire. The ordering is
    // the property, so it is asserted as an ordering.
    const fn = frameSource.slice(frameSource.indexOf("export function classifyRequestFrame"));
    const directiveAt = fn.indexOf("DIRECTIVE_SIGNALS");
    const mechanismAt = fn.indexOf("MECHANISM_SIGNALS");
    const reportingAt = fn.indexOf("REPORTING_SOURCE");
    expect(directiveAt).toBeGreaterThan(-1);
    expect(directiveAt).toBeLessThan(mechanismAt);
    expect(directiveAt).toBeLessThan(reportingAt);
  });
});

describe("PROPERTY 2, 3, 4 — exactly two frames exempt, checked over every frame there is", () => {
  it("exempts FACTUAL_MECHANISM and THIRD_PARTY_REPORTED_FACT and nothing else", () => {
    // Exhaustive over the union rather than sampled. Adding a sixth frame without deciding whether
    // it exempts will fail here, which is the point: a new frame is a decision, not a default.
    const exempting = ALL_FRAMES.filter((frame) => {
      const source = frameSource.slice(frameSource.indexOf("const EXEMPTING_FRAMES"));
      return source.slice(0, source.indexOf("]")).includes(`"${frame}"`);
    });
    expect(exempting.sort()).toEqual(["FACTUAL_MECHANISM", "THIRD_PARTY_REPORTED_FACT"]);
  });

  it("never exempts UNKNOWN, on inputs that genuinely produce UNKNOWN", () => {
    for (const query of ["stop-loss", "목표주가", "price target 손절", "익절"]) {
      expect(classifyRequestFrame(query), query).toBe("UNKNOWN");
      expect(frameExemptsProhibitedVocabulary(query), query).toBe(false);
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });

  it("never exempts DESCRIPTIVE_ANALYSIS, on inputs that genuinely produce it", () => {
    for (const query of [
      "What was the price target last year?",
      "How much did the stop-loss threshold change?",
    ]) {
      expect(classifyRequestFrame(query), query).toBe("DESCRIPTIVE_ANALYSIS");
      expect(frameExemptsProhibitedVocabulary(query), query).toBe(false);
    }
  });
});

describe("PROPERTY 5, 6 — the exemption reaches only the four vocabulary-only patterns", () => {
  it("is joined to VOCABULARY_ONLY_PATTERNS and used nowhere else", () => {
    // Call sites, not mentions. The first version of this counted every occurrence and failed on
    // the docstring that explains the property — the same mistake as grepping prose for a pattern
    // name, made twice in two days.
    const callSites = askMarketSource
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => line.includes("frameExemptsProhibitedVocabulary("));
    expect(callSites).toHaveLength(1);
    expect(askMarketSource).toContain(
      "VOCABULARY_ONLY_PATTERNS.some((pattern) => pattern.test(query)) &&\n    !frameExemptsProhibitedVocabulary(query)",
    );
  });

  it("holds exactly four patterns, so the exemption's blast radius is countable", () => {
    const block = askMarketSource.slice(
      askMarketSource.indexOf("const VOCABULARY_ONLY_PATTERNS"),
      askMarketSource.indexOf("];", askMarketSource.indexOf("const VOCABULARY_ONLY_PATTERNS")),
    );
    const literals = block.split("\n").filter((line) => /^\s*\/.*\/[a-z]*,\s*$/.test(line));
    expect(literals).toHaveLength(4);
  });

  it("cannot exempt a query that the broad list matches", () => {
    // The property that keeps the other 162 patterns unchanged: a perfect factual frame does not
    // rescue a query the unconditional list has already refused. Each of these has an explanatory
    // frame AND matches a pattern outside the four.
    for (const query of [
      "How does it work — should I buy Samsung Electronics right now?",
      "Explain how rebalancing works and how should I rebalance my portfolio?",
      "손절이 어떻게 처리되는지 설명하고 삼성전자 지금 살까요?",
    ]) {
      expect(detectPersonalizedAdviceRequest(query), query).toBe(true);
    }
  });

  it("leaves the unconditional list unconditional in the source", () => {
    expect(askMarketSource).toContain(
      "if (ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(query))) return true;",
    );
  });
});

describe("PROPERTY 7 — a reported fact needs a source AND a reporting act", () => {
  it("does not accept a source alone", () => {
    for (const query of [
      "What is the analyst price target for Nvidia?",
      "Any consensus price target?",
      "증권사 목표주가는?",
    ]) {
      expect(classifyRequestFrame(query), query).not.toBe("THIRD_PARTY_REPORTED_FACT");
      expect(frameExemptsProhibitedVocabulary(query), query).toBe(false);
    }
  });

  it("does not accept a reporting act alone", () => {
    for (const query of ["What price target was published?", "발표된 목표주가는 얼마인가?"]) {
      expect(classifyRequestFrame(query), query).not.toBe("THIRD_PARTY_REPORTED_FACT");
    }
  });

  it("accepts the two together", () => {
    expect(
      classifyRequestFrame("What price target did analysts publish for Nvidia last month?"),
    ).toBe("THIRD_PARTY_REPORTED_FACT");
    expect(classifyRequestFrame("증권사들이 발표한 삼성전자 목표주가는 얼마였나요?")).toBe(
      "THIRD_PARTY_REPORTED_FACT",
    );
  });

  it("requires both in the source, not either", () => {
    expect(frameSource).toContain("REPORTING_SOURCE.test(query) && REPORTING_VERB.test(query)");
    expect(frameSource).toContain(
      "REPORTING_SOURCE_KO.test(query) && REPORTING_VERB_KO.test(query)",
    );
  });
});

describe("PROPERTY 8 — a first-person or directive cue dominates a factual one", () => {
  it.each([
    ["for me", "How do circuit breakers work — pick a stop level for me."],
    ["should I", "Analysts published targets; should I use one?"],
    ["my position", "Explain short squeezes, then size my position."],
    ["Korean 주세요", "공매도 제도 설명하고 제 계좌 손절가 정해 주세요."],
    ["Korean 해야 하나요", "증권사가 발표한 목표주가 기준으로 제가 매도해야 하나요?"],
  ])("%s beats the factual cue in the same sentence", (_label, query) => {
    expect(classifyRequestFrame(query)).toBe("REQUEST_DIRECTIVE");
  });
});

describe("the audit's own honesty", () => {
  it("records that these properties are about the design, not about coverage", () => {
    // Stated in a test so it cannot be lost: every property above can hold while the guardrail
    // misses 81% of prohibited requests, which is exactly what the fresh holdout measured
    // (IR-090). A well-formed discriminator wired to 4 of 166 patterns is well-formed and narrow.
    // Do not read a green run here as evidence about recall.
    // The FIRST run of holdout 1, which is the only unbiased measurement that corpus will ever
    // produce. Deliberately not the post-repair run: pointing this at a number that improves
    // whenever the guardrail improves would turn the reminder into a moving target.
    const result = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/evaluation/holdout1-first-run-before-repair.json"),
        "utf8",
      ),
    );
    expect(result.classification).toBe("FRESH_HOLDOUT");
    expect(result.falseNegatives).toBeGreaterThan(50);
  });
});
