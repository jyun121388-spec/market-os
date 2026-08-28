"""M-CANDIDATE: can repository availability erase an unresolved request role?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes inside Python strings.

ESC-015 item 7: repository inventory must NEVER decide what the request meant. The candidate layer
is where inventory enters, so this is where that rule can actually be violated, and it needs its own
run rather than a mutant bolted onto the parser set.

## Why this is a SEPARATE runner

The brief lists "unrelated higher gate refuses first" as INVALID mutation evidence, and the parser
guard would do exactly that to a naive M-CANDIDATE. `Explain how Alpha affects Beta and Gamma.` is
refused by `relationEndpointNamesTwoThings` before any lookup happens, so mutating the envelope
could not change its verdict and the mutant would die for the wrong reason -- or survive for one.

The discriminating input has to carry residue the PARSER cannot see and the ENVELOPE can:
`Explain how A affects B only if C.` has no coordinator, no comma and no comparator, so the relation
grammar accepts it; the envelope then refuses because the effect region is not exactly framing plus
the resolved identity. That check is the guard under test.

The binding and unrelated sets are also swapped relative to the parser runs, which is the point of
running this separately: `candidateEnvelope` and `inferenceAuthorization` bind here, and
`requestAuthority` and its Korean suite become the unrelated negative controls. A mutant that breaks the parser instead
of the envelope shows up as CAUGHT-BUT-BROAD rather than ISOLATED.

    python scripts/mutation/candidate.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

CE = "src/server/domain/candidateEnvelope.ts"

BINDING_TESTS = [
    # The end-to-end file is FIRST because it is the one that reaches the resolver. The unit file
    # deliberately does not: it constructs envelopes by hand to reach predicates the resolver never
    # emits, which is useful and is not production-path coverage. Running this set with only the
    # unit file scored 0 of 3, and that is what "no test calls this function" looks like.
    "tests/integration/candidate-envelope-mechanism.test.ts",
    "tests/candidateEnvelope.test.ts",
    "tests/inferenceAuthorization.test.ts",
]
UNRELATED_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/requestAuthorityKorean.test.ts",
]

MUTATIONS = [
    # M-CANDIDATE proper: the role region no longer has to be exactly framing plus the resolved
    # identity, so anything the repository happens to recognise inside a region satisfies the role
    # and whatever else the region says is discarded. That is inventory deciding what the request
    # meant.
    (
        "M-CANDIDATE repository availability erases unresolved role text",
        CE,
        "        if (regionIsExactlyFramingAndIdentity(region, identity)) continue;",
        "        if (true) continue;",
    ),
    # The cardinality half, isolated separately: more than one stored endpoint named in a region is
    # currently AMBIGUOUS, and this lets inventory pick one.
    (
        "M-CANDIDATE-CARDINALITY stored inventory may choose among named endpoints",
        CE,
        "      if (causes.length > 1 || effects.length > 1) {",
        "      if (false) {",
    ),
    # And the emptiness half: a role naming NO stored endpoint currently refuses UNRESOLVED. This
    # lets an unresolvable role through, which is the same defect from the other direction.
    (
        "M-CANDIDATE-EMPTY a role naming no stored endpoint no longer refuses",
        CE,
        "      if (causes.length === 0 || effects.length === 0) {",
        "      if (false) {",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 3. Not a substitute for the full set.")

sys.exit(harness([CE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
