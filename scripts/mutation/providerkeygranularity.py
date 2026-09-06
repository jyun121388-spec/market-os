"""M-PKG: does the per-provider key contract actually discriminate, or only look as if it does?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MARKET-PROVIDER-KEY-GRANULARITY-20260906]`. The defect, reproduced before the
repair: `providerKeyAvailable` was one boolean for three providers, so with FRED's key present and
ECOS/OpenDART absent, FRED-only work reported BLOCKED_PROVIDER_KEY over credentials it never
touches. The repair splits the question -- a NAMED action is answered from that provider's own
established fact, an UNNAMED one keeps the conjunction.

Both halves can fail in the direction that looks like a fix. Widening the named half wrongly makes
absent keys read as present; widening the unnamed half turns the conjunction into "any key", which
is the SAME aliasing with its sign flipped and is the more tempting mistake, because it makes more
work appear startable. Every mutant below errs toward CLAIMING a credential exists.

Cardinalities were predicted before the run and are CORRECTED TO MEASURED below, with the reason
wherever they differed (run 9a816d0130e5, 2026-09-06: 5 of 5 ISOLATED, unrelated 30/30 green under
every mutant). Three of five predictions were wrong, all in the same direction -- too low -- and
what they missed is recorded because it is the more useful half.

Binding: the three suites that bind this contract -- the policy rule, the scheduler trace it
travels in, and the boundary that supplies both facts.

  M-PKG-LOOKUP-DROPPED     a named action reads the aggregate instead of its provider
                           -> PREDICTED 5, MEASURED 7. Foreseen: the FRED-not-blocked control, the
                              never-established control, the whole-matrix control, the scheduler's
                              FRED half, the boundary's unlock-on-own-key. Missed, and both are
                              findings rather than noise:

                                "treats an unstated environment as available, optimistically" --
                                the narrowing assertion added to that pin. With the aggregate back,
                                an unstated environment makes the provider-NAMED capability
                                proposals startable again, which is exactly what the narrowing
                                forbids. The pin and this mutant are two ends of one property.

                                "does not let a present key close a Human Gate" -- unexpected, and
                                it exposes a real coupling. `deferOpenGates` only moves items that
                                are startable ON THE ENVIRONMENT, so when the environment answer is
                                wrong the gate answer never gets asked: the item is deferred as
                                BLOCKED_BY_ENVIRONMENT and the control's REQUIRES_HUMAN assertion
                                fails. The gate check is downstream of the key check by design;
                                this is the first thing to demonstrate that it is.

                              The ECOS/OpenDART blocked control stays GREEN, which is the point of
                              stating a number at all: those two are blocked either way, so a suite
                              that checked only them would pass over the defect exactly as review
                              did for three sessions.

  M-PKG-UNNAMED-ANY-KEY    an unnamed action is cleared by ANY present key
                           -> PREDICTED 2, MEASURED 2. The conjunction control, and the boundary's
                              assertion that the two cluster proposals stay deferred when only ECOS
                              is present. The no-key-at-all control stays GREEN -- with nothing
                              present, "any" and "all" agree, which is why a fixture with exactly
                              one key exists.

  M-PKG-UNNAMED-ALWAYS-READY the aggregate is not consulted at all
                           -> PREDICTED 5, MEASURED 16, and the gap is the finding. This mutant
                              does not attack the new contract; it deletes the provider-key blocker
                              outright for every unnamed action, an invariant that predates this
                              unit and that a dozen controls already cover -- three HG-00x policy
                              rows, the real-ledger convergence control, the never-end-the-session
                              control, both IR-126 verdict controls. So it is the LEAST
                              discriminating mutant here despite the largest count: a big number
                              means many controls overlap, not that the guard is strong. The two
                              narrow mutants above are the ones carrying the weight.

  M-PKG-NAMED-UNKNOWN-OPEN a named provider with no established fact reads as available
                           -> PREDICTED 2, MEASURED 3. Foreseen: the never-established control and
                              the narrowing assertion on the pinned optimism test. Missed: "has
                              converged: nothing startable, four items gated on provider keys", the
                              real-ledger control -- with unknown reading as available, the two
                              CAP-DEBT proposals become startable against the live matrix. A
                              control written about the real ledger caught a change in the contract
                              underneath it, which is what it is for. The unknown-IDENTITY control
                              stays GREEN: that is refused one line earlier, and the independence
                              of the two failure modes is worth having measured.

  M-PKG-IDENTITY-SWAPPED   the generator labels FRED's proposal ECOS and vice versa
                           -> PREDICTED 2, MEASURED 3: unlock-on-own-key, the trace-provider
                              control, and again "does not let a present key close a Human Gate"
                              for the coupling described above. Nothing at the POLICY level moves,
                              as predicted, because the policy is correct about whatever identity
                              it is handed -- this mutant attacks the DERIVATION, and only a
                              control that runs the real generator can see it.

    python scripts/mutation/providerkeygranularity.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

POLICY = "src/server/governance/policy.ts"
PROPOSAL = "src/server/evolution/proposal.ts"
BOUNDARY = "scripts/autonomy-context.ts"

BINDING_TESTS = [
    "tests/governancePolicy.test.ts",
    "tests/evolutionScheduler.test.ts",
    "tests/autonomyContext.test.ts",
]
UNRELATED_TESTS = [
    # The generator's own controls and the stop sentinel beside it. Neither is about provider keys,
    # and neither may move.
    "tests/evolutionProposal.test.ts",
    "tests/stopEvidence.test.ts",
]

NAMED_LOOKUP = "  return action.context?.providerKeys?.[named] === true;\n"
UNNAMED = "  if (named === undefined) return action.context?.providerKeyAvailable !== false;\n"

MUTATIONS = [
    (
        "M-PKG-LOOKUP-DROPPED a named action reads the aggregate instead of its provider",
        POLICY,
        NAMED_LOOKUP,
        "  return action.context?.providerKeyAvailable !== false;\n",
    ),
    (
        "M-PKG-UNNAMED-ANY-KEY an unnamed action is cleared by any present key",
        POLICY,
        UNNAMED,
        "  if (named === undefined)\n"
        "    return (\n"
        "      action.context?.providerKeyAvailable !== false ||\n"
        "      Object.values(action.context?.providerKeys ?? {}).some(Boolean)\n"
        "    );\n",
    ),
    (
        "M-PKG-UNNAMED-ALWAYS-READY the aggregate is not consulted at all",
        POLICY,
        UNNAMED,
        "  if (named === undefined) return true;\n",
    ),
    (
        "M-PKG-NAMED-UNKNOWN-OPEN a named provider with no established fact reads as available",
        POLICY,
        NAMED_LOOKUP,
        "  return action.context?.providerKeys?.[named] !== false;\n",
    ),
    (
        "M-PKG-IDENTITY-SWAPPED the generator labels FRED's proposal ECOS and vice versa",
        PROPOSAL,
        "    ? (sourceCode as KeyedProvider)\n",
        '    ? ((sourceCode === "FRED" ? "ECOS" : sourceCode === "ECOS" ? "FRED" : sourceCode) as KeyedProvider)\n',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(
    harness(
        [POLICY, PROPOSAL, BOUNDARY] + BINDING_TESTS,
        BINDING_TESTS,
        UNRELATED_TESTS,
        MUTATIONS,
        wall_seconds=900,
    )
)
