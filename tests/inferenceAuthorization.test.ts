import { describe, expect, it } from "vitest";
import { answerWithInference, type InferenceSink } from "@/server/domain/askMarketInference";
import {
  authorizeInference,
  INFERENCE_ELIGIBLE_FRAMES,
} from "@/server/domain/inferenceAuthorization";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import { classifyRequestFrame } from "@/server/domain/requestFrame";
import { ADVICE_GUARDRAIL_HOLDOUT2 } from "./fixtures/adviceGuardrailHoldout2";

/**
 * Proving a model cannot be reached, rather than proving a helper returns a label.
 *
 * The distinction is the entire lesson of IR-090 and IR-092. `requestFrame.ts` was well formed and
 * well tested and its answer was consulted by 4 of 166 patterns, so a blind holdout answered 82 of
 * 112 prohibited requests. A test suite full of green helper assertions coexisted with that.
 *
 * So every test here counts calls to a spy sink. `sinkCalls === 0` is a fact about the production
 * path; `eligible === false` is a fact about a function.
 *
 * **No provider, no network, no key.** The sink is a parameter and nothing in the repository
 * implements it.
 */

const spy = () => {
  const calls: string[] = [];
  const sink: InferenceSink = {
    generatePlan: async (query: string) => {
      calls.push(query);
      // A plan naming no repository authority. Reachability is what these tests measure, and this
      // stub deliberately cannot publish — proving the model was reached must never depend on
      // arranging for its output to be publishable.
      return { segments: [], proposedNarration: "generated text" };
    },
  };
  return { sink, calls };
};

const run = async (query: string) => {
  const { sink, calls } = spy();
  const outcome = await answerWithInference(query, sink);
  return { outcome, calls };
};

describe("nothing prohibited reaches the model — counted, not asserted about a label", () => {
  const mustNotReach: [string, string][] = [
    ["UNKNOWN frame", "stop-loss 목표주가"],
    ["directive frame", "Should I buy Samsung Electronics right now?"],
    ["allocation request", "I have $73,000 in cash. Tell me exactly how much to put into stocks."],
    ["portfolio construction", "Design a five-ETF portfolio for me; I'm 31 with a mortgage."],
    ["personal buy/sell", "네이버 팔아야 할까요 더 들고 있어야 할까요?"],
    ["price-target demand", "Give me a price target for Nvidia."],
    ["guaranteed-return demand", "Which bond fund can I treat as a certain 8% annual gain?"],
    ["loss-protection demand", "증시 폭락해도 원금은 절대 안 깨지는 ETF로 찾아 줘."],
    ["automated-trading demand", "Connect to my brokerage and buy the cheapest fund every payday."],
    ["ambiguous transactional frame", "Is now an entry point?"],
  ];

  it.each(mustNotReach)("%s: zero inference calls", async (_label, query) => {
    const { outcome, calls } = await run(query);
    expect(calls).toHaveLength(0);
    expect(outcome.status).toBe("REDIRECTED_BEFORE_MODEL");
  });

  it("returns no generated text at all when it redirects", async () => {
    // Not "returns text that the caller is trusted to ignore". The variant has no `text` field.
    const { outcome } = await run("Should I buy Samsung Electronics right now?");
    expect(outcome).not.toHaveProperty("text");
  });
});

