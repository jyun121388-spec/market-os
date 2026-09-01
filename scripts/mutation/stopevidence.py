"""M-STOP: can the stop-sentinel gatherer be talked into manufacturing a fact?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`gatherStopEvidence` feeds `evaluateStopSentinel`, which `CLAUDE.md` names as the only normal
completion sentinel. Its single governing rule is that a fact it cannot establish comes back
UNDEFINED -- never zero, never "ALIVE". Every mutant below breaks that rule in a different place,
and each one is a bug a reasonable implementation could ship: `loadState` really does answer
`emptyState()` for a missing file, and `processAlive(0)` really does answer true.

The direction of the error is what matters. A gatherer that under-reports keeps the sentinel at
false, which costs nothing. A gatherer that over-reports tells the loop it may stop.

Expected cardinalities, written before the run:

  M-STOP-UNREAD-IS-EMPTY     a missing state file reports zero decisions instead of unestablished
                             -> 1 red: the unread-inbox control. This is the exact one-liner the
                                module was written to avoid, and it looks completely reasonable.

  M-STOP-PID-ANY             drop the `pid > 0` check
                             -> 1 red: the dead-pid control, via pid 0. `process.kill(0, 0)`
                                addresses the process group, so this reads a malformed lock as a
                                live watcher.

  M-STOP-IGNORE-STALE        drop the heartbeat staleness check
                             -> 1 red: the live-vs-lapsed control. Same live pid in both halves of
                                that control, so only staleness can be answering.

  M-STOP-ROOT-IS-STOPPED     treat a missing runtime dir as a stopped watcher
                             -> 1 red: the wrong-root control. Absence of the directory is evidence
                                about the DIRECTORY; the watcher writes it relative to its own cwd.

  M-STOP-SILENT-GAPS         stop explaining the facts that were not attempted
                             -> 1 red: the accounted-for control. An unlisted gap reads as an
                                oversight, and this module's whole value is that its refusal is
                                legible.

    python scripts/mutation/stopevidence.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

EVIDENCE = "scripts/stop-evidence.ts"
TEST = "tests/stopEvidence.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-STOP-UNREAD-IS-EMPTY an inbox that was never read is reported as an empty one",
        EVIDENCE,
        "    unestablished.push({\n"
        '      field: "receivedDecisions",\n'
        "      because: `${paths.state} does not exist, so the inbox has not been read "
        "— which is not the same as it being empty`,\n"
        "    });",
        "    supplied.receivedDecisions = 0;",
    ),
    (
        "M-STOP-PID-ANY a lock naming pid 0 counts as a live watcher",
        EVIDENCE,
        "        lock.pid > 0 &&\n",
        "",
    ),
    (
        "M-STOP-IGNORE-STALE a watcher that stopped heartbeating still counts as alive",
        EVIDENCE,
        "        processAlive(lock.pid) &&\n        !lockIsStale(lock, staleMs, nowMs);",
        "        processAlive(lock.pid);",
    ),
    (
        "M-STOP-ROOT-IS-STOPPED a missing runtime directory is read as a stopped watcher",
        EVIDENCE,
        "  if (!existsSync(paths.root)) {",
        "  if (false) {",
    ),
    (
        "M-STOP-SILENT-GAPS the facts that were not attempted go unexplained",
        EVIDENCE,
        "  unestablished.push(...NOT_ATTEMPTED);",
        "  unestablished.push();",
    ),
]

sys.exit(harness([EVIDENCE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
