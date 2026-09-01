"""M-REACH: can the reach classifier be talked into clearing a site it should not?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and one anchor below
contains a regex.

`order-reaches-output` narrows the non-total-order sites to the ones whose nondeterminism a reader
can see. Three things it must never do: discharge a site on an operation whose result depends on
arrival order, discharge one on a property read that RUNS USER CODE, and answer at all when its
parent pointers are missing.

Each has already gone wrong once, which is why they get mutants rather than comments. The second is
the newest and the most instructive: the method-name whitelist was replaced by an expression-SHAPE
whitelist, and a shape is no more a behaviour than a name is. `x.flag` may be an accessor or a
proxy trap, and `.some()` short-circuits, so reversing arrival order changes which reads run.

The last two mutants exist because the authority has TWO halves -- declaration kind and declared
source -- and a getter in a hand-written object is refused by both. Either could have been
decorative. The fixture therefore also declares a getter at a path the provenance rule accepts, so
each half has a control only it can satisfy.

Expected cardinalities, written before the run:

  M-REACH-PREDICATE-BLIND    put `some`/`every` back as unconditionally order-blind
                             -> 1 red: the exact-membership control. They short-circuit and run
                                user code, so the method name proves nothing.

  M-REACH-ORDER-BLIND-WIDE   put `find` back among the order-blind operations
                             -> 2 red: the exact-membership control and the refuses-order-sensitive
                                control. It CANNOT be caught by the corpus -- nothing today is
                                ORDER_DISCARDED -- so only the contract controls catch it.

  M-REACH-NO-CHECKER         bind a DIFFERENT, empty program, leaving the real one's parent
                             pointers unset
                             -> 3 red. With parents undefined nothing resolves and every row
                                returns the same empty reason -- the uniform answer that control
                                exists to reject.

                             The mutant used to simply DELETE the binding call. That stopped
                             working the moment the field authority needed the same checker: a
                             second `getTypeChecker()` in `auditOrderReach` re-bound the program,
                             the deletion became a no-op, and the harness reported MISSED for a
                             mutant that was in fact equivalent. The audit was restructured to bind
                             exactly once and RETURN the checker, and the mutant now reproduces the
                             unbound state directly instead of hoping deletion still causes it.

  M-REACH-AST-ONLY-PROPERTY  accept any property CHAIN on syntax alone, never consulting the
                             authority -- exactly the defect CHATGPT_VERIFIED found
                             -> 4 red: the depth-one shape control, the fail-closed control, the
                                vouched-field control, and the getter/proxy attack control.

  M-REACH-AUTHORITY-OPEN     make the fail-closed default admit every read
                             -> 1 red: the no-authority control. An absent authority reading as a
                                permissive one is how this whole class of defect survives.

  M-REACH-ACCESSOR-OK        stop requiring a PropertySignature, so an accessor discharges
                             -> 1 red: the attack control, via the getter declared UNDER the
                                generated-client path. The hand-written getter cannot catch this --
                                provenance already refuses that one -- which is the reason the
                                shadowed fixture exists.

  M-REACH-PROVENANCE-ANY     stop requiring the generated client, so any declared field discharges
                             -> 1 red: the attack control, via the hand-written plain field. The
                                other half of the same pair.

    python scripts/mutation/orderreach.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

REACH = "scripts/order-reaches-output.ts"
TEST = "tests/orderReachesOutput.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/recencyCardinality.test.ts"]

MUTATIONS = [
    (
        "M-REACH-PREDICATE-BLIND short-circuiting predicates discharge without proving the callback",
        REACH,
        'export const ORDER_BLIND = new Set(["includes", "length"]);',
        'export const ORDER_BLIND = new Set(["includes", "length", "some", "every"]);',
    ),
    (
        "M-REACH-ORDER-BLIND-WIDE a first-match operation is treated as order-blind",
        REACH,
        'export const ORDER_BLIND = new Set(["includes", "length"]);\n\n/**\n'
        " * `some` and `every` are order-blind ONLY IF their callback is.",
        'export const ORDER_BLIND = new Set(["includes", "length", "find"]);\n\n/**\n'
        " * `some` and `every` are order-blind ONLY IF their callback is.",
    ),
    (
        "M-REACH-NO-CHECKER the audited program is never bound, so parent pointers are missing",
        REACH,
        "  const checker = program.getTypeChecker();\n  cached = { program, checker };",
        "  const checker = ts.createProgram({ options: {}, rootNames: [] }).getTypeChecker();\n"
        "  cached = { program, checker };",
    ),
    (
        "M-REACH-AST-ONLY-PROPERTY a property read is admitted on syntax alone",
        REACH,
        "      if (!ts.isIdentifier(e.expression) || e.expression.text !== element) return false;\n"
        "      return authority.isInertRead(e.expression, e.name.text);",
        "      return pure(e.expression);",
    ),
    (
        "M-REACH-AUTHORITY-OPEN the fail-closed default admits every read",
        REACH,
        '  provenance: () => "none — no property read can be proven inert",\n'
        "  isInertRead: () => false,",
        '  provenance: () => "none — no property read can be proven inert",\n'
        "  isInertRead: () => true,",
    ),
    (
        "M-REACH-ACCESSOR-OK an accessor is accepted as an inert field",
        REACH,
        "      if (!ts.isPropertySignature(decl)) return false;",
        "      if (!decl) return false;",
    ),
    (
        "M-REACH-PROVENANCE-ANY any declared field is accepted, whatever declares it",
        REACH,
        '      return decl.getSourceFile().fileName.replace(/\\\\/g, "/").includes(marker);',
        "      return marker.length > 0;",
    ),
]

sys.exit(harness([REACH], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1500))