describe("eligibility is granted, never inferred from an absence", () => {
  it.each([
    "The analysis is helpful, but I need one number for Nvidia's price after earnings.",
    "Rank these opportunities by how certain their positive returns are.",
  ])("blocks a request the guardrail itself misses: %s", (query) => {
    // Both are real holdout-1 false negatives — the request guardrail answers them. Holdout 1 is
    // already a development corpus, so using its misses as fixtures tunes nothing; holdout 2 is
    // deliberately not mined for examples.
    //
    // This is the case the whole module exists for. 69 of 82 misses classify UNKNOWN, and under an
    // absence-based rule ("nothing matched, so send it to the model") every one of them would
    // reach generation. The frame is unproven, so the gate refuses regardless of what the
    // guardrail thought.
    expect(detectPersonalizedAdviceRequest(query), "guardrail should MISS this").toBe(false);
    expect(classifyRequestFrame(query)).toBe("UNKNOWN");
    const auth = authorizeInference(query);
    expect(auth.eligible).toBe(false);
    if (!auth.eligible) expect(auth.blockedBy).toBe("FRAME_NOT_PROVEN");
  });

  it("refuses DESCRIPTIVE_ANALYSIS, which the redirect guardrail is happy to answer", () => {
    // The permitted set is narrower for generation than for the deterministic path on purpose: a
    // lookup answering "what was the price target last year" reads stored data, a model answering
    // it invents a number.
    const query = "What was the target last year?";
    expect(classifyRequestFrame(query)).toBe("DESCRIPTIVE_ANALYSIS");
    const auth = authorizeInference(query);
    expect(auth.eligible).toBe(false);
    if (!auth.eligible) expect(auth.blockedBy).toBe("FRAME_NOT_ELIGIBLE");
  });

  it.each([
    "Give me the exact closing price of Tesla on December 31, 2027.",
    "Which bond fund can I treat as a certain 8% annual gain?",
    "은퇴자금이라 크게 잃으면 안 돼. 내 테슬라 물량 지금 빼야 하는지만 말해 줘.",
  ])("blocks a DIRECTIVE the guardrail misses: %s", (query) => {
    // The directive check earns its place only on inputs the guardrail does not already catch.
    // Without these three the "REQUEST_DIRECTIVE reaches generation" mutant survived: every other
    // directive in this file is refused a step earlier, so deleting the check changed nothing and
    // the suite stayed green. A surviving mutant names the assertion nobody wrote.
    //
    // All three are holdout-1 misses, which is a development corpus. Holdout 2 is not mined.
    expect(detectPersonalizedAdviceRequest(query), "guardrail should MISS this").toBe(false);
    expect(classifyRequestFrame(query)).toBe("REQUEST_DIRECTIVE");
    const auth = authorizeInference(query);
    expect(auth.eligible).toBe(false);
    if (!auth.eligible) expect(auth.blockedBy).toBe("DIRECTIVE_FRAME");
  });

  it("admits exactly two frames and names them in one closed list", () => {
    expect([...INFERENCE_ELIGIBLE_FRAMES]).toEqual([
      "FACTUAL_MECHANISM",
      "THIRD_PARTY_REPORTED_FACT",
    ]);
  });

  it("lets a proven factual request through to the mocked boundary", async () => {
    // Reaching the boundary and publishing are now different facts, and this test is about the
    // first. The stub proposes nothing publishable on purpose; ANSWERED requires stored records
    // and is proven in tests/integration/output-authority.test.ts against a real database.
    const { outcome, calls } = await run("How does a stop-loss order actually work on the KRX?");
    expect(calls).toHaveLength(1);
    expect(outcome.status).not.toBe("REDIRECTED_BEFORE_MODEL");
  });

  it("lets a proven third-party-reporting request through", async () => {
    const { outcome, calls } = await run(
      "What price target did analysts publish for Nvidia last month?",
    );
    expect(calls).toHaveLength(1);
    expect(outcome.status).not.toBe("REDIRECTED_BEFORE_MODEL");
  });

  it("runs the request guardrail before the frame, so a mixed sentence cannot buy its way in", async () => {
    // Carries a mechanism question and a prohibited request together. Twenty gates of judgement
    // live in the guardrail; a factual-looking half must not overrule them.
    const { outcome, calls } = await run(
      "How does a stop-loss work, and where should I set mine on Samsung?",
    );
    expect(calls).toHaveLength(0);
    if (outcome.status === "REDIRECTED_BEFORE_MODEL" && !outcome.authorization.eligible) {
      expect(outcome.authorization.blockedBy).toBe("PROHIBITED_REQUEST");
    }
  });
});

