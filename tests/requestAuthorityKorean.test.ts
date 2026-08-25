import { describe, expect, it } from "vitest";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";

/**
 * What the canonical parser may and may not conclude from Korean.
 *
 * IR-107 Unit 2 Phase B, first recognition chunk. Two operations are recognised — DEFINITION and
 * CURRENT_OBSERVATION — from one construction, and the tests that matter most are the ones asserting
 * everything ELSE still refuses. A recognition layer is easy to measure by what it admits and is
 * dangerous in what it admits by accident.
 *
 * Both operations are `plannerPermitted: false`, so a request recognised here is one no model may
 * ever see. That is asserted rather than assumed, because it is the property that makes widening
 * recognition safe at all.
 */

const status = (query: string) => resolveRequestAuthority(query).status;

function authorized(query: string) {
  const authority = resolveRequestAuthority(query);
  if (authority.status !== "AUTHORIZED") {
    throw new Error(`${query} => ${authority.status}: ${authority.detail}`);
  }
  return authority;
}

describe("Korean definition, from a closed interrogative and a copula", () => {
  it("recognises the (이)란 definiendum construction", () => {
    const authority = authorized("스톱로스란 무엇인가요?");
    expect(authority.operation).toBe("DEFINITION");
    expect(authority.subjectRegion.trim()).toBe("스톱로스");
  });

  it("recognises the topic-marked form, and every politeness variant of the ending", () => {
    for (const query of [
      "기준금리는 무엇인가요?",
      "기준금리는 무엇입니까?",
      "기준금리는 무엇이에요?",
      "기준금리는 뭔가요?",
      "기준금리는 뭐예요?",
    ]) {
      const authority = authorized(query);
      expect(authority.operation).toBe("DEFINITION");
      expect(authority.subjectRegion.trim()).toBe("기준금리");
    }
  });

  it("keeps a name whose last syllable resembles a particle", () => {
    // Nothing here knows 신라 is a name. 라 is not in the particle inventory, so the split to 신 is
    // never offered and cannot be chosen — the protection is the inventory being closed rather than
    // anything about this particular word.
    expect(authorized("신라는 무엇인가요?").subjectRegion.trim()).toBe("신라");
  });

  it("refuses where two splits are both morphologically valid", () => {
    // 길이란 is 길 + 이란 or 길이 + 란, and the conditioning admits both: 길 is consonant-final so it
    // takes 이란, 길이 is vowel-final so it takes 란. One asks what a road is, the other what length
    // is. Longest-match would answer 한국이란 correctly and 길이란 wrongly; shortest-match the other
    // way round. There is no third rule, so both refuse.
    expect(status("길이란 무엇인가요?")).toBe("AMBIGUOUS");
    expect(status("한국이란 무엇인가요?")).toBe("AMBIGUOUS");
    // And the unambiguous neighbour still resolves, so this is not the ambiguity branch swallowing
    // the construction.
    expect(authorized("양적완화란 무엇인가요?").subjectRegion.trim()).toBe("양적완화");
  });
});

