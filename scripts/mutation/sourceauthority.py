"""M-SRCAUTH: is exact source authority load-bearing on the planner-facing doors?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines. Five files in this directory have been corrupted that way.

IR-107 B2-C. Before this unit, attribution was not a candidate-authority dimension at all: the
canonical envelope resolved ATTRIBUTED_REPORTED_OBSERVATION by subject identity alone and never read
`request.sourceRegion`, and the legacy envelope delegated to subject authority the same way. With
only provider Y publishing a subject, a request naming provider X came back AUTHORIZED carrying Y's
series on both doors, and `answerWithInference` called the planner with it.

Four mutants must turn RED. The fifth must NOT.

  M-SRCAUTH-ORDER is inverted on purpose: it reverses the order stored providers come back in, and
  the REQUIRED result is MISSED. Which provider answers must be decided by the request, never by
  enumeration. If it is ever reported ISOLATED, some test has begun depending on row order and that
  is the finding, not a pass.

    python scripts/mutation/sourceauthority.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

ENVELOPE = "src/server/domain/candidateEnvelope.ts"
SOURCE = "src/server/domain/sourceAuthority.ts"

BINDING_TESTS = [
    "tests/integration/source-authority.test.ts",
    # The doors' pre-existing behaviour, which this unit must not have bought its guarantee with.
    "tests/integration/canonical-candidate.test.ts",
    "tests/integration/source-role-cover.test.ts",
]
UNRELATED_TESTS = [
    # Roles with no source dimension at all.
    "tests/integration/relation-role-cover.test.ts",
    "tests/framingPositionalAuthority.test.ts",
]

MUTATIONS = [
    # M-SRCAUTH-FILTER -- the candidate series stop being narrowed to the named provider. This is
    # the defect exactly as reproduced: the subject is resolved across every provider, so Y's row
    # answers a request naming X.
    (
        "M-SRCAUTH-FILTER candidates are no longer narrowed to the named provider",
        ENVELOPE,
        "      const owned = await prisma.series.findMany({\n"
        "        where: { sourceId: source.sourceId },\n"
        "        select: { id: true, name: true },\n"
        "      });",
        "      const owned = await prisma.series.findMany({ select: { id: true, name: true } });",
    ),
    # M-SRCAUTH-OCCURRENCE -- exact source cover degrades to occurrence. A provider name occurring
    # anywhere inside a longer source role authorizes attribution to it again, which is the ESC-015
    # §8 defect arriving through the planner door instead of the deterministic one.
    (
        "M-SRCAUTH-OCCURRENCE exact source cover degrades to occurrence",
        SOURCE,
        "  const covering = hits.filter(\n"
        "    (src) =>\n"
        "      regionIsExactlyFramingAndIdentity(region, src.name, requestFramingIsRecognised) ||\n"
        "      regionIsExactlyFramingAndIdentity(region, src.code, requestFramingIsRecognised),\n"
        "  );",
        "  const covering = hits;",
    ),
    # M-SRCAUTH-FIRST -- two providers answering to one name are resolved by taking the first.
    # `Source.name` is free text and is not unique, so this is reachable with ordinary data.
    (
        "M-SRCAUTH-FIRST an ambiguous source is resolved by taking the first",
        SOURCE,
        '  if (covering.length > 1) return { status: "AMBIGUOUS", codes: covering.map((h) => h.code) };',
        "  if (covering.length > 1) {\n"
        '    return { status: "RESOLVED", sourceId: covering[0].id, code: covering[0].code };\n'
        "  }",
    ),
    # M-SRCAUTH-LEGACY-FRAME -- the legacy door goes back to treating frame eligibility as proof of
    # a source. Separate from the canonical mutants because the two doors are reached by different
    # requests, and a repair that only landed on one of them would survive the others.
    (
        "M-SRCAUTH-LEGACY-FRAME frame eligibility is proof of a source again",
        ENVELOPE,
        '  if (authority.status === "AUTHORIZED" && authority.operation === "REPORTED_OBSERVATION") {',
        "  if (false) {",
    ),
    # M-SRCAUTH-ORDER -- REQUIRED TO SURVIVE.
    (
        "M-SRCAUTH-ORDER stored providers are enumerated in the opposite order",
        SOURCE,
        '    orderBy: [{ code: "asc" }, { id: "asc" }],',
        '    orderBy: [{ code: "desc" }, { id: "desc" }],',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([ENVELOPE, SOURCE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
