"""M-TREEBIND: is the demotion of timestamp-only evidence load-bearing?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

The first version of `compareStartToSource` returned `BOUND` whenever the listener started after the
newest source write. Review found that unsound: a one-way STALE discriminator had been promoted
into a two-way identity proof, and a sibling checkout's server started a minute ago satisfies that
ordering while serving another tree. `BOUND` now requires a SERVED build identity.

Expected cardinality, written before the run:

  M-TREEBIND-ORDER-IS-IDENTITY   restore `started-after => BOUND`
                                 -> 5 red, measured. The foreign late-start counterexample and its
                                    disclaimer control, both order-is-not-identity controls, and
                                    the served-build-id reachability control. More than one on
                                    purpose: the same wrong claim is asserted from several
                                    directions because it is the claim that shipped.

A NEAR MISS WORTH KEEPING IN VIEW. An earlier attempt at this rework left `servesLocalBuild`
defined but never called -- the call site failed to apply, `BOUND` became unreachable, and the
whole suite stayed green because every test at the time only asserted BOUND was NOT returned. Lint
caught it, not the tests. The reachability control exists so the next dead-code slip is a red
test.

If this mutant is ever MISSED, the demotion has become decoration and a foreign server can satisfy
the strict gate again.

    python scripts/mutation/treebinding.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

BINDING = "scripts/e2e-tree-binding.ts"
TEST = "tests/e2eTreeBinding.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # A different assurance surface entirely; it must not move.
    "tests/recencyCardinality.test.ts",
]

MUTATIONS = [
    (
        "M-TREEBIND-ORDER-IS-IDENTITY a later start is treated as proof of identity again",
        BINDING,
        '    verdict: "START_ORDER_COMPATIBLE",\n'
        "    reason:\n"
        "      `the listening process started ${started.toISOString()}, after the newest source write `",
        '    verdict: "BOUND",\n'
        "    reason:\n"
        "      `the listening process started ${started.toISOString()}, after the newest source write `",
    ),
]

sys.exit(harness([BINDING], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
