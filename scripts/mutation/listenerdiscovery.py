"""M-DISCOVERY: is socket OWNERSHIP what selects the process, or just whichever node is handy?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`discoverListener` must answer "which process owns the socket listening on this port" from kernel
evidence, and nothing else. The named ways to get it wrong -- process name, image path, command
line, cwd, age, whichever PID makes a test pass -- would each select a plausible process on a
machine running many node processes that share one `node_modules`, and would be stably wrong.

Two mutants, and the second is the one that matters, because a name-based selector is what a
hurried implementation reaches for and it passes any test that only asserts "some listener was
found".

Expected cardinalities, written before the run:

  M-DISCOVERY-RACE     accept the first observation without the second agreeing
                       -> MISSED is the honest expectation. The race window is not reachable from
                          a deterministic test, so this records that the guard rests on reasoning
                          rather than on a control. Recorded, not rounded up.

  M-DISCOVERY-SELF     select the current process instead of the socket owner
                       -> 4 red, measured; I predicted 2 and the number is corrected rather than
                          the prediction re-read. The same-process control cannot catch it -- the
                          test owns the listener, so `process.pid` is the right answer there. The
                          killers are the controls asserting discovery goes NULL when nothing is
                          listening, plus the ones that reach a verdict through real discovery.

A FIRST ATTEMPT AT THIS MUTANT WAS BROKEN, and is recorded rather than quietly replaced. It put the
fallback on the FIRST observation only (`discover(port) ?? {...}`), so the second observation still
returned null for a closed port and the dispatcher refused anyway. It came back MISSED -- which I
had predicted, for a reason that turned out to be wrong. A MISSED predicted for the wrong reason is
a broken mutant, not a finding, so the mutant was fixed rather than the prediction reinterpreted.

Both cardinalities are stated up front so a MISSED cannot be reinterpreted afterwards as coverage.

    python scripts/mutation/listenerdiscovery.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

DISCOVERY = "scripts/listener-discovery.ts"
TEST = "tests/e2eTreeBinding.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/recencyCardinality.test.ts"]

MUTATIONS = [
    (
        "M-DISCOVERY-RACE the second observation need not agree with the first",
        DISCOVERY,
        "  if (first.pid !== second.pid || first.identityToken !== second.identityToken) return null;\n",
        "",
    ),
    (
        "M-DISCOVERY-SELF the current process is selected instead of the socket owner",
        DISCOVERY,
        '  const discover = process.platform === "win32" ? discoverWindows : discoverLinux;',
        "  const discover = (_p: number): ListenerIdentity | null => ({\n"
        "    pid: process.pid,\n"
        "    exe: null,\n"
        "    commandLine: null,\n"
        "    started: new Date(),\n"
        '    identityToken: "mutant",\n'
        '    authority: "mutant: current process, not the socket owner",\n'
        "  });",
    ),
]

sys.exit(harness([DISCOVERY], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
