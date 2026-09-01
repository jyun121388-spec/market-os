"""M-CARDPART: is the partition-implication check load-bearing, or decoration?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`proveSingleRow` accepts a UNION OF PARTIAL INDEXES as proof of single-row cardinality. Review found
the first version of that branch unsound: complementary `IS NULL` / `IS NOT NULL` predicates
partition the candidate UNIVERSE, and that is not the same as making the union unique. If the query
leaves the partition column unconstrained, one row can match in each branch -- each index
individually unique, two rows returned, `findFirst` choosing arbitrarily.

The repair is one line, `if (!pinned.has(column)) continue;`, and a one-line guard is exactly the
kind of thing a later edit deletes without anything failing. So it gets a mutant.

Expected cardinality, written before the run:

  M-CARDPART-IMPLICATION   remove the partition-column check, leave both partial indexes intact
                           -> exactly 1 red: the control that moves the partition to a column the
                              query does not constrain. Every other control is unaffected, because
                              the real site DOES pin `periodStart` and its verdict does not change.

If this ever produces more than one red, the other controls have started depending on the guard for
reasons of their own and the isolation this mutant proves is gone.

    python scripts/mutation/cardinalitypartition.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

AUDIT = "scripts/recency-cardinality.ts"
TEST = "tests/recencyCardinality.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # The recency audit reads the same schema and must not move.
    "tests/providerCapability.test.ts",
]

MUTATIONS = [
    (
        "M-CARDPART-IMPLICATION the partition column need not be constrained by the query",
        AUDIT,
        "    if (!pinned.has(column)) continue;\n",
        "",
    ),
]

sys.exit(harness([AUDIT], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
