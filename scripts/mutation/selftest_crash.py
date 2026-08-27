"""The child half of self-test control B: a harness run that dies mid-mutation.

Imported by `selftest.py` in a SEPARATE process, with
HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE=0 set, so the harness reaches `os._exit` immediately
after writing its first mutant. A separate process is required because `os._exit` takes the whole
interpreter down -- which is the point: it is the only faithful model of taskkill, a crashed shell,
or a killed session, none of which give `finally` a chance to run.

Racing an external `taskkill` would also work, and would be non-deterministic. Determinism matters
more here than realism, and the two agree on the only thing being tested: the parent stops existing
between writing a mutant and restoring it.
"""

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness as H

FIXTURE_REL = "scripts/mutation/selftest_fixture.txt"


def fast_child(tests, timeout_ms):
    return 'python -c "print(\'Test Files  1 passed (1)\'); print(\'Tests  1 passed (1)\')"'


H.harness(
    [FIXTURE_REL],
    ["x"],
    ["y"],
    [("SELF-1 flip the marker", FIXTURE_REL, "ORIGINAL_MARKER", "MUTANT_MARKER")],
    wall_seconds=60,
    command=fast_child,
    needs_db=False,
)
