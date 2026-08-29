"""M-FRAME / M-INVENTORY-GRAMMAR / M-ORDER: is ordered framing authority load-bearing?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines. Four files in this directory have been corrupted that way.

IR-107 framing positionality. The repair moved framing consumption into the parser as an ordered
header construction and narrowed what the mechanism cover may discard to determiners. Before it, at
57d242c, `Explain how process A affects B.` answered about `A` when only `A -> B` was stored and
about `Process A` when only `Process A -> B` was stored -- the repository choosing between two
readings the grammar had left open.

Four mutants must turn RED. The fifth must NOT.

  M-ORDER-1 is inverted on purpose: it changes the order rows come back in, and the REQUIRED result
  is MISSED. A mutant that changes no answer is the proof that enumeration order is not authority.
  If it is ever reported ISOLATED, some test has started depending on row order and that is the
  finding, not a pass.

    python scripts/mutation/framing.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

SUBJECT = "src/server/domain/subjectAuthority.ts"
ASK = "src/server/domain/askMarket.ts"
ENVELOPE = "src/server/domain/candidateEnvelope.ts"

BINDING_TESTS = [
    "tests/framingPositionalAuthority.test.ts",
    "tests/integration/framing-positional-authority.test.ts",
    # The relation behaviour that existed before this unit and must survive it: direction, polarity,
    # the qualifier rule, and the ESC-015 endpoint cover.
    "tests/integration/relation-role-cover.test.ts",
    "tests/integration/ask-market.test.ts",
]
UNRELATED_TESTS = [
    # Roles this repair deliberately did not touch. The observation subject and the source role keep
    # the full request framing vocabulary, because their openers are not relation headers.
    "tests/integration/source-role-cover.test.ts",
    "tests/requestAuthorityKorean.test.ts",
]

MUTATIONS = [
    # M-FRAME-POSITION-1 -- the bag comes back. Any all-framing prefix is discardable again, so
    # `process` is once more a word the cover will throw away, and which reading wins is decided by
    # what happens to be stored.
    (
        "M-FRAME-POSITION-1 position-insensitive framing returns to the mechanism cover",
        SUBJECT,
        "  const tokens = normalizeSubject(region).trim().split(\" \").filter(Boolean);\n"
        "  return tokens.every((token) => DETERMINERS.has(token));",
        "  return framingIsRecognised(region);",
    ),
    # M-FRAME-CONSUME-1 -- the parser stops consuming headers at all. The role then opens with
    # `explain how`, which no stored identity accounts for, so the ordinary positive dies.
    (
        "M-FRAME-CONSUME-1 the request header is never consumed",
        SUBJECT,
        "    if (trimmed === header || trimmed.startsWith(`${header} `)) {",
        "    if (false) {",
    ),
    # M-FRAME-CONSUME-2 -- consumption stops being positional. A header word anywhere in the region
    # is consumed, and the slice then cuts the wrong bytes off the front.
    (
        "M-FRAME-CONSUME-2 a header is consumed wherever it appears",
        SUBJECT,
        "    if (trimmed === header || trimmed.startsWith(`${header} `)) {",
        "    if (trimmed === header || trimmed.includes(header)) {",
    ),
    # M-INVENTORY-GRAMMAR-1 -- the CANONICAL door alone goes back to letting the repository decide
    # how much prefix was framing. Separate from M-FRAME-POSITION-1 because ESC-015 §15 requires
    # both doors proven, and a repair that only reached the deterministic one would survive this.
    (
        "M-INVENTORY-GRAMMAR-1 the canonical door lets inventory decide where framing ends",
        ENVELOPE,
        "        if (regionIsExactlyFramingAndIdentity(region, identity, determinerOnlyFraming)) continue;",
        "        if (regionIsExactlyFramingAndIdentity(region, identity)) continue;",
    ),
    # M-ORDER-1 -- REQUIRED TO SURVIVE. Enumeration order must not be authority.
    #
    # Anchored on the SELECTION read rather than the residue read. `mechanismRoleResidue` only asks
    # whether an uncovered endpoint exists, and existence is order-blind by definition; the read in
    # `findMechanismEdges` is the one whose output reaches a user, so it is the one where an
    # ordering dependency would actually publish a different edge.
    (
        "M-ORDER-1 stored edges are enumerated in the opposite order",
        ASK,
        "  const allEdges = await prisma.causalEdge.findMany({\n"
        '    orderBy: [{ fromVariable: "asc" }, { toVariable: "asc" }, { id: "asc" }],',
        "  const allEdges = await prisma.causalEdge.findMany({\n"
        '    orderBy: [{ fromVariable: "desc" }, { toVariable: "desc" }, { id: "desc" }],',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([SUBJECT, ASK, ENVELOPE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
