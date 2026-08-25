import { describe, expect, it } from "vitest";
import {
  analyseCopularInterrogative,
  analyseNoun,
  containsHangul,
  decomposeSyllable,
  eojeols,
  finality,
  internalConjunction,
} from "@/server/domain/koreanMorphology";

/**
 * The morpheme boundary, tested on its own and before it authorizes anything.
 *
 * This layer decides nothing about operations, so what it can be wrong about is narrow and exact:
 * where a word ends. Every case here is a claim about a boundary, and the ones that matter most are
 * the boundaries that must NOT be drawn — a name mutilated by a suffix that merely resembles a
 * particle is the failure mode the architecture round named, and greedy stripping is the shorter
 * implementation that produces it.
 */

const roles = (eojeol: string) =>
  analyseNoun(eojeol)
    .map((a) => `${a.stem}/${a.role ?? "-"}`)
    .sort();

describe("a particle split is offered, never imposed", () => {
  it("always offers the unsplit reading as well", () => {
    // The guard against mutilation. Whatever else is on the list, the whole word is on it.
    expect(roles("기준금리는")).toContain("기준금리는/-");
    expect(roles("한국은행이")).toContain("한국은행이/-");
  });

  it("binds the roles the request grammar needs", () => {
    expect(roles("기준금리는")).toEqual(["기준금리/TOPIC", "기준금리는/-"]);
    expect(roles("한국은행이")).toEqual(["한국은행/NOMINATIVE", "한국은행이/-"]);
    expect(roles("기준금리를")).toEqual(["기준금리/ACCUSATIVE", "기준금리를/-"]);
    expect(roles("스톱로스란")).toEqual(["스톱로스/DEFINIENDUM", "스톱로스란/-"]);
  });

  it("keeps a proper noun whose last syllable resembles a particle", () => {
    // 신라: naive stripping of the quotative-looking 라 leaves 신, which is not a word anyone asked
    // about. The only split this offers is the topic particle 는, and the stem it leaves is 신라.
    expect(roles("신라는")).toEqual(["신라/TOPIC", "신라는/-"]);
    expect(roles("신라는").some((r) => r.startsWith("신/"))).toBe(false);
  });

  it("refuses an allomorph the stem does not select", () => {
    // The phonological conditioning doing real work. 는 attaches to a vowel-final syllable and 은 to
    // a consonant-final one, so a token ending in the wrong one of the pair is not a noun plus a
    // particle at all. Without this check both splits would be offered and the grammar would have
    // to guess between them.
    expect(roles("문은")).toEqual(["문/TOPIC", "문은/-"]); // 문 is consonant-final: 은 is correct
    expect(roles("나은")).toEqual(["나은/-"]); // 나 is vowel-final: 은 cannot be a particle here
    expect(roles("도가")).toEqual(["도/NOMINATIVE", "도가/-"]); // 도 vowel-final: 가 is correct
    expect(roles("독이")).toEqual(["독/NOMINATIVE", "독이/-"]); // 독 consonant-final: 이 is correct
  });

  it("never leaves an empty stem", () => {
    // The particle alone is not a noun with a role; it is a particle.
    expect(roles("는")).toEqual(["는/-"]);
    expect(roles("의")).toEqual(["의/-"]);
  });

  it("offers no split for a word that ends in no particle", () => {
    expect(roles("우리나라")).toEqual(["우리나라/-"]);
    expect(roles("얼마인가요")).toEqual(["얼마인가요/-"]);
  });
});

