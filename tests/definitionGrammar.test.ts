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

  it("refuses a metalinguistic head that governs nothing", () => {
    // `How does the concept drift?` was recognised as a definition of `drift`. The copula test was
    // satisfied by the `does` of `how does`, and the bare head then took the rest of the clause.
    // A metalinguistic noun CITES a term only when it governs one, so the complement is required.
    expect(operationOf("How does the concept drift?")).not.toBe("DEFINITION");
    expect(operationOf("How does the definition change?")).not.toBe("DEFINITION");
    // And the complement has to be one that CITES. Review was asked for the rule rather than one
    // more string and named it: `the meaning OF x` and `meant BY x` cite x as a term, while
    // `the meaning BEHIND x` asks for the rationale of an event. `behind` was in the set by
    // association with the other two, carried none of their justification, and no corpus row used
    // it -- `the Fed raising rates` passed the term test because that test has no noun-shape proof.
    expect(operationOf("What is the meaning behind the Fed raising rates?")).not.toBe("DEFINITION");
    // AND REMOVING `behind` DID NOT CLOSE THE CLASS, which the next round said plainly:
    // `meaning OF` governs event clauses as readily as terms, so the same request survived with a
    // preposition that stayed. Patching one instance of an open class is the exact mistake this
    // unit spent five rounds learning not to make, and I made it again here.
    //
    // QUOTATION is the proof, and the only lexicon-free one available. Mentioning a term rather
    // than using it is marked by quoting it: a speaker who writes `the meaning of 'carry trade'`
    // has SAID the complement is a term. Both corpus rows are quoted, so the measured cost is
    // zero; the unmeasured cost is that an unquoted `What is the meaning of carry trade?` is
    // refused, which is the safe direction.
    expect(operationOf("What is the meaning of the Fed raising rates?")).not.toBe("DEFINITION");
    expect(operationOf("What is the meaning of the ECB cutting rates?")).not.toBe("DEFINITION");
    expect(operationOf('What is the meaning of "carry trade"?')).toBe("DEFINITION");
    // Both of the older guards went MISSED once quotation was required -- for the third time in
    // this unit a stricter rule covered the only strings the tests held, and for the third time
    // neither guard was actually redundant. `behind` still cites nothing even when the term IS
    // quoted, and the wh-copular frame still keeps `how does ... change` out of a shape that is
    // about what a term IS.
    expect(operationOf("What is the meaning behind 'carry trade'?")).not.toBe("DEFINITION");
    expect(operationOf("How does the meaning of 'inflation' change?")).not.toBe("DEFINITION");
    expect(operationOf("How does he explain the meaning of 'inflation'?")).not.toBe("DEFINITION");
  });

  it("refuses a Korean predicate that merely BEGINS with a metalinguistic noun", () => {
    // `주가가 의미있게 상승하나요?` -- "does the share price rise MEANINGFULLY" -- was read as a
    // definition of 주가, because matching the head 의미 by prefix accepted 의미있게. Korean
    // agglutinates, so a head must be allowed its particles and copular endings; what follows it
    // has to be grammatical, and 있 is a verb stem.
    expect(operationOf("주가가 의미있게 상승하나요?")).not.toBe("DEFINITION");
    // And the light-verb carveout is for METALINGUISTIC HEADS only. 뭐하다 is "to do what", so
    // `주가가 뭐하나요?` -- "what is the share price DOING" -- read 뭐하나요 as the interrogative
    // 뭐 plus a light verb. 의미하다 makes a verb OF the noun; 뭐 is a pronoun with nothing to
    // verbalise, and letting it through was the same carveout applied where it has no argument.
    expect(operationOf("주가가 뭐하나요?")).not.toBe("DEFINITION");
    expect(operationOf("주가가 뭐합니까?")).not.toBe("DEFINITION");
    // And it follows the SEMANTICS of the derived verb, not the shape of the derivation.
    // `주가가 무엇을 정의하나요?` -- "what does the share price DEFINE" -- and `무엇을 표현하나요?`
    // are agentive: the subject is doing the defining. 의미하다 and 뜻하다 are not -- the subject
    // IS the meaning, which is the relation the noun itself expresses.
    expect(operationOf("주가가 무엇을 정의하나요?")).not.toBe("DEFINITION");
    expect(operationOf("주가가 무엇을 표현하나요?")).not.toBe("DEFINITION");
    // The one derivation still allowed is the light verb 하-, which makes a verb of the SAME noun.
    // Tightening the rule lost this corpus row until that was carved out.
    expect(operationOf("PER이 뭘 의미하는 지표인가요")).toBe("DEFINITION");
  });

  it("refuses a complement inside the SUBJECT of a how-it-works question", () => {
    // The tail rule and the complement rule overlapped once the tail had to be empty, and mutation
    // reported the complement rule MISSED -- not because it stopped mattering, but because no test
    // held a request where it was the only thing deciding. `How does the level OF the VIX work?`
    // has an empty tail and is still not a definitional request: the subject is a property of a
    // term rather than a term.
    expect(operationOf("How does the level of the VIX work?")).not.toBe("DEFINITION");
    expect(operationOf("How does exposure to derivatives work?")).not.toBe("DEFINITION");
    // Round six. Round five declared the preposition list complete on the strength of the
    // closed-class argument and then wrote out the ones that came to mind; `as` was not among
    // them. Being closed makes a class finishable, which is not the same as having finished it.
    expect(operationOf("How does a derivative as collateral work?")).not.toBe("DEFINITION");
    expect(operationOf("How does a swap like a forward work?")).not.toBe("DEFINITION");
    // Round seven, after round six's list was also declared complete -- from a reference that time.
    // The claim of completeness is retired rather than made a fourth time; what carries the safety
    // argument is that an omission lands in the bounded residue, not that the list has no gaps.
    expect(operationOf("How does a derivative qua collateral work?")).not.toBe("DEFINITION");
  });

  it("refuses a pronoun as the term", () => {
    // `How does he work?` asks how a person performs their work, and was authorized as a definition
    // of `he`: shape 2 accepted any single token before the predicate and nothing established that
    // the subject was a NAMED thing. A term is a name. Pronouns are a closed function-word class
    // with no financial vocabulary shading into it, so the whole class is refused.
    for (const query of [
      "How does he work?",
      "How does she work?",
      "How does it work?",
      "How do they work?",
      // THE FOURTH TIME writing out "the class" from memory produced a subset in this unit: I
      // listed `nobody` and omitted `everybody`, after the same thing happened twice with the
      // prepositions. English indefinite pronouns are COMPOSITIONAL -- a determiner morpheme
      // crossed with a head morpheme -- so the code now generates the cross product instead of
      // enumerating twelve items by hand, and the subclass is closed by construction.
      "How does everybody work?",
      "How does somebody work?",
      "How does anyone work?",
      "How does one work?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
    expect(operationOf("How does a repurchase agreement work?")).toBe("DEFINITION");
  });

  it("refuses `how is X work`, where work is a noun", () => {
    // `How is remote work?` was a definition of `remote`: the rule found `work` in final position
    // and read it as the intransitive predicate, where it is the head NOUN of the subject and the
    // request asks about the state of remote work. `How is X work?` is not English -- only `does`
    // and `do` take a bare infinitive here, which is exactly what makes `work` a verb in those.
    expect(operationOf("How is remote work?")).not.toBe("DEFINITION");
    expect(operationOf("How is shift work?")).not.toBe("DEFINITION");
    // And the predicate is matched at a WORD BOUNDARY. `How does a network?` was a definition of
    // `a net`, because `network ` contains `work `. Same class as the Korean request frame matched
    // by prefix two rounds earlier: a substring test does not find the word, it finds the letters.
    expect(operationOf("How does a network?")).not.toBe("DEFINITION");
    expect(operationOf("How does a framework?")).not.toBe("DEFINITION");
    expect(operationOf("How do repurchase agreements work?")).toBe("DEFINITION");
  });

  it("refuses a metalinguistic head outside a wh-copular clause", () => {
    // `How does the MEANING OF inflation change?` was a definition of `inflation change`. The head
    // governed a complement, as required, and the copula test was satisfied by the `does` of
    // `how does`. That request asks how a meaning CHANGES, so the frame is now checked as a frame:
    // `what`, a copula, then only determiners before the head.
    expect(operationOf("How does the meaning of inflation change?")).not.toBe("DEFINITION");
  });

  it("refuses a Korean predicate that is not copular", () => {
    // `주가가 의미가 있나요?` -- "IS the share price meaningful" -- was a definition of 주가,
    // because 있나요 ends in 요 and the rule accepted any question ending. A definitional request
    // asks what a term IS, so the closing predicate must carry the copula 이/인.
    expect(operationOf("주가가 의미가 있나요?")).not.toBe("DEFINITION");
  });

  it("refuses a coordinated pair without breaking a compound", () => {
    // `ETF와 리츠의 차이는 무슨 뜻인가요?` asks about two terms. Adding 와 to the postposition list
    // as a SUBSTRING would refuse it and also refuse 통화스와프 -- the exact false positive
    // koreanMorphology removed `internalConjunction` for, and it would cost a corpus row this unit
    // gains. Position separates them: 와 coordinates when it closes an eojeol.
    expect(operationOf("ETF와 리츠의 차이는 무슨 뜻인가요?")).not.toBe("DEFINITION");
    expect(operationOf("통화스와프란 무슨 제도인지 설명해 주세요")).toBe("DEFINITION");
  });

  it("does not admit a prohibited request through a homographic head", () => {
    // 말 -- "word" -- was added as a metalinguistic head to recover
    // `GDP디플레이터란 무엇을 말합니까`, where 말하다 means "to say". The whole-corpus diff showed
    // what it cost: `달러 예금 지금 들까요 말까요` -- "should I open a dollar deposit or NOT" -- is
    // a PROHIBITED_ADVICE row, and 말까요 is the prohibitive auxiliary 말다. Homographs, with
    // nothing morphological between them.
    //
    // The head was removed and the definitional row given up. One row of coverage does not buy a
    // personalized advice request, and a marker that is only sometimes metalinguistic is not a
    // positive marker at all. Pinned in both directions so the trade is not quietly re-made.
    expect(operationOf("달러 예금 지금 들까요 말까요")).not.toBe("DEFINITION");
    expect(operationOf("GDP디플레이터란 무엇을 말합니까")).not.toBe("DEFINITION");
  });

  it("refuses a metalinguistic head used as the copular predicate", () => {
    // `주가가 개념인가요?` asks whether the share price IS a concept. `경상수지의 정의가 ...` asks
    // for the definition OF the current account. The case on the term decides: a genitive or a bare
    // compound modifier gives "the HEAD of X", a topic or nominative gives "X IS a HEAD".
    expect(operationOf("주가가 개념인가요?")).not.toBe("DEFINITION");
    // Unless an interrogative determiner turns the predicate back into a question about the term,
    // which is a corpus row and the reason 어떤 is absorbed into the marker rather than refused.
    expect(operationOf("신용스프레드가 어떤 개념인지 설명해 주십시오")).toBe("DEFINITION");
  });

  it("refuses a proposition cited as if it were a term", () => {
    // `주가가 100이라는 의미인가요?` made a whole proposition the definiendum, with a nominative
    // subject in front of it. Requiring the citation to OPEN the request was the first attempt and
    // was too strict -- it refused `기술적 반등이라는 표현은 무슨 뜻이야`, where 기술적 is an
    // ordinary adnominal modifier. What is wrong in the first is the CASE, not the position.
    expect(operationOf("주가가 100이라는 의미인가요?")).not.toBe("DEFINITION");
    expect(operationOf("기술적 반등이라는 표현은 무슨 뜻이야")).toBe("DEFINITION");
    // Round fifteen made the citation rule stricter, and that turned this guard's mutant MISSED --
    // the stricter rule already refused the string above. It is not redundant; the tests were.
    // With a proper head after the citation, the subject in front is the only thing wrong.
    expect(operationOf("주가가 테이퍼링이라는 표현은 무슨 뜻인가요?")).not.toBe("DEFINITION");
  });

  it("gives a metalinguistic head the same cardinality proof as the interrogative path", () => {
    // I DECLARED THESE TWO UNFIXABLE WITHOUT A LEXICON AND REVIEW ANSWERED WITH THE RULE.
    //
    // `오늘 주가 하락의 의미가 무엇인가요?` asks the significance of TODAY's fall -- a current
    // event -- and `기준금리은 수준이 무슨 뜻인가요?` hides an ill-formed 은 on a non-final eojeol.
    // A metalinguistic head now licenses exactly ONE eojeol of term, and modifiers in front of the
    // final eojeol may not be particle-shaped-but-declined. The final eojeol stays exempt, which is
    // what keeps 물가 and 소비자물가 usable as terms elsewhere.
    expect(operationOf("오늘 주가 하락의 의미가 무엇인가요?")).not.toBe("DEFINITION");
    expect(operationOf("기준금리은 수준이 무슨 뜻인가요?")).not.toBe("DEFINITION");
    // NAMED COST, one corpus row: a two-eojeol term under a metalinguistic head.
    expect(operationOf("채권 듀레이션 개념 알려주세요")).not.toBe("DEFINITION");
    // And the interrogative path is untouched, because it has its own borrowed proof.
    expect(operationOf("장단기 금리 역전이 무슨 뜻이죠?")).toBe("DEFINITION");
  });

  it("refuses a quoted imperative wearing the citation suffix", () => {
    // `떠나라는 뜻이야?` -- "does that mean [we should] LEAVE?" -- was a definition of 떠나, because
    // `-(으)라는` is also the adnominal form of a quoted IMPERATIVE and stripping it leaves a verb
    // stem. The citation path deliberately waives the case-marker requirement, on the argument that
    // the citation particle is itself the evidence of nominality -- an argument that turned out to
    // be false for EVERY form, not just this one. See the two blocks below.
    // `이라는` carries the copula 이, which attaches to nouns and not to verb stems.
    //
    // `팔라는 뜻인가요?` -- "does that mean SELL?" -- is the same shape in this product's own
    // subject matter, which is why the direction of this one matters beyond tidiness.
    expect(operationOf("떠나라는 뜻이야?")).not.toBe("DEFINITION");
    expect(operationOf("팔라는 뜻인가요?")).not.toBe("DEFINITION");
    // ROUND FIFTEEN, and it refuted the fix above rather than extending it. Keeping `이라는` on the
    // argument that its 이 is the nominal copula was wrong: 죽이다, 먹이다, 보이다, 높이다 are
    // causatives whose stems END in 이, so their quoted imperatives are 죽이라는, 먹이라는. A raw
    // suffix proves nothing about nominality in either form.
    //
    // What a citation actually does is MODIFY something. `테이퍼링이라는 표현은` names an overt head
    // noun and makes it the subject; `죽이라는 뜻이야?` has no head, only a copular predicate.
    expect(operationOf("죽이라는 뜻이야?")).not.toBe("DEFINITION");
    expect(operationOf("먹이라는 뜻인가요?")).not.toBe("DEFINITION");
    // Removing bare 라는 remains load-bearing even with the head rule in place: WITH a proper head,
    // `팔라는 표현은 무슨 뜻인가요?` cites the imperative "sell!" as a term. And the named cost is
    // visible in the same breath -- `코스피라는 표현은` is a legitimate vowel-final citation and is
    // refused with it. Zero corpus rows, and the direction is the safe one.
    expect(operationOf("팔라는 표현은 무슨 뜻인가요?")).not.toBe("DEFINITION");
    expect(operationOf("코스피라는 표현은 무슨 뜻인가요?")).not.toBe("DEFINITION");
    // ROUND SIXTEEN, third pass at the same class, this time through `(이)란`. That form was called
    // unaffected because `analyseNoun` checks allomorph conditioning -- and conditioning proves
    // SUFFIX COMPATIBILITY, never nominality. `가란 뜻이야?` parses as 가 plus 란, and
    // `지금 사란 뜻이야?` -- "do you mean BUY now?" -- is the same collision in this product's own
    // subject matter.
    //
    // The suffix is not the test in ANY of its forms. A cited term GOVERNS something: a definitional
    // interrogative, or a case-marked metalinguistic head. `뜻이야` alone is the copular predicate.
    expect(operationOf("가란 뜻이야?")).not.toBe("DEFINITION");
    expect(operationOf("지금 사란 뜻이야?")).not.toBe("DEFINITION");
    expect(operationOf("실질금리란 무엇인지 알려주세요")).toBe("DEFINITION");
    expect(operationOf("테이퍼링이란 용어의 뜻은?")).toBe("DEFINITION");
    expect(operationOf("기술적 반등이라는 표현은 무슨 뜻이야")).toBe("DEFINITION");
  });

  it("strips a request frame by whole eojeol, never by prefix", () => {
    // `주가가 무엇을 설명하나요?` -- "what does the share price EXPLAIN" -- was authorized, because
    // 설명하나요 starts with 설명 and was stripped as framing, leaving a bare interrogative behind.
    //
    // This is the finding that mattered most in eleven rounds, because it broke the PROPERTY the
    // list rests on rather than the list. A prefix test does not consume framing; it consumes any
    // predicate beginning with a framing word, so an omission ADMITS instead of refusing. Matched
    // whole, an unlisted form survives as an unconsumed eojeol and the request is refused.
    expect(operationOf("주가가 무엇을 설명하나요?")).not.toBe("DEFINITION");
    expect(operationOf("주가가 무엇을 알려주나요?")).not.toBe("DEFINITION");
    expect(operationOf("스태그플레이션이 뭔지 설명해줘")).toBe("DEFINITION");
  });

  it("refuses a standalone coordinating conjunction", () => {
    // Review reported `채권 또는 주식은 무슨 뜻인가요?` as authorized and it was not -- 또는 splits
    // as 또 plus a valid topic 는, so the one-marked-nominal rule already refused it. The finding
    // was still right about the CLASS: 그리고 and 아니면 end in nothing a particle rule can see,
    // and those did get through. Matched as whole eojeols, which is what keeps a substring test
    // from splitting 통화스와프 the way `internalConjunction` did.
    for (const query of [
      "채권 또는 주식은 무슨 뜻인가요?",
      "채권 그리고 주식은 무슨 뜻인가요?",
      "채권 아니면 주식은 무슨 뜻인가요?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
    expect(operationOf("통화스와프란 무슨 제도인지 설명해 주세요")).toBe("DEFINITION");
  });

  it("refuses a Korean adjunct particle", () => {
    // `주가처럼` restricts by comparison, exactly as an English complement preposition does.
    expect(operationOf("주가처럼 변동성의 의미가 무엇인가요?")).not.toBe("DEFINITION");
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
    // The precedence invariant, pinned as an ordinary assertion because it can no longer be pinned
    // as a mutant. `the current meaning of X` carries a currentness marker AND a metalinguistic
    // head, and CURRENT_OBSERVATION keeps it.
    //
    // The last-resort guard that expresses this now decides nothing measurable: removed by hand,
    // the whole 500-row corpus is unchanged, so its mutant is deleted rather than left MISSED. The
    // guard stays, and so does this assertion, because both are cheap and both stop mattering only
    // for as long as the two shapes stay narrow.
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
    expect(operationOf("테이퍼링이란 용어의 뜻은?")).toBe("DEFINITION");
    // NAMED COST, one corpus row. `코스피200이란?` is the elliptical dictionary-headword question
    // and governs nothing, so the rule below refuses it. Allowing an ungoverned citation would
    // admit `사란?` -- "buy?" -- and this unit has already made that trade once, when the head 말
    // was removed for coercing a PROHIBITED_ADVICE row. Coverage does not buy an advice-shaped
    // admission.
    expect(operationOf("코스피200이란?")).not.toBe("DEFINITION");
    expect(operationOf("사란?")).not.toBe("DEFINITION");
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
    expect(operationOf("무위험수익률 개념 설명해줘")).toBe("DEFINITION");
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
    // THE SPACED FORM IS ALSO REFUSED, BY A DIFFERENT MECHANISM, and the difference is worth
    // pinning rather than papering over. Review reported `내 포트폴리오가 무슨 뜻인가요?` as
    // authorized and it is not -- it returns PROHIBITED, because the personalized-advice detector
    // has absolute precedence over every recogniser here.
    //
    // The structural observation behind the report was still correct: the possessive guard inside
    // the Korean recogniser checks only the FINAL stem, so a determiner standing as its own eojeol
    // would walk past it. Nothing was added for that, because it is not reachable and this unit
    // does not ship insurance against unreproduced defects. These pin the OUTCOME instead, so that
    // if the upstream guardrail is ever narrowed the gap becomes visible here rather than silent.
    for (const query of [
      "내 포트폴리오가 무슨 뜻인가요?",
      "제 포트폴리오가 무슨 뜻인가요?",
      "내 수익률이 무슨 뜻인가요?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
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

  it("still cannot see inside a single Korean nominal, and says so", () => {
    // `koreanCopularMatch` states the limitation: one marked subject SLOT is a claim about the
    // CONSTRUCTION, not about the morphology inside it. Two round-six findings lived here and were
    // declared unfixable; round nine produced a lexicon-free rule for both, and they are now
    // refused (see the cardinality test above). What remains is the limitation itself, which these
    // pin from the other side -- 물가 is 물 plus a 가 its own conditioning declines, as is
    // 소비자물가, and both must stay usable as terms.
    expect(operationOf("물가란 무엇인가요?")).toBe("DEFINITION");
    expect(operationOf("소비자물가란 무엇인가요?")).toBe("DEFINITION");
  });

  it.fails("PENDING: definitional constructions this family does not yet cover", () => {
    // Review's answer 1, reproduced. The frames are finite, so a construction outside them is
    // UNSUPPORTED rather than guessed at -- which is the safe direction, and still a gap.
    expect(operationOf("Could you define convexity?")).toBe("DEFINITION");
  });
});
