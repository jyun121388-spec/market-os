"""A real harness run over the self-test fixture, as a separate process, for control D.

Control D needs two logs that differ in exactly one respect: one run reached its end and one did
not. Both must be produced by the REAL harness, because the thing under test is whether a truncated
log can be told apart from a complete one by reading it -- and a hand-written imitation of a log
would only prove that the checker matches the imitation.

Two mutations, not one, and both anchored on the same marker (each anchor still occurs exactly once
in the original, which the preflight requires). Two is the minimum that lets a crash land AFTER a
verdict has already been printed: with one mutation the interrupted log carries no verdict line at
all, and a control fed no stale verdict cannot show that stale verdicts are excluded.

  HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE unset  ->  complete log, RUN_COMPLETED present
  HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE=1      ->  one verdict, then death, no RUN_COMPLETED
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness as H

FIXTURE_REL = "scripts/mutation/selftest_fixture.txt"


def fast_child(tests, timeout_ms):
    return 'python -c "print(\'Test Files  1 passed (1)\'); print(\'Tests  1 passed (1)\')"'


MUTATIONS = [
    ("SELF-1 flip the marker", FIXTURE_REL, "ORIGINAL_MARKER", "MUTANT_MARKER"),
    ("SELF-2 flip the marker another way", FIXTURE_REL, "ORIGINAL_MARKER", "OTHER_MARKER"),
]

sys.exit(
    H.harness(
        [FIXTURE_REL],
        ["x"],
        ["y"],
        MUTATIONS,
        wall_seconds=60,
        command=fast_child,
        needs_db=False,
    )
)
