"""M-ROW: can a status transition be talked into stamping evidence it merely shares an id with?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MKT-ESC014-STAT-260902-0348]`. ESC-014 made advisory rows durable and stopped
deduplicating them by protocol id; `resolveInboxEntry` still matched on the id alone, so resolving
one decision stamped every review comment on the same exchange `APPLIED` beside it. The invariant
held at the scheduling boundary and leaked at the status boundary.

Two conditions guard it now — EXACT ROW and AUTHORITY — and each gets a mutant, because either one
alone would look sufficient in a fixture that did not attack the other.

Expected cardinalities, written before the run:

  M-ROW-ID-FANOUT            match on the protocol id alone, as before
                             -> PREDICTED 3, MEASURED 2: the VALIDATED/APPLIED isolation control
                                and the rejection isolation control. The wrong-protocol-id control
                                was wrongly counted — under id-only matching "ESC-OTHER" still
                                finds no row, so it refuses for the same reason as before and stays
                                green. Corrected to what was measured. This is the exact regression
                                the decision names.

  M-ROW-NO-AUTHORITY-CHECK   resolve any exact row, authority-bearing or not
                             -> 1 red: the advisory negative control. Exactness alone is not the
                                guard: the caller there names the precise comment, so only the
                                authority condition can refuse it.

  M-ROW-SILENT-MISS          report success when no row matched
                             -> 2 red: the no-such-row control and the advisory negative control,
                                both of which assert `resolved` is false. A transition that hit
                                nothing must say so rather than return an unchanged state that
                                reads like a success.

    python scripts/mutation/esc014rowisolation.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

STATE = "src/server/controlbus/state.ts"
TEST = "tests/esc014RowIsolation.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-ROW-ID-FANOUT a transition matches every row sharing the protocol id",
        STATE,
        "      entry.protocolId === target.protocolId && entry.githubCommentId === target.githubCommentId,",
        "      entry.protocolId === target.protocolId,",
    ),
    (
        "M-ROW-NO-AUTHORITY-CHECK an advisory row can be stamped if named exactly",
        STATE,
        "  if (!isAuthorityBearing(entryKind(row))) {",
        "  if (false) {",
    ),
    (
        "M-ROW-SILENT-MISS a transition that matched nothing reports success",
        STATE,
        "    return {\n      resolved: false,\n      state,\n      reason: `no inbox row for comment ${target.githubCommentId} with protocol id ${target.protocolId}`,\n    };",
        "    return { resolved: true, state };",
    ),
]

sys.exit(harness([STATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
