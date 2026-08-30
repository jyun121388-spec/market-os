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
  M-DEFGRAM-LAST-RESORT    it competes with other operations instead of yielding to them
  M-DEFGRAM-PREPOSITION    a head noun with a prepositional complement counts as a term again
  M-DEFGRAM-TAIL           the predicate's tail stops being checked, so a second term hides in it
  M-DEFGRAM-PLANNER        DEFINITION becomes planner-permitted

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
        "    const definitional = definitionalMatch(normalized, span);\n"
        "    if (definitional) readings.push(definitional);\n"
        "  }",
        "",
    ),
    # M-DEFGRAM-LAST-RESORT -- it runs unconditionally instead of only when nothing else matched.
    # Precedence is enforced by POSITION here rather than by an ordering rule, so removing the guard
    # should make requests that another operation owns become two readings, i.e. AMBIGUOUS.
    (
        "M-DEFGRAM-LAST-RESORT definitional recognition competes instead of yielding",
        REQUEST,
        "  if (readings.length === 0) {\n"
        "    const definitional = definitionalMatch(normalized, span);",
        "  if (true) {\n"
        "    const definitional = definitionalMatch(normalized, span);",
    ),
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
    # M-DEFGRAM-TAIL -- only the head is checked, so `How does the unemployment rate work WITH
    # INFLATION?` defines the first of its two terms and discards the second.
    (
        "M-DEFGRAM-TAIL a second term may hide in the predicate's tail",
        REQUEST,
        "    if (!isSingleTermRegion(term, raw) || !isSingleTermRegion(` x ${tail}`, raw)) continue;",
        "    if (!isSingleTermRegion(term, raw)) continue;",
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
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([REQUEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
