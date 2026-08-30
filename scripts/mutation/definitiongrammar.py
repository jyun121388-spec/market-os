"""M-DEFGRAM: is the definitional grammar load-bearing, and is its discrimination real?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines. Six files in this directory have been corrupted that way.

MARKET-DEFINITION-GRAMMAR-001. The grammar recognises a definitional request structurally: one term,
asked about as a term, with no operand belonging to another operation. The first version of it
recognised five more definitions AND coerced seven rows that are not definitions -- four of them
negative controls the corpus says must be refused. So the mutants below are weighted towards the
discrimination rather than towards the recognition: a grammar that recognises more is easy, and one
that recognises more WITHOUT stealing anything is the actual claim.

  M-DEFGRAM-OFF            the recogniser is never consulted -> intended definitions leave canonical
  M-DEFGRAM-PREPOSITION    a head noun with a prepositional complement counts as a term again
  M-DEFGRAM-TAIL           the predicate's tail stops being checked, so a second term hides in it
  M-DEFGRAM-PLANNER        DEFINITION becomes planner-permitted
  M-DEFGRAM-KO-OFF         the Korean half is never consulted
  M-DEFGRAM-KO-CARDINALITY a clause with two marked nominals counts as a term
  M-DEFGRAM-KO-PREDICATE   two operations joined by a connective read as one
  M-DEFGRAM-KO-TWO-EOJEOL  a bare final interrogative stops proving cardinality
  M-DEFGRAM-KO-DECLINED    an ill-formed case marker counts as no case marker
  M-DEFGRAM-KO-COORDINATOR a coordinated pair counts as one term
  M-DEFGRAM-EN-FRAME       shape 1 accepts any clause containing a form of `do`
  M-DEFGRAM-KO-HEAD-CARDINALITY   a metalinguistic head licenses a multi-eojeol term
  M-DEFGRAM-KO-PREDICATE-HEAD     a head as copular predicate counts as a citation
  M-DEFGRAM-KO-DECLINED-MODIFIER  a declined marker hides before the final eojeol
  M-DEFGRAM-KO-CITATION-SUBJECT   a marked nominal precedes a cited term
  M-DEFGRAM-KO-CONJUNCTION        a standalone conjunction counts as part of the term
  M-DEFGRAM-KO-FRAME-PREFIX       the request frame is stripped by prefix, eating predicates
  M-DEFGRAM-KO-CITATION-BARE      bare 라는 counts as a citation, admitting quoted imperatives

    python scripts/mutation/definitiongrammar.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

REQUEST = "src/server/domain/requestAuthority.ts"

BINDING_TESTS = [
    "tests/definitionGrammar.test.ts",
    # The operations this must not steal from, and the guardrail it must not launder.
    "tests/requestAuthority.test.ts",
    "tests/adviceGuardrailEvaluation.test.ts",
]
UNRELATED_TESTS = [
    # Repository-side authority, which no parser change should reach.
    "tests/integration/source-authority.test.ts",
    "tests/canonicalRoleCover.test.ts",
]

MUTATIONS = [
    # M-DEFGRAM-OFF -- the whole family goes. Intended definitions must fall back out of canonical
    # authority; if they do not, something else was recognising them and this grammar is not the
    # thing under test.
    (
        "M-DEFGRAM-OFF the definitional recogniser is never consulted",
        REQUEST,
        "  if (readings.length === 0) {\n"
        "    const definitional = containsHangul(span)\n"
        "      ? koreanDefinitionalMatch(span)\n"
        "      : definitionalMatch(normalized, span);\n"
        "    if (definitional) readings.push(definitional);\n"
        "  }",
        "",
    ),
    # M-DEFGRAM-KO-OFF -- the English half stays, the Korean half goes. Separated from the mutant
    # above because one recogniser covering for the other is exactly the confusion a single
    # whole-family mutant cannot rule out.
    (
        "M-DEFGRAM-KO-OFF the Korean definitional recogniser is never consulted",
        REQUEST,
        "    const definitional = containsHangul(span)\n"
        "      ? koreanDefinitionalMatch(span)\n"
        "      : definitionalMatch(normalized, span);",
        "    const definitional = containsHangul(span)\n"
        "      ? null\n"
        "      : definitionalMatch(normalized, span);",
    ),
    # M-DEFGRAM-KO-CARDINALITY -- the Korean counterpart of M-DEFGRAM-PREPOSITION. Without it
    # `미국 고용지표가 ... 영향은 무엇인가요` is a term rather than a relation, and STORED_MECHANISM
    # loses a row to DEFINITION.
    (
        "M-DEFGRAM-KO-CARDINALITY a clause with two marked nominals is a term again",
        REQUEST,
        "  if (markedInTerm.length > 1) return null;",
        "",
    ),
    # M-DEFGRAM-KO-PREDICATE -- without it, two operations joined by the connective 고 or by 랑 read
    # as one definitional request, and two corpus rows that must be REFUSED authorize.
    (
        "M-DEFGRAM-KO-PREDICATE material after the marker need not be predicate",
        REQUEST,
        "    if (!KOREAN_COPULAR_ENDINGS.some((e) => eojeol.endsWith(e))) return null;",
        "",
    ),
    # M-DEFGRAM-LAST-RESORT LIVED HERE AND IS REMOVED, with the measurement rather than a guess.
    #
    # It replaced the `readings.length === 0` guard with `true`, so definitional recognition
    # competed with every other operation instead of yielding to it. It was ISOLATED while the
    # English shape was a bare wh-copular; each narrowing round made it harder to catch, and after
    # round eight the guard has no observable effect at all.
    #
    # That is measured, not assumed: the guard was removed by hand and the whole 500-row corpus
    # re-run through scripts/corpus-transition-matrix.ts. CHANGED 0. The two surviving shapes are
    # narrow enough that nothing they match is matched by another construction, so there is no
    # request left for the ordering to decide.
    #
    # The guard STAYS. It enforces precedence by position rather than by a rule anyone has to
    # remember, it costs nothing, and it becomes load-bearing again the moment a shape widens. What
    # goes is the claim to have tested it: a mutant that cannot be isolated is not coverage, and
    # carrying it would report 11 of 12 forever and blunt the signal from the ones that work. Its
    # invariant is stated in `recogniseSpanUncached` and pinned as an ordinary assertion in
    # tests/definitionGrammar.test.ts.
    # M-DEFGRAM-PREPOSITION -- THE discriminator. Without it `the level of the VIX`, `the published
    # view on Brent crude` and `the weather in Seoul tomorrow` are all terms, and four corpus
    # negative controls authorize.
    (
        "M-DEFGRAM-PREPOSITION a head noun with a prepositional complement is a term again",
        REQUEST,
        "  if (!metalinguistic && tokens.some((token) => TERM_COMPLEMENT_PREPOSITIONS.has(token))) {\n"
        "    return false;\n"
        "  }",
        "",
    ),
    # M-DEFGRAM-TAIL -- the tail stops being required to be empty, so `How does the unemployment
    # rate work WITH INFLATION?` defines the first of its two terms and discards the second, and
    # `How does a stop-loss order work AMID a market crash?` becomes a definition too.
    (
        "M-DEFGRAM-TAIL a second term may hide in the predicate's tail",
        REQUEST,
        "    if (normalizedTokens(tail).length > 0) continue;",
        "",
    ),
    # M-DEFGRAM-KO-TWO-EOJEOL -- the borrowed two-eojeol proof goes. Without it a temporal adjunct
    # sits in front of the subject and `내일 주가가 뭐야?` defines `내일 주가`.
    (
        "M-DEFGRAM-KO-TWO-EOJEOL a bare final interrogative stops proving cardinality",
        REQUEST,
        "  if (finalBareInterrogative && term.length > 1) return null;",
        "",
    ),
    # M-DEFGRAM-KO-DECLINED -- the unmarked-compound exception stops distinguishing a DECLINED case
    # marker from an ABSENT one, and `기준금리은 뜻이 뭐야?` reaches the weaker reading.
    (
        "M-DEFGRAM-KO-DECLINED an ill-formed marker counts as no marker",
        REQUEST,
        "    !particleShaped &&\n",
        "",
    ),
    # M-DEFGRAM-KO-COORDINATOR -- a coordinated pair counts as one term, and
    # `ETF와 리츠의 차이는 무슨 뜻인가요?` becomes a definition of both at once.
    (
        "M-DEFGRAM-KO-COORDINATOR a coordinated pair is one term again",
        REQUEST,
        "  if (term.some((eojeol) => KOREAN_COORDINATOR_ENDINGS.some((c) => eojeol.endsWith(c)))) {\n"
        "    return null;\n"
        "  }",
        "",
    ),
    # M-DEFGRAM-KO-HEAD-CARDINALITY -- the metalinguistic path loses its one-eojeol proof, and
    # `오늘 주가 하락의 의미가 무엇인가요?` becomes a definition of a current event.
    (
        "M-DEFGRAM-KO-HEAD-CARDINALITY a metalinguistic head licenses a multi-eojeol term",
        REQUEST,
        "  if (metalinguisticMarker && term.length > 1) return null;",
        "",
    ),
    # M-DEFGRAM-KO-PREDICATE-HEAD -- a head used as the copular predicate counts as a citation, and
    # `주가가 개념인가요?` -- "IS the share price a concept" -- becomes a definition of 주가.
    (
        "M-DEFGRAM-KO-PREDICATE-HEAD a head as copular predicate is a citation",
        REQUEST,
        "    if (subjectCased) return null;",
        "",
    ),
    # M-DEFGRAM-KO-DECLINED-MODIFIER -- the declined-marker check stops reaching non-final eojeols,
    # and `기준금리은 수준이 무슨 뜻인가요?` slips past with an ill-formed 은 in front.
    (
        "M-DEFGRAM-KO-DECLINED-MODIFIER a declined marker may hide before the final eojeol",
        REQUEST,
        "  if (declinedInModifier) return null;",
        "",
    ),
    # M-DEFGRAM-KO-CITATION-SUBJECT -- a marked nominal may stand in front of a cited term, and
    # `주가가 100이라는 의미인가요?` makes a whole proposition the definiendum.
    (
        "M-DEFGRAM-KO-CITATION-SUBJECT a marked nominal may precede a citation",
        REQUEST,
        "  if (\n"
        "    cited !== null &&\n"
        "    body\n"
        "      .slice(0, at)\n"
        "      .some((eojeol) => analyseNoun(eojeol).some((a) => a.role !== null && a.role !== \"GENITIVE\"))\n"
        "  ) {\n"
        "    return null;\n"
        "  }",
        "",
    ),
    # M-DEFGRAM-KO-CONJUNCTION -- standalone coordinating conjunctions stop being refused, and
    # `채권 그리고 주식은 무슨 뜻인가요?` becomes one definition of two coordinated terms.
    (
        "M-DEFGRAM-KO-CONJUNCTION a standalone conjunction is part of the term",
        REQUEST,
        "  if (term.some((eojeol) => KOREAN_COORDINATOR_WORDS.includes(eojeol))) return null;",
        "",
    ),
    # M-DEFGRAM-KO-FRAME-PREFIX -- the request frame is stripped by PREFIX again, so any predicate
    # starting with a framing word is eaten and `주가가 무엇을 설명하나요?` becomes a definition.
    (
        "M-DEFGRAM-KO-FRAME-PREFIX the request frame is stripped by prefix",
        REQUEST,
        "  while (body.length > 0 && KOREAN_REQUEST_FRAME.includes(body[body.length - 1])) {",
        "  while (body.length > 0 && KOREAN_REQUEST_FRAME.some((f) => body[body.length - 1].startsWith(f))) {",
    ),
    # M-DEFGRAM-KO-CITATION-BARE -- bare 라는 counts as a citation again, so the adnominal form of a
    # quoted imperative is a cited term and `팔라는 뜻인가요?` becomes a definition of 팔.
    (
        "M-DEFGRAM-KO-CITATION-BARE bare 라는 counts as a citation",
        REQUEST,
        'const KOREAN_CITATION_SUFFIXES = ["이라는"];',
        'const KOREAN_CITATION_SUFFIXES = ["이라는", "라는"];',
    ),
    # M-DEFGRAM-EN-FRAME -- shape 1 stops checking that the clause is wh-copular, so
    # `How does the meaning of inflation change?` defines `inflation change`.
    (
        "M-DEFGRAM-EN-FRAME shape 1 accepts any clause containing a form of do",
        REQUEST,
        '    const prefix = normalizedTokens(normalized.slice(0, at + 1));\n'
        '    if (prefix.length < 2 || prefix[0] !== "what") continue;\n'
        '    if (prefix[1] !== "is" && prefix[1] !== "are" && prefix[1] !== "s") continue;\n'
        '    if (!prefix.slice(2).every((token) => token === "the" || token === "a" || token === "an")) {\n'
        "      continue;\n"
        "    }",
        "",
    ),
    # M-DEFGRAM-PLANNER -- the operation becomes planner-permitted. Success for this unit is
    # canonical recognition with ZERO planner calls, so a definition reaching a model must fail
    # rather than read as extra capability.
    (
        "M-DEFGRAM-PLANNER DEFINITION becomes planner-permitted",
        REQUEST,
        '    recordClass: "GLOSSARY_ENTRY",\n'
        '    temporalOperands: "NONE",\n'
        "    requiresAttribution: false,\n"
        "    deterministic: true,\n"
        "    plannerPermitted: false,",
        '    recordClass: "GLOSSARY_ENTRY",\n'
        '    temporalOperands: "NONE",\n'
        "    requiresAttribution: false,\n"
        "    deterministic: true,\n"
        "    plannerPermitted: true,",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 18. Not a substitute for the full set.")

sys.exit(harness([REQUEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
