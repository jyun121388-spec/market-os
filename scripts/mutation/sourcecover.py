"""M-ROLE-SOURCE: is the source role's full-role cover load-bearing?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and one anchor here carries
an escaped newline. `rolecover.py` was corrupted that way twice before the rule stuck.

ESC-015 §17. The subject role's cover is proved by `rolecover.py`; this asks the same question of
the SOURCE role, where the claim being authorized is stronger. Publishing a reading as "what
<provider> reported" attributes a statement to a named organisation, so a provider name merely
occurring inside a larger role must not be enough.

Each mutant below returns the resolver to a state it was actually in before ESC-015 §8, rather than
to an invented one:

  M-ROLE-SOURCE            cover removed entirely -- occurrence resolves, which is what published
                           a reading under a provider's name for a role reading
                           `<provider> purchase gamma shares`.
  M-ROLE-SOURCE-NAME-ONLY  the code stops being an identity that can explain a role. A request
                           naming a provider by code should stop resolving.
  M-ROLE-SOURCE-RESIDUE    residue reported as absence. Nothing is published either way, so this
                           mutant is invisible to a served-count assertion and only a status
                           assertion catches it -- which is why §13 is tested and not assumed.
  M-ROLE-SOURCE-AMBIGUOUS  two covering providers resolved by taking the first.

    python scripts/mutation/sourcecover.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

ASK = "src/server/domain/askMarket.ts"

BINDING_TESTS = [
    "tests/integration/source-role-cover.test.ts",
    # The source path's existing behaviour: exact resolution, ambiguity between two providers, and
    # resolution by code. A mutant that only survives by breaking these is CAUGHT-BUT-BROAD.
    "tests/integration/company-source-disambiguation.test.ts",
    "tests/integration/ask-market.test.ts",
]
UNRELATED_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/subjectClassification.test.ts",
]

COVER_FILTER = (
    "  const covering = hits.filter(\n"
    "    (src) =>\n"
    "      regionIsExactlyFramingAndIdentity(region, src.name, requestFramingIsRecognised) ||\n"
    "      regionIsExactlyFramingAndIdentity(region, src.code, requestFramingIsRecognised),\n"
    "  );"
)

MUTATIONS = [
    (
        "M-ROLE-SOURCE occurrence resolves the source role again",
        ASK,
        COVER_FILTER,
        "  const covering = hits;",
    ),
    (
        "M-ROLE-SOURCE-NAME-ONLY a provider code can no longer explain the role",
        ASK,
        COVER_FILTER,
        "  const covering = hits.filter((src) =>\n"
        "    regionIsExactlyFramingAndIdentity(region, src.name, requestFramingIsRecognised),\n"
        "  );",
    ),
    (
        "M-ROLE-SOURCE-RESIDUE an unexplained source role is reported as an inventory gap",
        ASK,
        '  if (hits.length > 0) return { status: "RESIDUE" };',
        "",
    ),
    (
        "M-ROLE-SOURCE-AMBIGUOUS two covering providers are resolved by taking the first",
        ASK,
        '  if (covering.length > 1) return { status: "AMBIGUOUS", codes: covering.map((h) => h.code) };',
        '  if (covering.length > 1) {\n'
        '    return { status: "RESOLVED", sourceId: covering[0].id, code: covering[0].code };\n'
        "  }",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 4. Not a substitute for the full set.")

sys.exit(harness([ASK], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
