"""M-AUTOCTX: is the autonomy boundary load-bearing, or does it only look explicit?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

IR-126. `scripts/next-work.ts` called `scheduleNextWork()` bare and printed `ACTIONABLE 5` on a
machine with no provider key. `scripts/autonomy-context.ts` now establishes the environment first
and passes it unconditionally, holds unestablished facts closed, and checks every startable item's
named gate against the register. Each mutant below is the simplification a future edit would most
plausibly make, and each errs toward CLAIMING that something is startable.

Expected cardinalities, written before the run so a surprise cannot be reinterpreted afterwards;
corrected to the measured number where they differed, with the reason (run 09ea94b7f888,
2026-09-06: 5 of 5 ISOLATED, unrelated 41/41 green throughout).
Binding suite: tests/autonomyContext.test.ts.

  M-AUTOCTX-OMIT             the boundary stops passing the context it built
                             -> 3 red: "schedules nothing" (actionable 0 becomes 4), "where the
                                optimism ends" (bare == bounded), and "not emitted while anything
                                is startable"'s twin "is a statement about the queue" (verdict flips
                                to STARTABLE). The gate controls stay GREEN: they defer through the
                                register, not through the environment, and that independence is
                                the point of measuring them separately.

  M-AUTOCTX-UNKNOWN-AVAILABLE an unestablished GitHub credential is supplied as true
                             -> PREDICTED 1, MEASURED 2. "held closed, listed with its reason" was
                                foreseen. The second is "says whether the zero is a finding or a
                                fact held closed": the queue verdict names every field held closed,
                                and a field supplied as true is no longer held, so the reason it
                                prints loses `credentialsAvailable`. The verdict's honesty about
                                WHY the queue is empty turned out to depend on the encoding table,
                                which is the right dependency and one the prediction missed.

  M-AUTOCTX-ANYKEY           one present key is enough for providerKeyAvailable
                             -> 1 red: "needs every known key". The no-key control stays green
                                because `some` over nothing is still false, which is exactly why a
                                FRED-only fixture exists.

  M-AUTOCTX-GATE-IGNORED     startable items are never checked against the register
                             -> 2 red: "unlocks only the work whose gate is resolved" (OPENDART
                                surfaces) and "defers an item whose gate cannot be found". The
                                no-key control stays green: without keys the engine defers those
                                items on its own, and the gate rule is the SECOND line, not the
                                first.

  M-AUTOCTX-UNKNOWN-GATE     a gate the register does not mention counts as resolved
                             -> 1 red: "defers an item whose gate cannot be found", through its
                                omitted-gate half. The unreadable-register half still defers, so
                                the control goes red on exactly one of its two assertions.

    python scripts/mutation/autonomycontext.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

BOUNDARY = "scripts/autonomy-context.ts"
TEST = "tests/autonomyContext.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # The library's own controls, including the pin that an omitted context is optimistic, and the
    # stop-evidence gatherer this boundary sits beside. Neither may move.
    "tests/evolutionScheduler.test.ts",
    "tests/stopEvidence.test.ts",
]

MUTATIONS = [
    (
        "M-AUTOCTX-OMIT the boundary stops passing the context it built",
        BOUNDARY,
        "  const scheduled = scheduleNextWork({\n"
        "    context: environment.context,\n"
        "    completed: options.completed,\n",
        "  const scheduled = scheduleNextWork({\n"
        "    completed: options.completed,\n",
    ),
    (
        "M-AUTOCTX-UNKNOWN-AVAILABLE an unestablished credential is supplied as available",
        BOUNDARY,
        "  credentialsAvailable: false,\n  includedModelQuotaAvailable: false,\n",
        "  credentialsAvailable: true,\n  includedModelQuotaAvailable: false,\n",
    ),
    (
        "M-AUTOCTX-ANYKEY one present key is enough for providerKeyAvailable",
        BOUNDARY,
        "  const everyKeyPresent = (Object.keys(providerKeys) as ProviderCode[]).every(\n",
        "  const everyKeyPresent = (Object.keys(providerKeys) as ProviderCode[]).some(\n",
    ),
    (
        "M-AUTOCTX-GATE-IGNORED startable items are never checked against the register",
        BOUNDARY,
        "  const { queue, deferrals } = deferOpenGates(scheduled, register);\n",
        "  const { queue, deferrals } = { queue: scheduled, deferrals: [] as GateDeferral[] };\n",
    ),
    (
        "M-AUTOCTX-UNKNOWN-GATE a gate the register does not mention counts as resolved",
        BOUNDARY,
        '      status: register === null ? "UNKNOWN (register unreadable)" : (register.get(id) ?? "UNKNOWN"),\n',
        '      status: register === null ? "UNKNOWN (register unreadable)" : (register.get(id) ?? "RESOLVED"),\n',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([BOUNDARY, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
