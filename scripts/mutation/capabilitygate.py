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
             `docs/HUMAN_GATE_QUEUE.md`, and that it is THE gate owning that provider.

So the mutants below attack the second half only -- the first half is unreachable from a mutation
harness that runs vitest, and pretending otherwise would be the coverage theatre this file exists
to avoid.

WHY M-CAPGATE-WRONGGATE EXISTS, recorded because it is a review finding rather than foresight.
The first version of this suite shipped with only a nonexistent-id mutant, and independent review
pointed out what that does not prove: `HG-007` is production deployment, `HG-008` is payment
activation, both are real, both occur in the register, and neither owns FRED's live response. The
existence test passed them. Occurrence was never the claim. Reproduced before repairing -- both
ids returned shape=true, inRegister=true -- and the semantic control was added to close it.

Expected cardinalities, written before the run so a surprise cannot be reinterpreted afterwards:

  M-CAPGATE-WRONGGATE     a real gate that owns something else  -> 1 red, the ownership test ALONE
  M-CAPGATE-UNDOCUMENTED  a well-shaped gate that names nothing -> 2 red, existence + ownership
  M-CAPGATE-SHAPE         a gate that is not an id at all       -> 3 red, shape + both of the above
  M-CAPGATE-REGISTER      the register is read but not required -> MISSED, and declared so

The first is the load-bearing one: it is the only mutant that isolates ownership from existence,
and if it ever produces 2 reds the existence test has started doing ownership's job by accident.

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
    # M-CAPGATE-WRONGGATE -- the review finding, made load-bearing. `HG-007` is production
    # deployment: a real gate, present in the register, owning nothing about FRED. Shape passes and
    # existence passes, so ONE red is the whole point. Two reds would mean the existence test had
    # quietly started deciding ownership, and the isolation this mutant exists to prove would be
    # gone without anything failing.
    (
        "M-CAPGATE-WRONGGATE a cell names a real gate that owns something else",
        CAPABILITY,
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-002",',
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-007",',
    ),
    # M-CAPGATE-UNDOCUMENTED -- `HG-999` passes the shape rule, so shape must NOT be the thing that
    # fires. Existence and ownership both fail on it, which is honest rather than isolated: an id
    # that exists nowhere also owns nothing, and one edit genuinely violates both claims.
    (
        "M-CAPGATE-UNDOCUMENTED a cell names a well-shaped gate that does not exist",
        CAPABILITY,
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-002",',
        '      "The same field as observation_time if the observation is an instant.",\n'
        '      "HG-999",',
    ),
    # M-CAPGATE-SHAPE -- a gate that is not an id at all, so all three claims are genuinely
    # violated by one edit and three reds is the honest number. Stated in advance so a future run
    # cannot reinterpret the count after seeing it.
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
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 4. Not a substitute for the full set.")

sys.exit(
    harness([CAPABILITY, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900)
)