describe("Korean current observation, from the quantity interrogative", () => {
  it("recognises the present copular question", () => {
    const authority = authorized("기준금리는 얼마인가요?");
    expect(authority.operation).toBe("CURRENT_OBSERVATION");
    expect(authority.subjectRegion.trim()).toBe("기준금리");
  });

  it("reads the nominative as a subject marker too", () => {
    // 은/는 marks a topic and 이/가 the grammatical subject. Which one a speaker reaches for is
    // information structure, not a different question, and both are the closed case-particle class.
    expect(authorized("기준금리가 뭐야?").operation).toBe("DEFINITION");
    expect(authorized("기준금리가 뭐야?").subjectRegion.trim()).toBe("기준금리");
    expect(authorized("환율이 얼마인가요?").subjectRegion.trim()).toBe("환율");
  });

  it("requires an overt case marker, and refuses ordinary speech that drops it", () => {
    // 원달러환율 얼마야 is perfectly ordinary spoken Korean and it is refused. Accepting it meant
    // accepting ANY first eojeol, because exactly-two-eojeol counts whitespace and proves nothing
    // about the first token being a noun phrase — see the negative controls below for what that
    // admitted. Telling a Korean noun from an inflected verb needs a lexicon this repository does
    // not have, so the marker is the only evidence available and it is now required.
    expect(status("원달러환율 얼마야?")).toBe("UNSUPPORTED");
    expect(authorized("원달러환율은 얼마야?").subjectRegion.trim()).toBe("원달러환율");
  });

  it("refuses a first eojeol that is not a noun phrase", () => {
    // Every one of these was AUTHORIZED, with the negator, an obligation form and a connective
    // promoted to subject on the strength of the second eojeol alone.
    expect(status("안 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("사야 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("사서 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("그리고 얼마인가요?")).toBe("UNSUPPORTED");
  });

  it("refuses the past, because that is a different question", () => {
    // 였 is the past marker and it is morphology, not a word. Nothing rejects it explicitly: the
    // present-tense grammar simply does not match, and unknown morphology refuses.
    expect(status("기준금리는 얼마였나요?")).toBe("UNSUPPORTED");
  });

  it("does not let (이)란 ask a quantity", () => {
    // (이)란 cites a term as a term. "The term X, how much is it?" is not a construction.
    expect(status("스톱로스란 얼마인가요?")).toBe("UNSUPPORTED");
  });

  it("does not re-read a declined marker as no marker", () => {
    // The bare-subject fallback rescued this once: with the definiendum reading refused, the eojeol
    // was re-read as unmarked and 스톱로스란 became the name of a subject. A marker the grammar
    // declined is still a marker, and the fallback exists for its absence rather than its refusal.
    expect(status("스톱로스란 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("기준금리를 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("기준금리의 얼마인가요?")).toBe("UNSUPPORTED");
  });

  it("does not re-read a MALFORMED marker as no marker either", () => {
    // The other half of the same invariant, and the half that was missing. 은 after a vowel-final
    // syllable is not a topic particle, so the split is refused during morphology — and the token
    // was then read as an unmarked name, authorizing a subject called "기준금리은". Evidence that
    // was present and declined never falls through to a weaker reading, whether it was declined by
    // the grammar or by the phonology.
    expect(status("기준금리은 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("환율가 얼마인가요?")).toBe("UNSUPPORTED");
  });

  it("refuses a coordination compressed into one eojeol", () => {
    // Whitespace cardinality is not constituent cardinality. 금리와환율 is one compound noun or two
    // nouns conjoined, and the contract is about to claim exactly one subject — so, as with 길이란,
    // two readings and no rule to choose means refuse. Not a substring ban: both sides must be
    // non-empty and the allomorph must fit.
    expect(status("금리와환율은 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("금리와환율 무엇인가요?")).toBe("UNSUPPORTED");
    // The cost, asserted rather than left to be discovered: a compound with a medial 과 goes too.
    expect(status("교환과정은 무엇인가요?")).toBe("UNSUPPORTED");
    // But a 과 with nothing on one side of it is not a conjunction and is untouched.
    expect(authorized("결과는 무엇인가요?").subjectRegion.trim()).toBe("결과");
  });
});

describe("neither operation may reach a planner", () => {
  it("declares itself deterministic and is refused by the inference gate", () => {
    for (const query of [
      "스톱로스란 무엇인가요?",
      "기준금리는 얼마인가요?",
      "신라는 무엇인가요?",
    ]) {
      expect(authorized(query).contract.plannerPermitted).toBe(false);
      expect(authorizeInference(query).eligible).toBe(false);
    }
  });

  it("refuses for the canonical reason where the legacy classifier would have admitted it", () => {
    // Which refusal reason comes out depends on whether the legacy frame classifier happened to
    // recognise the request, and it is consulted first so that every older reason keeps its
    // meaning. `스톱로스란 무엇인가요?` is one it DOES recognise, so the canonical contract is what
    // stops it — the only case in this file where that distinction is observable, and the only one
    // where it is load-bearing.
    const inference = authorizeInference("스톱로스란 무엇인가요?");
    expect(inference.eligible).toBe(false);
    if (!inference.eligible) expect(inference.blockedBy).toBe("DETERMINISTIC_OPERATION");
  });
});

describe("what recognition deliberately does not extend to", () => {
  it("refuses an adverb it has not read", () => {
    // 현재 means "current" and the request is obviously answerable, and it still refuses. Reading
    // 현재 as an operation marker would be translating the English construction table; admitting it
    // as framing would start a list with 최근, 지금, 오늘 and no end. The construction already asks
    // the question without it.
    expect(status("현재 기준금리는 얼마인가요?")).toBe("UNSUPPORTED");
  });

  it("refuses a change request, which no particle or ending can establish", () => {
    expect(status("올해 소비자물가가 얼마나 올랐나요?")).toBe("UNSUPPORTED");
    expect(status("소비자물가는 얼마나 올랐나요?")).toBe("UNSUPPORTED");
  });

  it("refuses a causal request, whose direction and polarity are not mechanical", () => {
    expect(status("금리가 환율에 영향을 주나요?")).toBe("UNSUPPORTED");
    expect(status("금리는 환율에 영향을 주지 않나요?")).toBe("UNSUPPORTED");
  });

  it("refuses the attributed construction this chunk does not bind", () => {
    // 에 대해 sits between a closed postposition and a productive construction, and this is the
    // exact input of the reproduced unsafe divergence. It closes by the inference bypass, not by
    // being recognised, and pretending otherwise would be the fastest way to authorize it wrongly.
    expect(status("애널리스트들이 반도체 업황에 대해 뭐라고 발표했나요?")).toBe("UNSUPPORTED");
    expect(status("한국은행이 기준금리를 얼마라고 발표했나요?")).toBe("UNSUPPORTED");
  });
});

describe("safety, which recognition must not have loosened", () => {
  it("prohibits a first-person possessive determiner governing the subject", () => {
    // Previously UNSUPPORTED, which says the product does not do that yet when what is true is that
    // it must not.
    expect(status("내 기준금리는 얼마인가요?")).toBe("PROHIBITED");
    expect(status("제 계좌의 수익률은 얼마인가요?")).toBe("PROHIBITED");
    expect(status("저의 포트폴리오는 무엇인가요?")).toBe("PROHIBITED");
  });

  it("never authorizes a fused possessive, and does not accuse it either", () => {
    // Written correctly a possessive determiner is its own eojeol and the rule above prohibits it.
    // Fused, there is no boundary to see: 내수익률 and 내수 are the same syllable followed by more
    // of them, and no rule available here separates "my rate of return" from "domestic demand".
    // So the subject analysis is dropped and the request is UNSUPPORTED — refused, but not accused,
    // because prohibiting would tell someone asking about domestic demand that they asked for
    // advice. The cost is stated in the third assertion rather than discovered later.
    expect(status("내수익률은 얼마인가요?")).toBe("UNSUPPORTED");
    expect(status("제포트폴리오는 무엇인가요?")).toBe("UNSUPPORTED");
    expect(status("내수는 얼마인가요?")).toBe("UNSUPPORTED"); // the capability this costs
  });

  it("prohibits a possessive that is outside the subject but still in the request", () => {
    // The possessive check ran only where NOTHING was recognised, and this got through it:
    // AUTHORIZED as an attributed report whose SOURCE was the reader's own bank. The subject region
    // is clean, so the pronoun rule never saw it, and a source made only partly of pronouns is not
    // rejected by the disqualifier list.
    expect(status("What did my bank publish about US headline CPI?")).toBe("PROHIBITED");
    expect(status("What did our fund manager report about US inflation?")).toBe("PROHIBITED");
  });

  it("does not prohibit the dative first person, which names who is being told", () => {
    expect(status("저에게 기준금리를 알려주세요.")).not.toBe("PROHIBITED");
  });

  it("does not prohibit a bare 우리, which is not a claim of ownership", () => {
    // 우리나라 is "this country" the way English says "the UK".
    expect(status("우리나라 기준금리는 얼마인가요?")).not.toBe("PROHIBITED");
  });

  it("does not read request mood as prohibited purpose", () => {
    // Korean requests end this way almost invariably. The English form of this mistake was measured
    // at 44 ordinary requests accused of asking for advice.
    expect(status("기준금리는 얼마인지 알려주세요.")).not.toBe("PROHIBITED");
    expect(status("기준금리는 무엇인지 알려주세요.")).not.toBe("PROHIBITED");
  });

  it("never serves the factual half of a request with a directive in it", () => {
    expect(status("기준금리는 얼마인가요 그리고 제 포트폴리오를 조정해 주세요")).not.toBe(
      "AUTHORIZED",
    );
    expect(status("기준금리는 얼마인가요 그리고 삼성전자 사야 하나요")).not.toBe("AUTHORIZED");
  });

  it("leaves English requests exactly as they were", () => {
    // The Korean grammar is reached only when the request contains Korean, and this is the
    // assertion that says so rather than the comment that claims it.
    expect(resolveRequestAuthority("What is the current US headline CPI?").status).toBe(
      "AUTHORIZED",
    );
    expect(status("What is a yield curve inversion?")).toBe("AUTHORIZED");
    expect(status("Should I buy Samsung right now?")).toBe("PROHIBITED");
  });
});
