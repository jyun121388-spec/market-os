"""M-ROLE-MECHANISM: is the relation endpoints' full-role cover load-bearing?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines. `rolecover.py` was corrupted that way twice before the rule stuck.

ESC-015 §17, and the mutant set that matters most in this file, because the raw comma test was
retired on the strength of this cover. Until ESC-015 §10 the parser refused any relation query
containing a comma, which cost `Alpha, Inc.` and every other comma-bearing entity name. That guard
is gone; if the cover below is not actually load-bearing, `Explain how Alpha affects Beta, Gamma.`
publishes `A -> B` and discards `C`, which is the defect the comma test existed to prevent.

So a survivor here is not a coverage note. It is evidence the retirement was premature.

  M-ROLE-MECHANISM-CAUSE / -EFFECT  each side stops being checked. Both are separate mutants
                                    because an earlier version of the qualifier rule checked only
                                    the cause, and the effect side was the half that was missing.
  M-ROLE-MECHANISM-DISCOVERY        residue reported for a role naming nothing stored, turning an
                                    ordinary inventory gap into "unsupported".
  M-ROLE-MECHANISM-STATUS           residue answered as NOT_FOUND -- nothing is published either
                                    way, so only a status assertion can see this one (§13).

    python scripts/mutation/mechanismcover.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

ASK = "src/server/domain/askMarket.ts"

BINDING_TESTS = [
    "tests/integration/relation-role-cover.test.ts",
    # The existing mechanism behaviour: orientation, the qualifier rule, nesting endpoints. A
    # mutant that survives only by breaking these is CAUGHT-BUT-BROAD, not isolated.
    "tests/integration/ask-market.test.ts",
    "tests/integration/causal-graph.test.ts",
]
UNRELATED_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/subjectClassification.test.ts",
]

MUTATIONS = [
    (
        "M-ROLE-MECHANISM-CAUSE the cause role is no longer covered",
        ASK,
        '  if (uncovered(cause, (e) => e.fromVariable)) {',
        "  if (false) {",
    ),
    (
        "M-ROLE-MECHANISM-EFFECT the effect role is no longer covered",
        ASK,
        '  if (uncovered(effect, (e) => e.toVariable)) {',
        "  if (false) {",
    ),
    (
        "M-ROLE-MECHANISM-DISCOVERY an unknown role counts as residue",
        ASK,
        "    if (discovered.length === 0) return false;\n",
        "",
    ),
    (
        "M-ROLE-MECHANISM-STATUS residue is answered as an inventory gap",
        ASK,
        '          status: "REQUEST_NOT_SUPPORTED",\n'
        "          query: trimmed,\n"
        "          redirectMessage: residue,",
        '          status: "NOT_FOUND",\n'
        "          query: trimmed,\n"
        "          redirectMessage: residue,",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 4. Not a substitute for the full set.")

sys.exit(harness([ASK], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