describe("the copular interrogative is computed, not listed", () => {
  it("reads the ending whether or not it fused with the pronoun", () => {
    // 무엇 is consonant-final so the copula appears: 무엇 + 이 + ㄴ가(요). 뭐 is vowel-final, the
    // copula is not written, and the ending's ㄴ becomes 뭐's own final consonant — 뭔가요 has no
    // character boundary after the pronoun at all.
    expect(analyseCopularInterrogative("무엇인가요")).toEqual({ kind: "WHAT", pronoun: "무엇" });
    expect(analyseCopularInterrogative("뭔가요")).toEqual({ kind: "WHAT", pronoun: "뭐" });
    expect(analyseCopularInterrogative("뭡니까")).toEqual({ kind: "WHAT", pronoun: "뭐" });
    expect(analyseCopularInterrogative("무엇입니까")).toEqual({ kind: "WHAT", pronoun: "무엇" });
  });

  it("treats the politeness particle as optional and meaningless", () => {
    expect(analyseCopularInterrogative("무엇인가")).toEqual({ kind: "WHAT", pronoun: "무엇" });
    expect(analyseCopularInterrogative("무엇인가요")).toEqual({ kind: "WHAT", pronoun: "무엇" });
  });

  it("reads the quantity interrogative the same way", () => {
    expect(analyseCopularInterrogative("얼마인가요")).toEqual({
      kind: "HOW_MUCH",
      pronoun: "얼마",
    });
    expect(analyseCopularInterrogative("얼마입니까")).toEqual({
      kind: "HOW_MUCH",
      pronoun: "얼마",
    });
    expect(analyseCopularInterrogative("얼마예요")).toEqual({ kind: "HOW_MUCH", pronoun: "얼마" });
  });

  it("covers the copula's interrogative slot at four speech levels", () => {
    // 하십시오체, 해요체, 해체, and the -ㄴ가 form. A deliberately bounded subset chosen to span the
    // speech levels — NOT a completed paradigm, which is what an earlier version of this comment
    // claimed and adversarial review correctly refused: 이냐 and other style distinctions exist.
    expect(analyseCopularInterrogative("얼마입니까")).not.toBeNull(); // 하십시오체
    expect(analyseCopularInterrogative("얼마예요")).not.toBeNull(); // 해요체
    expect(analyseCopularInterrogative("얼마야")).not.toBeNull(); // 해체
    expect(analyseCopularInterrogative("얼마인가요")).not.toBeNull(); // -ㄴ가 + 요
    expect(analyseCopularInterrogative("뭐야")).toEqual({ kind: "WHAT", pronoun: "뭐" });
  });

  it("does not generate surfaces that are not words", () => {
    // Only the -ㄴ가 level takes the separate politeness particle; the other levels carry their
    // politeness inside the ending, so 입니까요 and 예요요 are not Korean and must not match.
    expect(analyseCopularInterrogative("얼마입니까요")).toBeNull();
    expect(analyseCopularInterrogative("얼마예요요")).toBeNull();
    expect(analyseCopularInterrogative("얼마야요")).toBeNull();
  });

  it("never matches an ending whose jamo did not attach to anything", () => {
    // Adversarial review's attack 9. The recogniser compared ENDING surfaces against whatever
    // followed the pronoun, so a bare `ㅂ니까` was a candidate string in its own right and
    // 얼마ㅂ니까 matched. A jamo that has not become some syllable's final consonant has not
    // attached, and comparing whole composed surfaces is what makes that unrepresentable.
    expect(analyseCopularInterrogative("얼마ㅂ니까")).toBeNull();
    expect(analyseCopularInterrogative("얼마ㄴ가요")).toBeNull();
    expect(analyseCopularInterrogative("뭐ㅂ니까")).toBeNull();
    expect(analyseCopularInterrogative("뭐ㄴ가요")).toBeNull();
    // And the words those malformed strings were standing in for still match.
    expect(analyseCopularInterrogative("얼마입니까")).not.toBeNull();
    expect(analyseCopularInterrogative("얼마인가요")).not.toBeNull();
    expect(analyseCopularInterrogative("뭡니까")).not.toBeNull();
    expect(analyseCopularInterrogative("뭔가요")).not.toBeNull();
  });

  it("does not recognise the past, and that is the answer rather than a gap", () => {
    // 였 is the past marker. "What WAS it" is not the operation CURRENT_OBSERVATION names, and
    // unknown morphology already refuses, so no rule is needed to reject it.
    expect(analyseCopularInterrogative("얼마였나요")).toBeNull();
    expect(analyseCopularInterrogative("무엇이었나요")).toBeNull();
  });

  it("refuses an eojeol it cannot consume entirely", () => {
    // 얼마인지 is a subordinate clause, not a question's terminal ending; 발표했나요 is a predicate
    // this layer knows nothing about. Leftover morphology is unread, and unread refuses.
    expect(analyseCopularInterrogative("얼마인지")).toBeNull();
    expect(analyseCopularInterrogative("발표했나요")).toBeNull();
    expect(analyseCopularInterrogative("얼마")).toBeNull();
  });
});

