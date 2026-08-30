import { describe, expect, it } from "vitest";
import { resolveRequestAuthority, OPERATION_CONTRACTS } from "@/server/domain/requestAuthority";

/**
 * A definitional request is one term asked about as a term, with no other operation's operand.
 *
 * MARKET-DEFINITION-GRAMMAR-001. `CONSTRUCTIONS` carried four DEFINITION rows and recognised 9 of
 * the corpus's 60 definitional requests. `What is real GDP?` failed on a missing article, which is
 * not a distinction anyone asking the question is making.
 *
 * These are the invariants, not a list of the strings that happened to be in the corpus. The
 * negative half is the important half: the first version of this grammar recognised five more
 * definitions AND coerced seven rows that are not definitions, four of them negative controls the
 * corpus says must be refused. A count of the intended gains could not have shown that; the
 * whole-corpus transition matrix did.
 */

const operationOf = (query: string) => {
  const a = resolveRequestAuthority(query);
  return a.status === "AUTHORIZED" ? a.operation : a.status;
};

describe("what makes a request definitional", () => {
  it("keeps the constructions that already worked", () => {
    expect(operationOf("What is a Eurodollar?")).toBe("DEFINITION");
    expect(operationOf("What is the definition of the natural rate of unemployment?")).toBe(
      "DEFINITION",
    );
  });

  it("recognises a metalinguistic head taking the term as its complement", () => {
    // `the meaning of X` and `meant by X` cite X AS a term. They are the only heads allowed a
    // prepositional complement, because that is exactly what a definitional request looks like.
    expect(operationOf("What is meant by 'basis risk'?")).toBe("DEFINITION");
    expect(operationOf("What is the meaning of 'carry trade'?")).toBe("DEFINITION");
  });

  it("recognises an intransitive predicate over one named thing", () => {
    // What a term IS, phrased as what it DOES. One subject and no relation, so there is nothing
    // for a mechanism to be between.
    expect(operationOf("How does a repurchase agreement work?")).toBe("DEFINITION");
  });
});

