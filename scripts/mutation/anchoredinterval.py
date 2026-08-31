"""M-ANCHOR: is the anchored-interval refusal load-bearing, and does it refuse for the right reason?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines.

The defect this guards was measured, not supposed. At `10c1de2`, every one of `since`, `from`,
`after`, `before`, `until` and `through` in front of an interval bound the PLAIN operand:

    "What was the change in US CPI since last year?"   -> OBSERVED_CHANGE, interval `last year`
    "What was the change in US CPI last year?"         -> OBSERVED_CHANGE, interval `last year`

Two different questions, one answer. At an asOf of 2026-08-25 both resolve 2025-01-01..2025-12-31,
so the `since` reading silently loses the eight months since it, and the `before` reading is
answered with the COMPLEMENT of the period it named. `since last year` is additionally an operand
`resolveObservationPeriod` deliberately REFUSES -- three readings, no principle to choose -- and the
refusal was bypassed because the scan finds the shorter ` last year ` inside it first.

The mutants are weighted towards the refusal DIRECTION rather than the recall: a grammar that
accepts more intervals is easy, and one that refuses the anchored ones without losing the
transparent ones is the actual claim.

  M-ANCHOR-OFF          the governing preposition is never inspected
  M-ANCHOR-DENYLIST     the allowlist becomes a denylist, so an unlisted anchor is admitted again
  M-ANCHOR-ADJACENT     determiners stop being stepped over, so `since THE last quarter` slips past
  M-ANCHOR-TRANSPARENT  a transparent preposition stops being transparent

    python scripts/mutation/anchoredinterval.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

REQUEST = "src/server/domain/requestAuthority.ts"

BINDING_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/observationPeriod.test.ts",
]
UNRELATED_TESTS = [
    # A parser boundary change must not reach repository-side authority.
    "tests/integration/source-authority.test.ts",
    "tests/definitionGrammar.test.ts",
]

MUTATIONS = [
    # M-ANCHOR-OFF -- the whole guard goes. Every anchored form must go back to binding the plain
    # operand; if it does not, something else was refusing them and this rule is not the thing
    # under test.
    (
        "M-ANCHOR-OFF the governing preposition is never inspected",
        REQUEST,
        "      if (\n"
        "        word !== null &&\n"
        "        TERM_COMPLEMENT_PREPOSITIONS.has(word) &&\n"
        "        !TRANSPARENT_INTERVAL_PREPOSITIONS.has(word)\n"
        "      ) {\n"
        "        continue;\n"
        "      }",
        "",
    ),
    # M-ANCHOR-DENYLIST -- the direction is inverted. Membership in the transparent set becomes the
    # thing that REFUSES, which is what a denylist of anchors would have looked like: an anchor
    # nobody listed is admitted and silently reinterpreted.
    (
        "M-ANCHOR-DENYLIST an unlisted anchor is admitted again",
        REQUEST,
        "        !TRANSPARENT_INTERVAL_PREPOSITIONS.has(word)\n",
        "        TRANSPARENT_INTERVAL_PREPOSITIONS.has(word)\n",
    ),
    # M-ANCHOR-ADJACENT -- only the adjacent token is inspected, so a determiner defeats the rule
    # and `since the last quarter` binds `last quarter`. This is the exact shape the DEFINITION unit
    # was caught by twice: a check that looks at the surface next to it rather than at the governor.
    (
        "M-ANCHOR-ADJACENT a determiner defeats the rule",
        REQUEST,
        "      while (governor >= 0 && INTERVAL_DETERMINERS.has(preceding[governor])) governor -= 1;\n",
        "",
    ),
    # M-ANCHOR-TRANSPARENT -- `over` stops being transparent, which must break the one corpus row
    # this construction authorizes rather than passing quietly.
    (
        "M-ANCHOR-TRANSPARENT a transparent preposition stops being transparent",
        REQUEST,
        'const TRANSPARENT_INTERVAL_PREPOSITIONS = new Set(["over", "in", "during", "for"]);',
        'const TRANSPARENT_INTERVAL_PREPOSITIONS = new Set(["in", "during", "for"]);',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 4. Not a substitute for the full set.")

sys.exit(harness([REQUEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
