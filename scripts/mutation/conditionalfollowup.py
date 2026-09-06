"""M-COND: does the CONDITIONAL generator edge carry weight, or does the proposal just exist?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes. That is not a formality: the
controls this suite binds were written through one, a literal backslash-n survived into the file,
and the whole suite reported "no tests" rather than a failure.

`[CHATGPT_DECISION][MARKET-CONDITIONAL-CAPABILITY-PROPOSAL-20260906]`. The generator had a rule for
`NOT_VERIFIED` (debt) and one for `NOT_SUPPORTED` (ceiling) and none for `CONDITIONAL` -- measured
available on a real response, under a stated limitation. HG-002 closed FRED's verification debt and
five CONDITIONAL cells replaced it, so the one node every measurement pointed at was absent from
the task graph and the scheduler reported NO_SAFE_MEANINGFUL_NODE while a meaningful node existed.

The failure modes all look like tidying. Aliasing CONDITIONAL to one of the states that already had
a rule is the obvious "simplification"; dropping the provenance requirement makes the rule shorter;
dropping or forging the derived identity makes it look uniform. Every mutant below is one of those,
and each errs toward a proposal that is either absent or wrongly runnable.

Cardinalities were predicted before the run and are CORRECTED TO MEASURED below, with the reason
wherever they differed (run a3f2352ad67f, 2026-09-06). Two of five were wrong, both because the
prediction over-counted how many controls a single change reaches.

Binding: the generator controls and the boundary controls for the node it produces, plus the
scheduler's convergence control -- see BINDING_TESTS for why that moved after the first run.

  M-COND-EDGE-REMOVED      the generator no longer emits the follow-up at all
                           -> PREDICTED 7, MEASURED 6 (5 in the generator suite + the convergence
                              control). It is the unit deleted, so every control naming
                              CAP-FOLLOWUP-FRED or CAP-FOLLOWUP-SEC_EDGAR loses its subject:
                              the bounded-follow-up control, the derivation control, both boundary
                              controls, the forged-identity control, and the exact-set convergence
                              control. The prediction assumed the states-must-not-collapse control
                              would fire too; it does not, because it asserts what the CEILING
                              contains and the ceiling is untouched -- which is the separation
                              between the two rules being real rather than asserted.

  M-COND-ALIASED-UNSUPPORTED eligibility reads NOT_SUPPORTED instead of CONDITIONAL
                           -> PREDICTED 3, MEASURED 1: the bounded-follow-up control alone, on the
                              axes it names no longer being the conditional ones. The prediction
                              expected the states-must-not-collapse control and SEC_EDGAR's
                              identity control to fire as well. Neither does, and the reason is
                              worth keeping: the first checks the CEILING's contents, which this
                              does not touch, and the second only reads an id that still exists
                              under the wrong scope. So ONE control stands between this repository
                              and a silent aliasing of two capability states, and it is the one
                              that enumerates the axes. Any future edit that weakens it removes
                              the only thing watching.

  M-COND-PROVENANCE-IGNORED a CONDITIONAL transcribed from documentation generates work
                           -> 1 red: the requires-a-real-response control ALONE. Every live cell in
                              the matrix today is LIVE_RESPONSE, so nothing else can see this --
                              the control exists precisely because the defect is invisible to the
                              real data and would only appear the first time somebody wrote a
                              CONDITIONAL from a documentation page.

  M-COND-IDENTITY-STRIPPED  the derived provider identity is dropped
                           -> 3 red: the derivation control, and both boundary controls that turn
                              on FRED being answered from FRED's own key. Without the identity the
                              follow-up falls back to the conjunction and is blocked by ECOS and
                              OpenDART -- the exact aliasing IR-127 removed, reintroduced one layer
                              up where nothing else would catch it.

  M-COND-IDENTITY-FORGED    every follow-up claims to call ECOS
                           -> 3 red: the derivation control, and the two boundary controls, since a
                              FRED key no longer clears a proposal that says it calls ECOS. Fails
                              CLOSED, which is the right direction for a forged identity and is
                              worth having measured rather than assumed.

    python scripts/mutation/conditionalfollowup.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

PROPOSAL = "src/server/evolution/proposal.ts"
TEST = "tests/evolutionProposal.test.ts"

BINDING_TESTS = [
    TEST,
    # Moved here after the first run, which reported M-COND-EDGE-REMOVED as CAUGHT-BUT-BROAD.
    # That verdict was right and the classification was wrong: this file's convergence control now
    # enumerates the exact proposal ids the generator emits, `CAP-FOLLOWUP-*` included, so it binds
    # this contract rather than sitting beside it. Recorded rather than quietly re-labelled,
    # because moving a suite to make a verdict prettier is the tempting version of this edit.
    "tests/evolutionScheduler.test.ts",
]
UNRELATED_TESTS = [
    # The IR-127 boundary, which is about which KEY answers an action, not about which proposals
    # exist. Generation must not move it.
    "tests/autonomyContext.test.ts",
    "tests/governancePolicy.test.ts",
]

MUTATIONS = [
    (
        "M-COND-EDGE-REMOVED the generator no longer emits the follow-up",
        PROPOSAL,
        "      conditionalFollowUpProposal(profile),\n",
        "",
    ),
    (
        "M-COND-ALIASED-UNSUPPORTED eligibility reads NOT_SUPPORTED instead of CONDITIONAL",
        PROPOSAL,
        '      profile.axes[axis].state === "CONDITIONAL" &&\n',
        '      profile.axes[axis].state === "NOT_SUPPORTED" &&\n',
    ),
    (
        "M-COND-PROVENANCE-IGNORED a documented CONDITIONAL generates work",
        PROPOSAL,
        '      profile.axes[axis].provenance === "LIVE_RESPONSE",\n',
        "      true,\n",
    ),
    (
        "M-COND-IDENTITY-STRIPPED the derived provider identity is dropped",
        PROPOSAL,
        "    provider: keyedProviderOf(profile.sourceCode),\n  };\n}\n\n/**\n * Proposals derived from the capability matrix.",
        "    provider: undefined,\n  };\n}\n\n/**\n * Proposals derived from the capability matrix.",
    ),
    (
        "M-COND-IDENTITY-FORGED every follow-up claims to call ECOS",
        PROPOSAL,
        '    provider: keyedProviderOf(profile.sourceCode),\n  };\n}\n\n/**\n * Proposals derived from the capability matrix.',
        '    provider: "ECOS",\n  };\n}\n\n/**\n * Proposals derived from the capability matrix.',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([PROPOSAL, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