describe("syllable arithmetic", () => {
  it("decomposes a precomposed syllable and nothing else", () => {
    expect(decomposeSyllable("한")).toEqual({ cho: 18, jung: 0, jong: 4 });
    expect(decomposeSyllable("A")).toBeNull();
    expect(decomposeSyllable("1")).toBeNull();
  });

  it("says UNKNOWN rather than guessing for anything it cannot read", () => {
    // The three-valued repair. This answered a boolean, and false — "not vowel-final" — was then
    // read as positive evidence of a consonant, so `CPI이` was accepted as CPI plus the allomorph
    // that attaches to consonants. Not knowing is now its own answer.
    expect(finality("신라")).toBe("VOWEL");
    expect(finality("한국은행")).toBe("CONSONANT"); // 행 carries the final consonant ㅇ
    expect(finality("3.5%")).toBe("UNKNOWN");
    expect(finality("CPI")).toBe("UNKNOWN");
    expect(finality("")).toBe("UNKNOWN");
  });

  it("offers both allomorphs where the conditioning is unknown", () => {
    // Neither validated nor rejected. For the one-character pairs both readings leave the same
    // stem, so admitting both tolerates an ill-formed spelling without deciding anything.
    expect(roles("CPI는")).toEqual(["CPI/TOPIC", "CPI는/-"]);
    expect(roles("CPI은")).toEqual(["CPI/TOPIC", "CPI은/-"]);
    expect(roles("CPI가")).toEqual(["CPI/NOMINATIVE", "CPI가/-"]);
    expect(roles("CPI이")).toEqual(["CPI/NOMINATIVE", "CPI이/-"]);
  });

  it("still separates the allomorphs when the conditioning IS known", () => {
    expect(roles("나은")).toEqual(["나은/-"]);
    expect(roles("문는")).toEqual(["문는/-"]);
  });

  it("finds a conjunction joining two nouns inside one eojeol, and only then", () => {
    // 와 needs a vowel-final left side and 과 a consonant-final one, and both sides must be
    // non-empty — the particle has to actually be joining something.
    expect(internalConjunction("금리와환율")).toBe(true);
    expect(internalConjunction("결과")).toBe(false); // nothing after 과
    expect(internalConjunction("과정")).toBe(false); // nothing before 과
    expect(internalConjunction("금리과환율")).toBe(false); // 과 after a vowel is not the conjunction
    // The cost, asserted rather than hidden: a compound with a medial 과 is refused with the rest.
    expect(internalConjunction("교환과정")).toBe(true);
  });

  it("finds Hangul in a mixed request and not in an English one", () => {
    expect(containsHangul("What is the current US headline CPI?")).toBe(false);
    expect(containsHangul("CPI는 무엇인가요?")).toBe(true);
  });
});

describe("eojeol segmentation", () => {
  it("drops sentence punctuation and keeps what belongs to a token", () => {
    expect(eojeols("스톱로스란 무엇인가요?")).toEqual(["스톱로스란", "무엇인가요"]);
    expect(eojeols("한국은행이 기준금리를 3.5%라고 발표했나요?")).toEqual([
      "한국은행이",
      "기준금리를",
      "3.5%라고",
      "발표했나요",
    ]);
  });
});
