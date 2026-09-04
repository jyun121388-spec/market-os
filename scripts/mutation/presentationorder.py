"""M-PRESORDER: does the total-order proof actually know about NULL?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`isTotalOrder` first concluded that covering every field of a non-partial unique key means "no two
rows can tie". Review found that unsound for PostgreSQL: NULL is distinct from NULL in an ordinary
unique index, so a unique key containing a NULLABLE column admits many rows holding NULL there, and
ordering by the whole key still ties on them. This repository records the trap in its own schema --
`Observation.revisionOf String?` inside `@@unique([seriesId, observationDate, isRevision,
revisionOf])`, with a hand-written partial index alongside it for exactly that reason.

The repair is one condition, and a one-condition repair is what a later edit deletes.

Expected cardinalities, written before the run:

  M-PRESORDER-NULLBLIND  drop the nullability requirement from the proof
                         -> 1 red: the nullable-key control. The non-null control stays green,
                            which is what makes the mutant about nullability rather than about
                            coverage, and the real 44-site distribution does not move -- none of
                            the current TOTAL_ORDER sites cites a nullable key, so this mutant
                            cannot be caught by the corpus and needs its own control.

  M-PRESORDER-PARTIAL    let a PARTIAL index establish a total order
                         -> 2 red, measured; I predicted 1 and the number is corrected rather than
                            the prediction re-read. The partial-index control and the
                            keeps-looking control, the second because a partial key it should have
                            skipped now answers first. A partial index constrains a subset and a
                            total order is a statement about all rows.

If NULLBLIND is ever MISSED, the nullable control has stopped binding and the proof has quietly
gone back to "covered means unique".

    python scripts/mutation/presentationorder.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

AUDIT = "scripts/presentation-order.ts"
TEST = "tests/presentationOrder.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/recencyCardinality.test.ts"]

MUTATIONS = [
    (
        "M-PRESORDER-NULLBLIND the proof stops caring whether a key field can be NULL",
        AUDIT,
        "    const nullableInKey = key.fields.filter((f) => nullable.has(f));\n"
        "    if (nullableInKey.length > 0) {\n",
        "    const nullableInKey: string[] = [];\n"
        "    if (nullableInKey.length > 99) {\n",
    ),
    (
        "M-PRESORDER-PARTIAL a partial index is allowed to establish a total order",
        AUDIT,
        "    if (key.partial) continue;\n    if (!key.fields.every((f) => present.has(f))) continue;\n"
        "    const nullableInKey",
        "    if (!key.fields.every((f) => present.has(f))) continue;\n    const nullableInKey",
    ),
]

sys.exit(harness([AUDIT], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
