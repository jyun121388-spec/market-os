"""M-VAL: does the scenario valuation actually refuse what it says it refuses?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`, Option C. The surface publishes a
number built from one stored figure and a multiple the reader typed, which makes every guard
between those two things load-bearing in a way a display component is not. The decision names the
mutations it wants matched discrimination for, and each one below is one of them.

Both suites are BINDING, and that pairing is the point. The pure suite proves the rules; the
integration suite proves the rules are reachable from real rows through the same two calls the page
makes. A mutant that only the pure suite catches would leave open the possibility that the page
feeds the boundary something else entirely.

The UNRELATED suites are the legal and request-authority surfaces. This unit adds the first
valuation output this product has ever had, so the thing most worth proving is that it did not move
the guardrail that decides what may be said to a user at all.

Cardinalities were predicted BEFORE the run and are CORRECTED TO MEASURED below (run
6f2c48f15c17 plus the re-aim 473a1f71bed5, 2026-09-08: 7 of 7 ISOLATED, the three guardrail suites
34/34 green under every mutant). Three predictions were low and one mutant was re-aimed; the
reasons are kept rather than tidied away.

  M-VAL-PROVENANCE-IGNORED   a figure with no accession or form is good enough
                             -> PREDICTED 1, MEASURED 1: control G. Nothing else exercises a figure
                                missing its filing identity, because every other fixture is shaped
                                like something the ingest really stores.

  M-VAL-NEGATIVE-EARNINGS    a loss is a valuation input
                             -> PREDICTED 2, MEASURED 3: B, C and the DB-backed loss-making
                                company. The prediction said "B and C, plus the DB-backed one" and
                                then wrote 2, which is a counting slip rather than a surprise. B is
                                zero and C is negative and both route through the same predicate,
                                so a suite with only one would not notice that `>= 0` and `> 0`
                                differ by exactly the case that matters.

  M-VAL-RANGE-UNORDERED      low/base/high need not ascend
                             -> PREDICTED 1 (F), MEASURED 2: F and L. L sweeps every non-COMPUTED
                                status and asserts none of them carries a number, and one of its
                                five shapes is an inverted range -- so it catches this without
                                having been aimed at it. E stays green, which is the intended
                                split: malformed and negative multiples leave through a different
                                branch.

  M-VAL-TAG-SUBSTITUTED      the revenue tag reported is the first tracked one, whatever was used
                             -> PREDICTED 2, MEASURED 4: J and J3 in the pure suite, plus both
                                DB-backed controls that name a tag. The prediction counted only the
                                pure suite and forgot that the integration controls assert the tag
                                too -- which is the more important half, because that is where the
                                tag travels from a real database column. This is the mutation the
                                DATA_POLICY warning about unifying tags at the presentation layer
                                is about: the VALUE stays correct and only the label lies, so
                                nothing arithmetic can catch it.

  M-VAL-ASSUMPTION-IS-FACT   the user's multiple is dressed as a sourced fact
                             -> PREDICTED 1, MEASURED 1: control K. RE-AIMED after the first
                                version measured 6. That version replaced the whole object literal
                                and so dropped `low`/`base`/`high` as well as flipping the label,
                                which made every COMPUTED control fail on NaN -- caught, but for
                                the wrong reason, and it would have passed just as loudly if the
                                label had been left alone. It now changes ONLY `kind`, so the
                                single control that reads the discriminators is the only one that
                                can see it. A mutant that dies of a side effect proves nothing
                                about the guard it was written for.

  M-VAL-UNVERIFIABLE-SCORED  a refusal still publishes the arithmetic
                             -> PREDICTED "at least 6", MEASURED 6. Every refusal control asserts
                                the absence of a number, which is what makes this the widest mutant
                                in the suite: turning UNVERIFIABLE into a value is the single
                                failure that would make every other guard cosmetic.

  M-VAL-RECOMMENDS           a verdict word enters the output contract
                             -> PREDICTED 1, MEASURED 1: control M. It scans every string in every
                                result against the forbidden vocabulary with word boundaries, so a
                                single added word anywhere in the shape is enough.

    python scripts/mutation/valuationscenario.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

VALUATION = "src/server/domain/valuationScenario.ts"
UNIT_TEST = "tests/valuationScenario.test.ts"
DB_TEST = "tests/integration/company-valuation-surface.test.ts"

BINDING_TESTS = [UNIT_TEST, DB_TEST]
UNRELATED_TESTS = [
    # The guardrail that decides what may be said to a user at all. A valuation surface is the
    # first output in this product that touches the boundary those tests defend, so they are held
    # green under every mutant rather than merely run once at the end.
    "tests/askMarketPositionGuardrail.test.ts",
    "tests/adviceGuardrailEvaluation.test.ts",
    "tests/etfSchemaGuardrail.test.ts",
]

MUTATIONS = [
    (
        "M-VAL-PROVENANCE-IGNORED a figure with no filing identity is good enough",
        VALUATION,
        "  const sourced = usableUnit.filter((f) => hasProvenance(f, sourceCode));\n",
        "  const sourced = usableUnit;\n  void hasProvenance;\n",
    ),
    (
        "M-VAL-NEGATIVE-EARNINGS a loss is a valuation input",
        VALUATION,
        "  const positive = finite.filter((f) => f.value > 0);\n",
        "  const positive = finite;\n",
    ),
    (
        "M-VAL-RANGE-UNORDERED low/base/high need not ascend",
        VALUATION,
        '  if (!(m.low <= m.base && m.base <= m.high)) return "RANGE_NOT_ASCENDING";\n',
        "",
    ),
    (
        "M-VAL-TAG-SUBSTITUTED the reported tag is the first tracked one whatever was used",
        VALUATION,
        "    concept: figure.concept,\n",
        "    concept: REVENUE_CONCEPTS.includes(figure.concept as (typeof REVENUE_CONCEPTS)[number])\n"
        "      ? REVENUE_CONCEPTS[0]\n"
        "      : figure.concept,\n",
    ),
    (
        "M-VAL-ASSUMPTION-IS-FACT the user's multiple is dressed as a sourced fact",
        VALUATION,
        '  const assumptions: UserAssumptions = {\n    kind: "USER_ASSUMPTION",\n',
        '  const assumptions = {\n    kind: "FACT" as UserAssumptions["kind"],\n',
    ),
    (
        "M-VAL-UNVERIFIABLE-SCORED a refusal still publishes the arithmetic",
        VALUATION,
        "  if (!selection.ok) {\n    return { ...base, status: \"UNVERIFIABLE\", unverifiableBecause: selection.because };\n  }\n",
        "  if (!selection.ok) {\n"
        "    return {\n"
        "      ...base,\n"
        '      status: "UNVERIFIABLE",\n'
        "      unverifiableBecause: selection.because,\n"
        "      impliedEquityValue: {\n"
        '        kind: "CALCULATION" as const,\n'
        "        low: 0,\n"
        "        base: 0,\n"
        "        high: 0,\n"
        '        unit: "USD",\n'
        '        formula: "unavailable",\n'
        "      },\n"
        "    };\n"
        "  }\n",
    ),
    (
        "M-VAL-RECOMMENDS a verdict word enters the output contract",
        VALUATION,
        '    formula: `${fact.concept} (${fact.periodStart ?? "?"} → ${fact.periodEnd}) × multiple`,\n',
        '    formula: `${fact.concept} fair value estimate × multiple`,\n',
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 7. Not a substitute for the full set.")

sys.exit(
    harness(
        [VALUATION, UNIT_TEST, DB_TEST],
        BINDING_TESTS,
        UNRELATED_TESTS,
        MUTATIONS,
        wall_seconds=1200,
    )
)