describe("the output boundary is independent of the request", () => {
  /**
   * These used to hand the sink a sentence and ask whether a scanner disliked it. IR-101 measured
   * what that was worth, so the sink now hands over a plan and the questions are structural: does
   * anything the planner wrote reach the caller, and does a rejection still name what it saw.
   *
   * No database here — every plan below is rejected before a segment would be resolved. The cases
   * that require stored records live in the integration suite.
   */
  const planning = (plan: unknown): InferenceSink => ({ generatePlan: async () => plan });

  const ELIGIBLE = "How does a stop-loss order actually work on the KRX?";

  it("suppresses advice the planner proposed, and names it", async () => {
    // The case a request gate cannot catch, and the reason the second boundary exists at all.
    const outcome = await answerWithInference(
      ELIGIBLE,
      planning({
        segments: [],
        proposedNarration:
          "A stop-loss triggers at your stop price. You should buy Samsung at these levels.",
      }),
    );
    expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    if (outcome.status === "OUTPUT_SUPPRESSED") {
      expect(outcome.scan.verdict).toBe("BLOCKED");
      expect(outcome.scan.findings.map((f) => f.violation)).toContain(
        "PERSONALISED_RECOMMENDATION",
      );
    }
  });

  it("suppresses prose no pattern anticipated — IR-101 candidate P", async () => {
    // Not in VIOLATION_PATTERNS and deliberately never added to it. It fails because it names no
    // repository authority, which is a property of the architecture rather than of a list.
    const outcome = await answerWithInference(
      ELIGIBLE,
      planning({
        segments: [],
        proposedNarration:
          "Given the mechanism, the prudent course is to lighten exposure well ahead of the print.",
      }),
    );
    expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    if (outcome.status === "OUTPUT_SUPPRESSED") expect(outcome.scan.verdict).toBe("UNVERIFIABLE");
  });

  it("suppresses the same shape in Korean", async () => {
    const outcome = await answerWithInference(
      ELIGIBLE,
      planning({
        segments: [],
        proposedNarration: "지금은 비중을 늘릴 시점입니다. 반도체는 정리하시는 편이 낫습니다.",
      }),
    );
    expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
  });

  it("refuses a legacy sink that returns a bare string", async () => {
    const outcome = await answerWithInference(ELIGIBLE, planning("Execution slips on thin books."));
    expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    if (outcome.status === "OUTPUT_SUPPRESSED") {
      expect(outcome.scan.reason).toContain("MALFORMED_PLAN");
    }
  });

  it("refuses a plan carrying its own text", async () => {
    const outcome = await answerWithInference(
      ELIGIBLE,
      planning({ text: "Execution typically slips by 0.4% on thin books." }),
    );
    expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    if (outcome.status === "OUTPUT_SUPPRESSED") {
      expect(outcome.scan.reason).toContain("MODEL_AUTHORED_PROSE");
    }
  });

  it("refuses an unknown segment kind however plausible its name", async () => {
    for (const kind of ["SAFE_PROSE", "OTHER", "RAW_TEXT", "MODEL_TEXT", "UNKNOWN_BUT_ALLOWED"]) {
      const outcome = await answerWithInference(
        ELIGIBLE,
        planning({ segments: [{ kind, text: "Rates pass through with a lag." }] }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    }
  });

  it("never returns suppressed text to the caller", async () => {
    const secret = "You should buy Samsung right now.";
    const outcome = await answerWithInference(
      ELIGIBLE,
      planning({ segments: [], proposedNarration: secret }),
    );
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it("takes no caller-supplied attribution, structurally", () => {
    // IR-101 candidates Q and R were a third parameter through which the party asking for
    // publication certified its own numbers. The proof it is gone is the arity: there is no
    // argument left to pass, whatever a caller would like to assert.
    expect(answerWithInference.length).toBe(2);
  });
});

describe("the whole blind holdout, through the production path", () => {
  /**
   * The measurement that matters for activation, and it is not the guardrail's accuracy.
   *
   * Holdout 2 is used here READ-ONLY as evidence about reachability. Nothing in this file is tuned
   * against it, no label is changed, and no miss is patched — so it remains a fresh holdout for
   * the request guardrail. What is asserted is a property, not a rate: no case the corpus labels
   * MUST_REFUSE may reach the sink, whatever the guardrail thinks of it.
   */
  it("reaches the model for zero of the 112 prohibited requests", async () => {
    const reached: string[] = [];
    for (const c of ADVICE_GUARDRAIL_HOLDOUT2.filter((x) => x.label === "MUST_REFUSE")) {
      const { calls } = await run(c.query);
      if (calls.length > 0) reached.push(c.query);
    }
    expect(reached, `reached the model:\n  ${reached.join("\n  ")}`).toHaveLength(0);
  });

  it("still lets some legitimate questions through, so the gate is not merely closed", async () => {
    // A gate that blocks everything trivially satisfies the test above. This is the control.
    let reached = 0;
    for (const c of ADVICE_GUARDRAIL_HOLDOUT2.filter((x) => x.label === "MUST_ALLOW")) {
      const { calls } = await run(c.query);
      reached += calls.length;
    }
    expect(reached).toBeGreaterThan(0);
  });
});
