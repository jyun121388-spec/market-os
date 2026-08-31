"""M-CAPGATE: is the "every unverified cell names a REAL gate" rule load-bearing?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

The PROVIDER_ASSUMPTION cluster's proposed change has a half that needs no credential: every
NOT_VERIFIED cell names the gate that would clear it. An audit found the convention already intact,
so the work was to make it unbreakable rather than to fix data -- and an invariant that already
holds is exactly the one whose tests are hardest to trust, because they pass before and after.

The invariant is now carried in two places with a deliberate division:

  THE TYPE   `CapabilityEvidence` is a discriminated union. NOT_VERIFIED requires `blockedBy`,
             every other state forbids it. Those two violations DO NOT COMPILE, which is proved by
             `scripts/capability-type-proof.ts` rather than by a runtime assertion that could never
             observe a compile error.

  THE TESTS  what a type cannot say: the gate is well-SHAPED, and the gate EXISTS in
             `docs/HUMAN_GATE_QUEUE.md`.

So the mutants below attack the second half only -- the first half is unreachable from a mutation
harness that runs vitest, and pretending otherwise would be the coverage theatre this file exists
to avoid.

  M-CAPGATE-UNDOCUMENTED  a well-shaped gate that names nothing -> the register test alone
  M-CAPGATE-SHAPE         a gate that is not an id at all       -> shape and register together
  M-CAPGATE-REGISTER      the register is read but not required -> the guard that stops a silently
                          empty register from passing everything

    python scripts/mutation/capabilitygate.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

CAPABILITY = "src/server/fabric/providerCapability.ts"
TEST = "tests/providerCapability.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # The matrix is read by Verify and by the evolution scheduler. Neither should move.
    "tests/evolutionScheduler.test.ts",
]

MUTATIONS = [
    # M-CAPGATE-UNDOCUMENTED -- the exact hole the new test was written to close. `HG-999` passes
    # the shape rule that existed before, so if only the shape test goes red the new test is not
    # doing anything; the register test must be the one that fires, and alone.
    (
        "M-CAPGATE-UNDOCUMENTED a cell names a well-shaped gate that does not exist",
        CAPABILITY,
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-002",',
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-999",',
    ),
    # M-CAPGATE-SHAPE -- a gate that is not an id. Both tests are expected to fire here, and that
    # is not a defect in isolation: shape and existence are genuinely both violated by one edit.
    # Recorded with the expectation stated so a future run cannot read two reds as a surprise.
    (
        "M-CAPGATE-SHAPE a gate that is prose rather than an id",
        CAPABILITY,
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-002",',
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "needs a credential",',
    ),
    # M-CAPGATE-REGISTER -- delete the guard that requires the register to contain any gate at all.
    # Without it, a register that failed to parse would make every membership check pass vacuously,
    # which is the "silent zero" failure this repository has been bitten by more than once. The
    # mutant is expected to be MISSED by the current suite and that is the finding, not a failure:
    # the guard protects against a future edit to the register path, and nothing today exercises it.
    (
        "M-CAPGATE-REGISTER the empty-register guard is removed",
        TEST,
        '    expect(documented.size, "no gate ids found in docs/HUMAN_GATE_QUEUE.md").toBeGreaterThan(0);\n',
        "",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 3. Not a substitute for the full set.")

sys.exit(
    harness([CAPABILITY, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900)
)
