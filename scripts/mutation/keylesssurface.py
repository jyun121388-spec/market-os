"""M-KEYLESS: is "needs no key" scoped to a surface, or has it become a general permission?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MARKET-KEYLESS-PROVIDER-IDENTITY-20260906]`, IR-132. IR-127 left SEC EDGAR out
of `KEYED_PROVIDERS` because it issues no key, and claimed in its own comment that such an action
"names no provider and is never blocked on a key it does not need". The second half was false: an
unnamed action falls back to the conjunction over the three KEYED providers, so SEC work was held by
ECOS and OpenDART credentials it never touches.

The decision approved the direction and scoped it hard: the identity names a SURFACE
(`data.sec.gov` submissions and companyfacts, which need a User-Agent rather than a credential), not
a company, because EDGAR Next filer and submission APIs DO require tokens. So every failure mode
here is a widening -- the classification escaping the surface it was granted for.

Cardinalities were predicted before the run and are CORRECTED TO MEASURED below, with the reason
wherever they differed (run c58e542fba5c, 2026-09-07: 3 of 3 ISOLATED, unrelated 49/49 green under
every mutant).

  M-KEYLESS-UNKNOWN-IS-KEYLESS  an unrecognised identity is treated as needing no key
                                -> PREDICTED 2, MEASURED 3: the two controls foreseen, plus IR-127's
                                   OWN "refuses an identity it does not recognise", which predates
                                   this unit. The prediction counted only what IR-132 added and
                                   forgot that the fail-closed rule it widens was already guarded.
                                   That is the healthy direction for a miss: an older control still
                                   watching a rule a newer unit touched.

                                   This is the mutant the decision names first, because "no known
                                   key => probably keyless" is the reading that turns a scoped grant
                                   into a universal one.

  M-KEYLESS-SCOPE-ERASED        the surface list becomes the company
                                -> PREDICTED 1, MEASURED 2: the token-requiring surface control AND
                                   the unknown-identity one, because that control's forged list
                                   includes the bare string "SEC_EDGAR" -- which this mutant makes
                                   legal. The docstring previously claimed ONE control stood between
                                   this repository and "all SEC APIs are keyless"; two do, and the
                                   second only because a control written for a different purpose
                                   happened to enumerate the right string.

  M-KEYLESS-BYPASSES-POLICY     a keyless surface returns early from `evaluateAction`, before the
                                other predicates are applied
                                -> 1 red: the changes-only-the-credential-predicate control, on its
                                   red-verification half.

                                   FIRST VERSION MISSED, and the miss is the useful part. It
                                   inserted the short-circuit at the top of `CALL_FREE_PROVIDER`'s
                                   `refine`, which sounds like "bypasses the rest of the rule" and
                                   is not: the verification predicate lives in `evaluateAction`
                                   AFTER `refine` returns, so skipping `refine` skips only the key
                                   check and the rate-limit upgrade — and `base` is already
                                   AUTO_ALLOWED_WITH_VERIFY, which is what the rate-limit half
                                   asserts anyway. A mutant has to reach the code that applies the
                                   predicate it claims to bypass, or it measures nothing. Re-aimed
                                   at `evaluateAction` itself, where the other predicates actually
                                   are.

    python scripts/mutation/keylesssurface.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

POLICY = "src/server/governance/policy.ts"
PROPOSAL = "src/server/evolution/proposal.ts"
TEST = "tests/governancePolicy.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # The queue and the autonomy boundary. A credential-presence repair must not move how work is
    # ranked or how the environment is established.
    "tests/evolutionScheduler.test.ts",
    "tests/autonomyContext.test.ts",
]

MUTATIONS = [
    (
        "M-KEYLESS-UNKNOWN-IS-KEYLESS an unrecognised identity needs no key",
        POLICY,
        "  if (!isKeyedProvider(named)) return false;\n",
        "  if (!isKeyedProvider(named)) return true;\n",
    ),
    (
        "M-KEYLESS-SCOPE-ERASED the surface list becomes the company",
        POLICY,
        'export const KEYLESS_PROVIDER_SURFACES = ["SEC_EDGAR_PUBLIC_READ"] as const;\n',
        'export const KEYLESS_PROVIDER_SURFACES = [\n'
        '  "SEC_EDGAR_PUBLIC_READ",\n'
        '  "SEC_EDGAR",\n'
        '  "SEC_EDGAR_NEXT_SUBMISSION",\n'
        '] as const;\n',
    ),
    (
        "M-KEYLESS-BYPASSES-POLICY a keyless surface returns before the other predicates",
        POLICY,
        "  const refined = rule.refine ? rule.refine(action, base) : base;\n",
        "  const refined = rule.refine ? rule.refine(action, base) : base;\n"
        "  if (action.provider === \"SEC_EDGAR_PUBLIC_READ\") return refined;\n",
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
    harness([POLICY, PROPOSAL, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900)
)
