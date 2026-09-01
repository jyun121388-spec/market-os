"""M-REACH: can the reach classifier be talked into clearing a site it should not?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`order-reaches-output` narrows the non-total-order sites to the ones whose nondeterminism a reader
can see. Two things it must never do: discharge a site on an operation whose result depends on
arrival order, and answer at all when its parent pointers are missing.

Both have already gone wrong once each, which is why they get mutants rather than comments.

Expected cardinalities, written before the run:

  M-REACH-ORDER-BLIND-WIDE   put `find` back among the order-blind operations
                             -> 2 red: the exact-membership control and the refuses-order-sensitive
                                control. It CANNOT be caught by the corpus -- nothing today is
                                ORDER_DISCARDED -- so it is caught only by the contract controls
                                written for it, which is the point of having them.

  M-REACH-NO-CHECKER         remove the `getTypeChecker()` that binds parent pointers
                             -> 3 red, measured. The parents regression control plus the two that
                                name a specific site, since with parents undefined nothing resolves
                                and every row returns the same empty reason -- exactly the uniform
                                answer that control exists to reject.

    python scripts/mutation/orderreach.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

REACH = "scripts/order-reaches-output.ts"
TEST = "tests/orderReachesOutput.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/recencyCardinality.test.ts"]

MUTATIONS = [
    (
        "M-REACH-ORDER-BLIND-WIDE a first-match operation is treated as order-blind",
        REACH,
        'export const ORDER_BLIND = new Set(["some", "every", "includes", "length"]);',
        'export const ORDER_BLIND = new Set(["some", "every", "includes", "length", "find"]);',
    ),
    (
        "M-REACH-NO-CHECKER the program is never bound, so parent pointers are missing",
        REACH,
        "  program.getTypeChecker();\n",
        "",
    ),
]

sys.exit(harness([REACH], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
