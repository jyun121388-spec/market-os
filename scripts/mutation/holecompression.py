"""M-HOLE: is a refused date actually stopping a consumer from inventing an adjacency?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MARKET-HISTORY-HOLE-COMPRESSION-20260907]`, IR-133. IR-131 made the history
reader omit a date whose current value cannot be proven, which is right. What it left open, and what
this unit REPRODUCED before repairing, is that `historicalAnalog` computes windows by array index --
`points[i] - points[i - windowSize]` and `points[fromIndex + windowsAhead]` -- so one omitted date
shifts every later index and a field named for a period count reports a different one. Measured on a
ramp whose every one-period step is exactly 1: `subsequentChange3` returned 4 and
`subsequentChange6` returned 7.

Every mutant reaches the REAL consumer. The binding suite drives `computeHistoricalAnalog` and
`computeCalendarEntry` against a real database, which is what Ask Market, Morning Brief and the
Today page ultimately read.

The IR-131 selector controls are held as UNRELATED and must stay green throughout: this repair sits
downstream of the refusal and must not reopen the wrong-current-value defect it depends on.

Cardinalities were predicted before the run and are CORRECTED TO MEASURED below (run 0509019417a6,
2026-09-08: 8 of 8 ISOLATED, the IR-131 suites 18/18 green under every mutant). Four of eight
predictions were low, and all four for the same reason: they were written against an 11-control
suite, before adversarial review forced F to be re-expressed as a fail-closed and F2 to be added.
Those two controls then caught mutants nobody had aimed at them. The pattern is worth naming --
strengthening one control widened the blast radius of unrelated mutants, which is what a suite that
actually overlaps looks like.

  M-HOLE-NO-DETECTION        the span check always says "proven"
                             -> PREDICTED 3 (C, D, J), MEASURED 4: also F2. Every guard routes
                                through this one function, so removing it restores the pre-repair
                                behaviour whole -- including the sparse case, where nothing is
                                withheld any more and the distribution that F2 exists to refuse gets
                                published. F stays GREEN: it turns on `refusedAfterNewest`, which
                                does not consult this function at all.

  M-HOLE-COMPRESS-MIDDLE     an IR-131 refusal is no longer recorded as a withheld date
                             -> PREDICTED 3, MEASURED 5: C, D, F, F2 and J -- every hole control in
                                the suite. It is the widest of the eight because it stops the
                                EVIDENCE being produced rather than stopping it being read, so both
                                the between-points check and the after-the-last-point check go blind
                                at once. That it reddens strictly more than M-HOLE-NO-DETECTION is
                                the measurable difference between the two routes.

  M-HOLE-INDEX-IS-PERIOD     only the lookahead loses its guard; trailing changes keep theirs
                             -> PREDICTED 2, MEASURED 2: C and D. J stays GREEN, and that is the
                                point of the split: J fails closed on the CURRENT TRAILING window,
                                which this mutant does not touch. A suite of J-shaped controls would
                                have passed over the lookahead defect entirely -- and the lookahead
                                is the defect that was actually measured.

  M-HOLE-TWO-GAPS-AS-ONE     a span is refused only when exactly ONE withheld date is inside it
                             -> PREDICTED 1, MEASURED 1: D alone. C has a single hole and still
                                refuses correctly, so only the two-consecutive-gap control can see
                                this. ONE control stands between this repository and two missing
                                periods counting as one.

  M-HOLE-UNKNOWN-INTERVAL-PASSES  the current-window fail-closed branch never fires
                             -> PREDICTED 1 (J), MEASURED 2: J and F. The branch now guards both the
                                interior case and the trailing-refusal case, so disabling it is
                                visible from both ends. The prediction was written before F became a
                                fail-closed control.

  M-HOLE-PRE-REPAIR-CONSUMER the consumer ignores the evidence and computes as it did before
                             -> PREDICTED 3, MEASURED 4: C, D, F2 and J, with the IR-131 selector
                                suite fully green throughout. That combination is the decision's own
                                requirement: it proves the two mechanisms are separable, and that a
                                regression in the consumer would not be masked by the selector still
                                working. F stays GREEN here for the same reason as in
                                M-HOLE-NO-DETECTION -- `refusedAfterNewest` reads `unresolvedDates`
                                directly and does not pass through `trailingChanges`.

  M-HOLE-TRAILING-IGNORED    a refusal NEWER than every answerable point invalidates nothing
                             -> 1 red: F. ADDED AFTER ADVERSARIAL REVIEW FOUND IT IN THE REPAIR
                                ITSELF. `spansWithheldDate` looks strictly BETWEEN two points, so a
                                withheld date past the last one lies outside every span; the engine
                                took the previous window as "current" and analysed an older period
                                under the current-period contract. The same substitution the repair
                                was written to stop, arriving from the one direction the check was
                                blind to. Only a last-boundary control can see it -- C, D and J all
                                put their holes further back.

  M-HOLE-POST-FILTER-COUNT   the sample-size guard is not re-applied after dropping windows
                             -> PREDICTED 1 (F2), now PREDICTED 2: F2 and L1. The guard is removed
                                outright, so both the zero-survivor and the one-survivor shapes
                                reach the statistics. It was written when the guard read
                                `< 1` and F2 was the only control that could see it.

  M-HOLE-MIN-COMPARATORS     one surviving comparator is enough -- the guard is weakened from
                             `< 2` back to `< 1`, which is EXACTLY the tree independent review
                             reproduced as still broken
                             -> PREDICTED 1: L1 alone. F2 stays GREEN and that is the whole point
                                of the split: F2 reaches ZERO survivors, which `< 1` still refuses,
                                so F2 cannot discriminate the minimum-comparator boundary at all.
                                Its old closing assertion --
                                `matches.every(m => m.similarityScore < 1)` -- was VACUOUSLY TRUE
                                on an empty array, which is how a suite of eight mutants and twelve
                                controls passed over a P1 the packet claimed to have closed. L1
                                stands on three plainly answerable points with changes of +1 and
                                +10, so a perfect score cannot be read as the changes being equal.

  NOT COVERED, and not a gap this suite can quietly imply is closed. `sd === 0` remains reachable
  with two or more comparators when they are all IDENTICAL, and manufactures the same 1.0.
  Reproduced on the exact tree with values 100, 101, 102, 103, 113. No mutant is aimed at it here
  because no control refuses it yet: refusing a zero-spread distribution would refuse every linear
  fixture in this file, which is a boundary decision rather than a bug fix. Escalated; see
  `docs/REVIEW_DEBT.md` under IR-133.

    python scripts/mutation/holecompression.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

ANALOG = "src/server/domain/historicalAnalog.ts"
READERS = "src/server/domain/seriesReadings.ts"
TEST = "tests/integration/history-hole-compression.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = [
    # IR-131's own controls, at both levels. The hole-compression repair sits DOWNSTREAM of the
    # refusal and must not reopen the wrong-current-value defect; these staying green under every
    # mutant is that evidence.
    "tests/integration/revision-chain-current-authority.test.ts",
    "tests/revisionChain.test.ts",
]

SPAN_CHECK = "  return withheld.some((d) => d.getTime() > from && d.getTime() < to);\n"

MUTATIONS = [
    (
        "M-HOLE-NO-DETECTION the span check always says proven",
        ANALOG,
        SPAN_CHECK,
        "  return false;\n",
    ),
    (
        "M-HOLE-COMPRESS-MIDDLE an IR-131 refusal is not recorded as withheld",
        READERS,
        "        unresolvedDates.push(new Date(dateKey));\n",
        "",
    ),
    (
        "M-HOLE-INDEX-IS-PERIOD the lookahead loses its guard",
        ANALOG,
        "  if (spansWithheldDate(points[fromIndex], points[targetIndex], withheld)) return null;\n",
        "",
    ),
    (
        "M-HOLE-TWO-GAPS-AS-ONE a span is refused only when exactly one date is inside",
        ANALOG,
        SPAN_CHECK,
        "  return withheld.filter((d) => d.getTime() > from && d.getTime() < to).length === 1;\n",
    ),
    (
        "M-HOLE-UNKNOWN-INTERVAL-PASSES the current-window fail-closed never fires",
        ANALOG,
        "  if (!current.spanProven || refusedAfterNewest) {\n",
        "  if (false as boolean) {\n",
    ),
    (
        "M-HOLE-PRE-REPAIR-CONSUMER the consumer ignores the evidence entirely",
        ANALOG,
        "  const changes = trailingChanges(points, windowSize, unresolvedDates);\n",
        "  const changes = trailingChanges(points, windowSize, []);\n",
    ),
    (
        "M-HOLE-TRAILING-IGNORED a refusal newer than every point invalidates nothing",
        ANALOG,
        "  const refusedAfterNewest = unresolvedDates.some((d) => d.getTime() > newestPoint.date.getTime());\n",
        "  const refusedAfterNewest = false as boolean;\n"
        "  void newestPoint;\n",
    ),
    (
        "M-HOLE-POST-FILTER-COUNT the sample-size guard is not re-applied after the drop",
        ANALOG,
        "  if (historical.length < 2) {\n",
        "  if (false as boolean) {\n",
    ),
    (
        "M-HOLE-MIN-COMPARATORS one surviving comparator is enough",
        ANALOG,
        "  if (historical.length < 2) {\n",
        "  if (historical.length < 1) {\n",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 9. Not a substitute for the full set.")

sys.exit(
    harness([ANALOG, READERS, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800)
)