describe("what must NOT become a definition", () => {
  it("refuses a head noun that takes the term as a complement", () => {
    // THE DISCRIMINATOR, and every one of these was coerced by the first version of the grammar.
    // `the level OF x` asks what x is at; `real GDP` IS x.
    expect(operationOf("What's the going level of the VIX?")).not.toBe("DEFINITION");
    expect(operationOf("What is the published view on Brent crude?")).not.toBe("DEFINITION");
    expect(operationOf("What is the reported figure for global oil demand?")).not.toBe(
      "DEFINITION",
    );
    expect(operationOf("What is the weather in Seoul tomorrow?")).not.toBe("DEFINITION");
  });

  it("refuses an under-specified mechanism question", () => {
    // Corpus negative control. Names one endpoint and asks for "the mechanism", which does not say
    // a mechanism between what and what.
    expect(operationOf("What is the mechanism for the policy rate?")).not.toBe("DEFINITION");
  });

  it("refuses a calculation over two named things, symbolic or written out", () => {
    for (const query of [
      "What is EBITDA minus capex?",
      "What is revenue plus other income?",
      "What is EBITDA - capex?",
      "What is EBITDA / revenue?",
      "What is EBITDA less capex?",
      "What is revenue multiplied by margin?",
      "What is EBITDA mod capex?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
  });

  it("refuses a complement inside the SUBJECT of a how-it-works question", () => {
    // The tail rule and the complement rule overlapped once the tail had to be empty, and mutation
    // reported the complement rule MISSED -- not because it stopped mattering, but because no test
    // held a request where it was the only thing deciding. `How does the level OF the VIX work?`
    // has an empty tail and is still not a definitional request: the subject is a property of a
    // term rather than a term.
    expect(operationOf("How does the level of the VIX work?")).not.toBe("DEFINITION");
    expect(operationOf("How does exposure to derivatives work?")).not.toBe("DEFINITION");
  });

  it("refuses a predicate with anything after it", () => {
    // FIVE REVIEW ROUNDS on one construction. `How does X work WITH INFLATION?` was first fixed by
    // testing the tail with the same single-term rule as the head, which reads as thorough and was
    // not -- it inherited that rule's preposition list, and review answered with
    // `How does a stop-loss order work AMID a market crash?`, admitted because `amid` was missing.
    // An empty tail needs no list, and refuses both.
    for (const query of [
      "How does the unemployment rate work with inflation?",
      "How does a stop-loss order work amid a market crash?",
      "How does yield curve control operate in general terms?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
  });

  it("refuses an open-class connective rather than enumerating them", () => {
    // FOUR REVIEW ROUNDS produced this, and the lesson is the design rather than the words. The
    // shape began as a bare wh-copular -- `what is X` for any X -- and each round found another
    // member of a set I was treating as closed: `at`, `by`, `per`, then `via`, `without`, `within`,
    // `among`; `less`, `multiplied`, then `modulo`, `subtract`. Every miss ADMITS a non-definition,
    // which is the unfinishable denylist this repository has abandoned twice before.
    //
    // Requiring the definitional intent to be positively marked inverts the failure direction: an
    // unmarked request is UNSUPPORTED rather than guessed at, and none of these needs a list entry.
    for (const query of [
      "What is exposure via derivatives?",
      "What is protection without collateral?",
      "What is EBITDA modulo capex?",
      "What is EBITDA subtract capex?",
      "What is duration - in bond mathematics?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
  });

  it("yields to an operation that overlaps a definitional frame", () => {
    // WHERE THE LAST-RESORT ORDERING ACTUALLY DECIDES, and it took a MISSED mutant to find it.
    //
    // Narrowing shape 1 to a marked head made M-DEFGRAM-LAST-RESORT survive: with the guard removed
    // the family fired unconditionally and nothing broke, because no remaining test held a request
    // that two recognisers both matched. That is a real hole in the evidence, not a sign the guard
    // was unnecessary -- `the current meaning of X` carries both a currentness marker and a
    // metalinguistic head, so unguarded it yields two readings and the request becomes AMBIGUOUS.
    // Guarded, the operation that recognised it first keeps it.
    expect(operationOf("What is the current meaning of tapering?")).toBe("CURRENT_OBSERVATION");
  });

  it("leaves every other operation to its own construction", () => {
    // Definitional recognition is last-resort: it runs only when nothing else recognised the span,
    // so it cannot outrank an operation or make a request ambiguous.
    expect(operationOf("What is the current US headline CPI?")).toBe("CURRENT_OBSERVATION");
    expect(operationOf("Explain how oil prices affect headline CPI.")).toBe("STORED_MECHANISM");
    expect(operationOf("What did analysts publish about US nonfarm payrolls?")).toBe(
      "ATTRIBUTED_REPORTED_OBSERVATION",
    );
  });

  it("does not rescue a prohibited request that mentions a term", () => {
    // PROHIBITED-PURPOSE PRECEDENCE. A definitional wrapper must not launder a personalized
    // directive, an allocation request, a prediction demand or a guarantee.
    for (const query of [
      "What is a covered call and should I sell one on my Apple position?",
      "What is dollar cost averaging? Tell me how much to put in each month.",
      "What is a stop loss and where exactly should I set mine?",
      "What is the S&P 500 going to close at tomorrow?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
  });
});

describe("the same grammar in Korean", () => {
  it("recognises a term cited with (이)란 or (이)라는", () => {
    // The citation particle IS the marker: it puts the term in quotation marks. Requiring a case
    // marker on the stem AFTER stripping the citation asked for the evidence twice, and refused
    // `테이퍼링이라는 표현은 무슨 뜻인가요?` while the comments claimed to support it -- found by
    // review, not by this file.
    expect(operationOf("테이퍼링이라는 표현은 무슨 뜻인가요?")).toBe("DEFINITION");
    expect(operationOf("GDP디플레이터란 무엇을 말합니까")).toBe("DEFINITION");
  });

  it("refuses a temporal adjunct without owning a list of adverbs", () => {
    // `내일 주가가 뭐야?` is "what is TOMORROW's share price", and it authorized as a definition of
    // `내일 주가`. The repair is NOT adding 내일 to a list -- 현재, 최근, 지금, 오늘, 현시점 has no
    // end, and no lexicon-free rule tells 내일 주가 from 장단기 금리. Where the request reduces to
    // `koreanCopularMatch`'s construction it must satisfy that construction's two-eojeol proof,
    // which refuses this and needs no vocabulary at all. The adverb list was DELETED, so this test
    // fails if anyone reintroduces one.
    expect(operationOf("내일 주가가 뭐야?")).not.toBe("DEFINITION");
    expect(operationOf("어제 환율이 뭐야?")).not.toBe("DEFINITION");
    // Still recognised, because a metalinguistic head supplies evidence a bare interrogative does
    // not -- the rule is about where the proof comes from, not about term length.
    expect(operationOf("장단기 금리 역전이 무슨 뜻이죠?")).toBe("DEFINITION");
  });

  it("refuses a marker that is ill-formed rather than absent", () => {
    // `기준금리은` writes 은 after a vowel-final syllable, which is not a topic particle at all.
    // `analyseNoun` declines the split, and the unmarked-compound exception then took the whole
    // token -- the second instance in this unit of declined evidence falling through to a weaker
    // reading. A speaker who wrote a case marker meant one.
    expect(operationOf("기준금리은 뜻이 뭐야?")).not.toBe("DEFINITION");
  });

  it("recognises a term marked with a definitional interrogative or a metalinguistic head", () => {
    // `koreanCopularMatch` takes 2 of the corpus's 30 Korean definitional requests, because it
    // requires exactly two eojeol. These are the same question in three, four and five.
    expect(operationOf("장단기 금리 역전이 무슨 뜻이죠?")).toBe("DEFINITION");
    expect(operationOf("경상수지의 정의가 궁금합니다")).toBe("DEFINITION");
    expect(operationOf("근원물가지수가 무엇을 의미하는지 알려주세요")).toBe("DEFINITION");
    expect(operationOf("채권 듀레이션 개념 알려주세요")).toBe("DEFINITION");
  });

  it("treats the request frame as framing, not as an operand", () => {
    // 설명해 주세요 / 알려줘 / 궁금해요 say the speaker wants to be told, which every request says.
    for (const query of [
      "스태그플레이션이 뭔지 설명해줘",
      "물가연동국채가 뭔지 궁금해요",
      "헤지펀드가 무엇인지 알려주십시오",
    ]) {
      expect(operationOf(query), query).toBe("DEFINITION");
    }
  });

  it("refuses a relation between two marked nominals", () => {
    // COERCED, and caught by the whole-corpus diff rather than by a count of the intended gains.
    // `미국 고용지표가 ... 영향은 무엇인가요` ends in 무엇인가요 and is STORED_MECHANISM: two overtly
    // marked nominals is a clause, not a term. The Korean form of the English complement rule.
    expect(operationOf("미국 고용지표가 연준 통화정책에 미치는 영향은 무엇인가요")).not.toBe(
      "DEFINITION",
    );
    // The same relation asked with a metalinguistic head instead of a bare final interrogative, so
    // the two-eojeol proof does not apply and cardinality is the only rule left deciding. Mutation
    // reported the cardinality check MISSED until this line existed: the corpus row above is
    // refused twice over, and a rule covered by another rule looks unnecessary until the covering
    // one is narrowed.
    expect(operationOf("달러 강세가 신흥국 통화에 주는 영향은 무슨 뜻인가요?")).not.toBe(
      "DEFINITION",
    );
  });

  it("refuses two operations joined into one request", () => {
    // COERCED, and both are corpus rows the grammar is required to REFUSE. Looking only for a
    // second CASE-MARKED subject missed them -- the second question's subject is 수치도 in one and
    // a bare 리츠 in the other -- so what is checked is that nothing after the marker is anything
    // but predicate. 설명해주고 ends in the connective 고, which is "explain, AND".
    expect(operationOf("CPI가 뭔지 설명해주고 최신 미국 CPI 수치도 알려주세요")).not.toBe(
      "DEFINITION",
    );
    expect(operationOf("ETF 정의랑 리츠 정의 둘 다 설명해줘")).not.toBe("DEFINITION");
  });

  it("refuses a term restricted to a setting, as the English side does", () => {
    // `국채 입찰에서 응찰률이란?` is `What is duration in bond mathematics?` in Korean, and both are
    // refused. The adjunct says the request is about the term somewhere, not about the term.
    expect(operationOf("국채 입찰에서 응찰률이란?")).not.toBe("DEFINITION");
  });

  it("inherits the guards of the recognisers it stands behind", () => {
    // REGRESSION, caught by the existing suite rather than by this file. `koreanCopularMatch` drops
    // a first-person possessive subject; dropping it leaves no reading, and no reading is the
    // condition that invites a last-resort recogniser in. So the guard has to be repeated here or
    // declining the evidence quietly becomes a way of reaching a weaker grammar.
    expect(operationOf("제포트폴리오는 무엇인가요?")).not.toBe("DEFINITION");
    expect(operationOf("내수익률은 무슨 뜻이죠?")).not.toBe("DEFINITION");
  });

  it("does not turn a quantity question into a definition", () => {
    // 얼마 is absent from the interrogative set on purpose: it asks HOW MUCH.
    expect(operationOf("기준금리는 얼마인가요?")).not.toBe("DEFINITION");
  });
});

describe("a definition never reaches a planner", () => {
  it("declares DEFINITION planner-forbidden in the contract", () => {
    // Success for this unit is canonical recognition with ZERO planner calls, and the authority for
    // that is the contract rather than anything the grammar asserts. Preserving a legacy planner
    // call for a deterministic operation would not be capability.
    expect(OPERATION_CONTRACTS.DEFINITION.plannerPermitted).toBe(false);
  });
});

describe("declared limitations of this grammar", () => {
  it.fails("PENDING: an unmarked bare term is not recognised", () => {
    // OPEN, PRE-EXISTING, and NOT closed by this unit. Named by review as P1 and reproduced.
    //
    // `return on equity`, `proof of stake` and `cash flow from operations` are single financial
    // terms that happen to contain a preposition, and the discriminator that keeps `the level OF
    // the VIX` out cannot tell them apart from it. Membership in a preposition set says nothing
    // about whether the word is a complement or part of a name; separating the two needs a term
    // lexicon, which is a different unit.
    //
    // Not a regression. The previous grammar recognised DEFINITION through four literals --
    // ` definition of `, ` what is a `, ` what is an `, ` what does … mean ` -- and matched none of
    // these either, so they were UNSUPPORTED before this change and remain so.
    //
    // Pinned executable so the gap is visible rather than described.
    expect(operationOf("What is return on equity?")).toBe("DEFINITION");
  });

  it("refuses an unmarked bare term, which is the price of the narrowing", () => {
    // NAMED COST. `What is real GDP?` and `What is the Herfindahl-Hirschman Index?` are plainly
    // definitional and are not recognised, because nothing in them says so and an unconstrained
    // complement cannot be filtered safely. Neither was recognised before this unit either -- the
    // previous family was four literals -- so the claim is smaller, not regressed.
    expect(operationOf("What is real GDP?")).not.toBe("DEFINITION");
    expect(operationOf("What is value at risk?")).not.toBe("DEFINITION");
  });

  it("ADMITS an arithmetic word form inside a positively marked frame, and that is deliberate", () => {
    // DECLARED RESIDUE, disposed of by argument rather than by a fix, and pinned so the argument
    // has to be re-made rather than forgotten.
    //
    // A list of arithmetic word forms was patched in four successive rounds -- `less`,
    // `multiplied`, then `modulo`, `subtract`, then `mod` -- and DELETED at the fifth. It has no
    // last member, and every omission admits.
    //
    // What the omission admits is now a different kind from what rounds 1-4 found, and that is the
    // whole basis for keeping it. `How does EBITDA mod capex work?` is recognised as a definitional
    // request about a term named "EBITDA mod capex": no other operation owns that request, no
    // corpus control expects it refused, the operation is deterministic and reaches no planner, and
    // the repository has no such term so it resolves to nothing. Rounds 1-4 admitted requests that
    // BELONGED to CURRENT_OBSERVATION and ATTRIBUTED_REPORTED_OBSERVATION and broke four negative
    // controls. This does neither, and closing it needs a term lexicon.
    expect(operationOf("How does EBITDA mod capex work?")).toBe("DEFINITION");
  });

  it.fails("PENDING: definitional constructions this family does not yet cover", () => {
    // Review's answer 1, reproduced. The frames are finite, so a construction outside them is
    // UNSUPPORTED rather than guessed at -- which is the safe direction, and still a gap.
    expect(operationOf("Could you define convexity?")).toBe("DEFINITION");
  });
});
