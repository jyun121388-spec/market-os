"""M-ROLE-COVER: turn full-role exact cover back into "the name occurs somewhere".

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes. This file was already
corrupted once that way: an anchor written through a heredoc had its escaped newline collapsed into
a real line break, and the module stopped parsing. Anchors here carry escapes, so the hazard is
live, not theoretical.

The mutation ESC-015 `EXACT-CANDIDATE-COVER` names explicitly. It must turn a production-path
discriminator RED without breaking startup or discovery, and the positive control must stay green:

    What is the current Alpha. Purchase Gamma shares.   -> RED, Alpha publishes again
    What is the current Alpha?                          -> stays green

## Why the binding set is what it is

The discriminators live in `full-role-cover.test.ts`, which seeds a real series with fresh
observations. That seeding is what makes the negatives mean something: without it "nothing was
served" is satisfied by an empty database, which the ESC-015 brief lists as INVALID evidence.

`ask-market.test.ts` is bound too, because the first version of this cover refused on ABSENCE as
well as on residue and broke twenty of its cases -- a company question reaching the series lookup
first and being refused before the company path could try. A mutant that only survives by breaking
those would show as CAUGHT-BUT-BROAD rather than ISOLATED.

`canonicalRoleCover.test.ts` is bound for the half of the contract the deterministic parser masks.
`M-ROLE-COVER-TAIL` survived a run without it, and the reason was not that the tail requirement is
idle: end-to-end, the only role shaped to reach it is refused by the operation recognizer first.
The primitive is shared across four roles with four different upstreams, so its contract is pinned
at its own boundary rather than through whichever caller currently happens to guard it.

The unrelated controls are parser-side, where no repository is consulted at all, so a mutation to
materialization authority has no business changing them.

    python scripts/mutation/rolecover.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

COVER = "src/server/domain/canonicalRoleCover.ts"
ASK = "src/server/domain/askMarket.ts"

BINDING_TESTS = [
    "tests/canonicalRoleCover.test.ts",
    "tests/integration/full-role-cover.test.ts",
    "tests/integration/ask-market.test.ts",
]
UNRELATED_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/requestAuthorityKorean.test.ts",
]

# The refusal condition as prettier wraps it. Kept as one constant because two mutants cut it in
# opposite directions, and an anchor that drifts silently matches nothing -- the harness counts
# occurrences before it writes anything, for exactly that reason.
COVER_REFUSES = (
    '      cover.status === "AMBIGUOUS" ||\n'
    '      (cover.status === "UNRESOLVED" && cover.reason === "RESIDUE")'
)

MUTATIONS = [
    # THE required mutation. Cover degrades to discovery: whatever `resolveStoredSubject` found by
    # occurrence is accepted as covering the role. Discovery still works, nothing fails to start,
    # and `Alpha` publishes again out of ` alpha purchase gamma shares `.
    (
        "M-ROLE-COVER exact cover degrades to occurrence matching",
        COVER,
        "      : discovered.filter((row) => identityIsTheTail(trimmed, nameOf(row), framingIsRecognised));",
        "      : discovered;",
    ),
    # The tail requirement alone. `Alpha` occurring anywhere would satisfy cover, but the framing
    # check on everything before it would still have to pass -- so this isolates WHERE the identity
    # must sit from WHAT may surround it.
    (
        "M-ROLE-COVER-TAIL the identity no longer has to be the tail of the role",
        COVER,
        "  const tail = tokens.slice(tokens.length - nameTokens.length);\n"
        '  if (tail.join(" ") !== nameTokens.join(" ")) return false;',
        "",
    ),
    # The framing requirement alone: the identity must still be the tail, but anything at all may
    # precede it. `Purchase Gamma shares Alpha` is the shape this admits.
    (
        "M-ROLE-COVER-FRAMING anything may precede the identity",
        COVER,
        '  return framingIsRecognised(tokens.slice(0, tokens.length - nameTokens.length).join(" "));',
        "  return true;",
    ),
    # Residue must refuse. Removing it lets a role that named a series and then said more fall
    # through to materialization, which is the P1 itself arriving by a different route.
    (
        "M-ROLE-COVER-RESIDUE residue no longer refuses materialization",
        ASK,
        COVER_REFUSES,
        '      cover.status === "AMBIGUOUS"',
    ),
    # And the other half of that condition: two distinct covering identities must not be resolved by
    # picking one.
    #
    # CLASSIFIED SURVIVOR -- EQUIVALENT_GIVEN_MAXIMAL_DISCOVERY. Not a coverage gap, and no test was
    # written to force it red. Two distinct names can only both cover one role if one is a token
    # suffix of the other; the shorter's covering occurrence then sits inside the longer's, where
    # `subjectAuthority.explicitlyNamed` drops it before cover is ever consulted. Discovery hands
    # this branch one identity or none. Measured as well as argued: 160 constructed
    # name-pair/region combinations produced 0 AMBIGUOUS, and end-to-end with both
    # `Zephyrium` and `Rate of Zephyrium` stored, cover saw only the longer
    # (`scripts/probe-role-reachability.ts`).
    #
    # The branch stays because ESC-015 §15 requires identity cardinality to be distinguished from
    # row cardinality, and because this primitive is shared with three roles whose discovery is not
    # this one. `takes the maximal identity when one stored name nests inside another` in
    # `canonicalRoleCover.test.ts` pins the interaction the equivalence rests on, so if the maximal
    # filter is ever removed this mutant stops being equivalent AND that test turns red.
    (
        "M-ROLE-COVER-AMBIGUOUS two covering identities no longer refuse",
        ASK,
        COVER_REFUSES,
        '      cover.status === "UNRESOLVED" && cover.reason === "RESIDUE"',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([COVER, ASK], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
