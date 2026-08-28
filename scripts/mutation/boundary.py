"""Mutants for the confirmed-clause-boundary rule (P1 redirect informational authority).

WRITE/EDIT TOOL ONLY. Never edit this through a shell heredoc: one has already turned `\\n` into a
real newline inside a Python string in this project, and the run printed a cheerful success message
while having measured nothing.

## What the rule is, and why it is narrow

A candidate boundary (`[.?!;]` + whitespace) is treated as a REAL clause boundary only when the
fragment after it looks like the start of a new clause -- Hangul, a clause-opening token, or a
boundary-adjacent determiner -- and a confirmed boundary may not sit inside any run offered to the
tiling.

...and the run's HEAD must itself be a complete request, because a period only ends a sentence if a
sentence preceded it. Both halves are required: the tail-only version refused
`What did Samsung Electronics Co. 삼성전자 report about revenue?`, an ordinary Korean issuer name.

Three wider or narrower rules were tried and refuted by running them, never by reading them:

  bound role spans at every boundary   refuses `Yahoo! Finance`, `Acme Inc. revenue` -- the whole
                                       class provisional punctuation exists to reunite
  scan the tail for ANY framing token  refuses `the U.S. Bureau of Labor Statistics` (`of` is
                                       framing) AND misses the Korean case entirely (a Hangul tail
                                       carries no English tokens)
  tail evidence alone, no head test    refuses the mixed-script issuer form above and `Mr. Show`

## One mutant per separable clause

so a survivor means "this clause is not load-bearing" rather than "something somewhere changed".
B-M2 and B-M3 share an anchor, as do B-M5/B-M6/B-M7 and B-M8/B-M10; the preflight requires each
anchor to appear exactly once in the ORIGINAL, which they do.

None of these can show that CLAUSE_OPENING_TOKENS is COMPLETE. Every mutant asks whether an
implemented clause is load-bearing, and a review found six absent tokens that no mutation score
could have surfaced. B-M11 to B-M13 pin the groups that finding added; the method question is
recorded in docs/REVIEW_DEBT.md rather than treated as answered.

B-M6 is deliberately different. It "optimises" by skipping evaluation of blocked runs rather than
withholding them from the tiling. Behaviour is unchanged, so no semantic control can see it -- only
the span-evaluation COUNT test can, which is exactly why that test exists.

    python scripts/mutation/boundary.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

RA = "src/server/domain/requestAuthority.ts"

BINDING_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/integration/ask-market-refusal-invariant.test.ts",
]
UNRELATED_TESTS = [
    "tests/candidateEnvelope.test.ts",
    "tests/inferenceAuthorization.test.ts",
]

MUTATIONS = [
    # B-M14 to B-M20 REMOVED, not lost. They mutated `terminatorEndsASentence`, and ESC-015 item 2
    # deleted that rule: delimiter-local classification is no longer the authority mechanism. A
    # mutant whose target does not exist is not evidence of anything, and the harness refuses the
    # whole run on anchor drift rather than skipping it -- correctly. What those seven proved is
    # recorded in docs/REVIEW_DEBT.md; the class they closed is reopened and pinned as it.fails.
    # The Hangul rule is two conjuncts now -- the fragment must be Hangul AND must carry a Korean
    # predicate -- so it takes two mutants, one per conjunct, failing in opposite directions.
    (
        "B-M1 a Korean clause no longer confirms a boundary at all",
        RA,
        "    if (containsHangul(text)) {\n"
        "      return eojeols(text).some((eojeol) => analyseCopularInterrogative(eojeol) !== null);\n"
        "    }",
        "",
    ),
    (
        "B-M9 any Hangul confirms again, predicate or not",
        RA,
        "      return eojeols(text).some((eojeol) => analyseCopularInterrogative(eojeol) !== null);",
        "      return true;",
    ),
    (
        "B-M2 clause-opening tokens no longer confirm a boundary",
        RA,
        "    return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));",
        "    return false;",
    ),
    (
        "B-M3 only the FIRST token is scanned, not the whole fragment",
        RA,
        "    return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));",
        "    return tokens.length > 0 && CLAUSE_OPENING_TOKENS.has(tokens[0]);",
    ),
    (
        "B-M4 a boundary-adjacent determiner no longer confirms",
        RA,
        '    if (tokens.length > 0 && ["the", "a", "an", "any", "same"].includes(tokens[0]))'
        " return true;",
        "",
    ),
    (
        "B-M5 confirmation stops accumulating, so a clean later fragment launders it",
        RA,
        "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "      crossesConfirmed = last > first && confirmedBoundary[last] && headReads;",
    ),
    (
        "B-M6 blocked runs are skipped rather than withheld (cost invariant only)",
        RA,
        "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;\n"
        "      if (crossesConfirmed) continue;",
    ),
    # The head condition, added after the one-sided rule was measured refusing ordinary Korean
    # issuer names. One mutant per half of it, because the two halves fail in opposite directions:
    # dropping the condition brings the over-refusal back, and dropping only its advice clause
    # unblocks the P1 itself.
    (
        "B-M7 the head no longer has to read, so a name-internal period ends a sentence",
        RA,
        "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "      if (last > first && confirmedBoundary[last]) crossesConfirmed = true;",
    ),
    (
        "B-M8 a standalone prohibited request no longer counts as a complete head",
        RA,
        "      headReads = readings.length > 0 || detectPersonalizedAdviceRequest(span);",
        "      headReads = readings.length > 0;",
    ),
    # P1 review pointed out that B-M7 removes the whole head condition and B-M8 removes only its
    # advice clause, so the OTHER alternative -- `readings.length > 0` -- had no mutant of its own
    # and its isolation was being claimed rather than measured.
    (
        "B-M10 a readable head no longer counts, only a prohibited one",
        RA,
        "      headReads = readings.length > 0 || detectPersonalizedAdviceRequest(span);",
        "      headReads = detectPersonalizedAdviceRequest(span);",
    ),
    # And one per group of clause-opening tokens the same review's finding added, so that each
    # group is load-bearing rather than assumed to be. None of these can show the set is COMPLETE;
    # see the note on CLAUSE_OPENING_TOKENS and the open method question in docs/REVIEW_DEBT.md.
    (
        "B-M11 the added interrogatives no longer confirm",
        RA,
        '  "who",\n  "whom",\n  "whose",\n  "why",\n  "when",\n  "where",\n',
        "",
    ),
    (
        "B-M12 the added imperatives no longer confirm",
        RA,
        '  "compare",\n  "list",\n',
        "",
    ),
    (
        "B-M13 the added determiners no longer confirm",
        RA,
        '    if (tokens.length > 0 && ["the", "a", "an", "any", "same"].includes(tokens[0]))'
        " return true;",
        '    if (tokens.length > 0 && ["the", "a", "an"].includes(tokens[0])) return true;',
    ),
]

# An optional id filter, so a single mutant can be re-measured after a repair without paying for
# the other five. The full set is still what counts as evidence before a commit; re-running one
# mutant proves that mutant died, and nothing about the others.
SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 13 mutants. Not a substitute for the full set.")

sys.exit(harness([RA], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1200))
