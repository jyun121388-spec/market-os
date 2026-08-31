"""M-CHGNOM: is the change-nominal construction family load-bearing, and does each part fail alone?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines.

Obligation 7B of `DEC-INTERVAL-FAMILY-20260831`, decided as
`[CHATGPT_DECISION][MARKET-OS][DEC-CHANGE-CONSTRUCTION-20260831]`: ONE structurally specified
change-nominal family, `the <HEAD> in <SUBJECT> <INTERVAL>`, with a CLOSED head slot -- not a phrase
inventory and not a row per synonym.

The decision requires mutations to hit the intended cardinality EXACTLY and calls a
zero-match/ambiguous/wrong-reason failure INVALID. So each mutant below removes exactly one part of
the family, and the binding test that must go red is the one stating that part:

  M-CHGNOM-OFF       the family is not registered at all -> DEV-EN-038 leaves canonical authority
  M-CHGNOM-HEAD      the head slot collapses to the single literal it replaced -> `move in` is lost
  M-CHGNOM-RELATION  the `in` relation is dropped -> the appositive DEV-EN-045 is picked up silently
  M-CHGNOM-OPEN      an unevidenced head is admitted -> the closed slot becomes a synonym list

    python scripts/mutation/changenominal.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

REQUEST = "src/server/domain/requestAuthority.ts"

BINDING_TESTS = [
    "tests/requestAuthority.test.ts",
    # The interval half of the same unit: the family's interval must stay load-bearing.
    "tests/observationPeriod.test.ts",
]
UNRELATED_TESTS = [
    # Neither repository-side authority nor the definition grammar should move.
    "tests/integration/source-authority.test.ts",
    "tests/definitionGrammar.test.ts",
]

MUTATIONS = [
    # M-CHGNOM-OFF -- the family is never registered. DEV-EN-038 must fall out of canonical
    # authority; if it does not, something else was recognising it and this family is not the thing
    # under test.
    (
        "M-CHGNOM-OFF the change-nominal family is not registered",
        REQUEST,
        "  ...CHANGE_NOMINAL_CONSTRUCTIONS,\n",
        "",
    ),
    # M-CHGNOM-HEAD -- the slot collapses back to the one literal it replaced. This is the exact
    # before-state of this unit, so `the move in ...` must stop being recognised while
    # `the change in ...` keeps working -- a wrong-reason failure would show as both going red.
    (
        "M-CHGNOM-HEAD the head slot collapses to the single literal it replaced",
        REQUEST,
        'const CHANGE_NOMINAL_HEADS = ["change", "move"] as const;',
        'const CHANGE_NOMINAL_HEADS = ["change"] as const;',
    ),
    # M-CHGNOM-RELATION -- the `in` relation is dropped from the marker, leaving a bare head. The
    # appositive DEV-EN-045 must then be picked up, which is the case the decision explicitly
    # refuses to authorize.
    (
        "M-CHGNOM-RELATION the `in` relation is dropped from the construction",
        REQUEST,
        "  markers: [` ${head} in `, null] as const,",
        "  markers: [` ${head} `, null] as const,",
    ),
    # M-CHGNOM-OPEN -- an unevidenced head joins the slot, turning a closed construction slot into
    # the synonym inventory the architecture pass prohibited. No corpus row supports `swing`.
    (
        "M-CHGNOM-OPEN an unevidenced head is admitted into the slot",
        REQUEST,
        'const CHANGE_NOMINAL_HEADS = ["change", "move"] as const;',
        'const CHANGE_NOMINAL_HEADS = ["change", "move", "swing"] as const;',
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
