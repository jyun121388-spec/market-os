"""ESC-015 exact-cover mutation isolation. One mutant per guard the decision names.

WRITE/EDIT TOOL ONLY. A heredoc in this environment has eaten backslashes inside a Python string
literal three times, and one of those runs printed a cheerful success message having measured
nothing.

The decision names five guards and requires each to turn its intended production-path discriminator
RED, independently. It also names four ways the evidence would be INVALID -- an empty candidate
envelope killing the path before the guard, a parser or DB startup failure, an unrelated higher gate
refusing first, or a stale cached result. The harness addresses the last three structurally: it
pins the baseline denominators before mutating and scores INVALID_ENVIRONMENT rather than MISSED
when a run's totals move, and every verdict carries a run id bound to a RUN_COMPLETED bracket.

The first one is on the mutants themselves. Each is written so its discriminator fails on the
SUBSTANCE -- a request that should refuse authorizes, or one that should authorize refuses -- and
not because recognition collapsed. The unrelated negative controls catch the collapse case: if a
mutant breaks the parser outright they go red too, and the verdict is CAUGHT-BUT-BROAD, not
ISOLATED.

    python scripts/mutation/exactcover.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

RA = "src/server/domain/requestAuthority.ts"

BINDING_TESTS = [
    "tests/requestAuthority.test.ts",
    "tests/integration/ask-market-refusal-invariant.test.ts",
]
UNRELATED_TESTS = [
    "tests/candidateEnvelope.test.ts",
    "tests/inferenceAuthorization.test.ts",
]

MUTATIONS = [
    # M-DOMINANCE -- ignore the prohibited constituent.
    #
    # The whole `if (detectPersonalizedAdviceRequest(query))` block goes, so a directive falls
    # through to whatever the request otherwise recognises. Every `servesNothing` control should go
    # red, and so should the redirect integration controls.
    (
        "M-DOMINANCE prohibited authority no longer dominates the request",
        RA,
        """  if (detectPersonalizedAdviceRequest(query)) {""",
        """  if (false as boolean) {""",
    ),
    # M-RESIDUE -- ignore unconsumed second-object residue in a relation role. Both halves, one
    # mutant each, because they fail on different inputs: the comparator half on
    # `Beta versus Gamma`, the comma half on `Beta, Gamma`.
    (
        "M-RESIDUE second-object residue in a relation role is ignored entirely",
        RA,
        """  if (relationEndpointNamesTwoThings(query, syntax.clause.cause, syntax.clause.effect)) return null;""",
        "",
    ),
    # M-RESIDUE-COMMA IS RETIRED, and the harness is why this comment exists rather than a silent
    # deletion: it refused the whole run on ANCHOR DRIFT when the target vanished, instead of
    # reporting a survivor for a rule that was no longer there.
    #
    # The rule it mutated was `if (query.includes(","))` in `relationEndpointNamesTwoThings`, read
    # from the raw query because normalization deletes punctuation. ESC-015 §10 retired it: it could
    # not tell `Beta, Gamma` from `Alpha, Inc.` and refused both. The invariant did not go away with
    # it -- an endpoint role naming a second object must still refuse -- it moved one layer down to
    # the repository, where `scripts/mutation/mechanismcover.py` owns it as
    # `M-ROLE-MECHANISM-CAUSE` and `M-ROLE-MECHANISM-EFFECT`, both isolated.
    (
        "M-RESIDUE-COMPARATOR a comparison-appended second object is ignored",
        RA,
        """  return tokens.some((token) => OBJECT_COORDINATORS.includes(token));""",
        "  return false;",
    ),
    # M-EXACT-COVER -- remove the unique-complete-interpretation requirement, so a request with two
    # readings picks one instead of refusing.
    #
    # CLASSIFIED SURVIVOR -- EQUIVALENT_OVER_CORPUS, and RE-MEASURED on this tree rather than
    # inherited. ESC-015 §19 forbids manufacturing a case to turn it red and requires the
    # measurement be redone once the code moved, which it has: the cover, the source role, the
    # relation roles and the company role all changed underneath it.
    #
    # `python scripts/mutation/differential.py <dump> exact-cover-unreachable`, 2026-08-29:
    # 99,072 generated requests, NO DISCRIMINATING INPUT. Nothing in that corpus can tell the two
    # variants apart. The branch needs a JOINED run admitted while a split cover also exists, and
    # the tail evidence that blocks a joined run is the same evidence that makes a tail read alone,
    # so the two conditions appear anti-correlated by construction. Appear -- the corpus is what is
    # claimed here, not a proof of unreachability.
    (
        "M-EXACT-COVER a second complete interpretation no longer refuses",
        RA,
        """  if (interpretations.length > 1) {""",
        """  if (false as boolean) {""",
    ),
    # M-EXACT-COVER-MULTI -- keep uniqueness but allow a cover made of SEVERAL readings to publish
    # the first one. That is partial publication of a multi-intent request.
    (
        "M-EXACT-COVER-MULTI a multi-reading cover publishes its first reading",
        RA,
        """  if (cover && cover.length > 1) {""",
        """  if (false as boolean) {""",
    ),
    # M-ROLE-SPAN -- allow a role span to extend across a boundary the tail evidence confirmed, so
    # a served region reaches outside the reading that was selected.
    (
        "M-ROLE-SPAN a role span may extend past a confirmed boundary",
        RA,
        """      if (readings.length === 1 && !crossesConfirmed) {""",
        """      if (readings.length === 1) {""",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 7. Not a substitute for the full set.")

sys.exit(harness([RA], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
