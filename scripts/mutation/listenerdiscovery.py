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

  M-DISCOVERY-FIRSTROW take the first owner rather than requiring exactly one
                       -> 2 red: the two-distinct-owner control and the unparseable-row control.
                          This is the Windows defect review found, and the rule is now shared, so
                          one mutant binds both platforms.

  M-DISCOVERY-RACE     drop the two-observation agreement CHECK from the dispatcher
                       -> MISSED is the honest expectation. Reaching it needs a socket handoff
                          between two reads, which is not producible from a deterministic test. The
                          guard rests on reasoning; recorded, not rounded up.

  M-DISCOVERY-AGREE    make the agreement RULE itself always say yes
                       -> 2 red. The rule is now an exported pure function, so unlike the
                          dispatcher wiring above it can be bound by controls: the pid-reuse case
                          and the missing-observation case both fail.

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
        "M-DISCOVERY-AGREE the agreement rule always says the observations match",
        DISCOVERY,
        "  if (a === null || b === null) return false;\n"
        "  return a.pid === b.pid && a.identityToken === b.identityToken;",
        "  void a;\n  void b;\n  return true;",
    ),
    # M-DISCOVERY-FIRSTROW -- the defect review found on Windows, now a rule shared by both
    # platforms. Taking the first owner instead of requiring exactly one is how `Select-Object
    # -First 1` behaved: two distinct owners collapse to whichever the OS listed first, and row
    # order becomes authority. Expected: 2 red, the two-distinct-owner control and the
    # unparseable-row control, both of which exist for exactly this.
    (
        "M-DISCOVERY-FIRSTROW the first owner is taken instead of requiring exactly one",
        DISCOVERY,
        "  if (pids.some((p) => !Number.isInteger(p) || p <= 0)) return null;\n"
        "  const distinct = new Set(pids);\n"
        "  return distinct.size === 1 ? [...distinct][0] : null;",
        "  return pids[0];",
    ),
    (
        "M-DISCOVERY-RACE the second observation need not agree with the first",
        DISCOVERY,
        "  if (!observationsAgree(first, second)) return null;\n",
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
