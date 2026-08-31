"""M-IVAL: is the typed interval family load-bearing, and does each policy fail for its own reason?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and these anchors carry
escaped newlines.

Gate A of `[CHATGPT_DECISION][MARKET-OS][DEC-INTERVAL-FAMILY-20260831]`. The decision asks for
"exact calendar-boundary discrimination" and says plainly: deleting the trailing-family admission or
changing the resolver policy must fail FOR THE INTENDED REASON, and an UNKNOWN/fallback failure is
not proof. So each mutant below changes exactly one policy, and the binding tests are the ones that
state that policy rather than a suite-wide count.

The distinction these guard is the one the module exists to hold. `last quarter` is the previous
COMPLETE calendar quarter; `over the past 1 quarter` is a RUNNING trailing three months. They are
different periods reachable by different phrases, and a mutant that collapses them must be caught.

  M-IVAL-TRAILING-OFF   the trailing phrase stops parsing at all
  M-IVAL-QUARTER-SPAN   a trailing quarter stops being three months
  M-IVAL-CLAMP          an impossible calendar day is clamped instead of refused
  M-IVAL-ZERO           a non-positive count is admitted
  M-IVAL-WEEK-ISO       a trailing week becomes the ISO calendar week

    python scripts/mutation/intervalfamily.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

PERIOD = "src/server/domain/observationPeriod.ts"

BINDING_TESTS = [
    "tests/observationPeriod.test.ts",
]
UNRELATED_TESTS = [
    # A period-resolution change must not reach request recognition or repository authority.
    "tests/requestAuthority.test.ts",
    "tests/integration/source-authority.test.ts",
]

MUTATIONS = [
    # M-IVAL-TRAILING-OFF -- the whole trailing family goes. `over the past 6 weeks` must stop
    # resolving; if it does not, something else was answering it and this grammar is not the thing
    # under test.
    (
        "M-IVAL-TRAILING-OFF the trailing phrase stops parsing",
        PERIOD,
        "  const trailing = TRAILING_PHRASE.exec(text);\n"
        "  if (!trailing) return null;",
        "  const trailing = TRAILING_PHRASE.exec(text);\n"
        "  if (trailing) return null;\n"
        "  if (!trailing) return null;",
    ),
    # M-IVAL-QUARTER-SPAN -- a trailing quarter becomes one month. This must break the
    # `last quarter` versus `over the past 1 quarter` discrimination specifically, not merely
    # some count somewhere.
    (
        "M-IVAL-QUARTER-SPAN a trailing quarter stops being three months",
        PERIOD,
        "    case \"quarter\":\n"
        "      // A trailing 3N-month window, NOT the previous complete calendar quarter. The two are\n"
        "      // different periods and the decision names the distinction explicitly.\n"
        "      return 3;",
        "    case \"quarter\":\n"
        "      return 1;",
    ),
    # M-IVAL-CLAMP -- the impossible calendar day is clamped to the nearest instead of refused,
    # which is the single policy `sameDayMonthsBefore` was written to prevent.
    (
        "M-IVAL-CLAMP an impossible calendar day is clamped instead of refused",
        PERIOD,
        "  return candidate.getUTCDate() === day ? candidate : null;",
        "  return candidate;",
    ),
    # M-IVAL-ZERO -- a non-positive or fractional count is admitted, so `over the past 0 weeks`
    # becomes a period.
    (
        "M-IVAL-ZERO a non-positive count is admitted",
        PERIOD,
        "  if (!Number.isInteger(count) || count < 1) return null;",
        "",
    ),
    # M-IVAL-WEEK-ISO -- a trailing week becomes the ISO calendar week, collapsing the very
    # distinction the decision spells out for weeks.
    (
        "M-IVAL-WEEK-ISO a trailing week becomes the ISO calendar week",
        PERIOD,
        "      const days = interval.unit === \"day\" ? interval.count : interval.count * 7;\n"
        "      return resolved({ start: addDays(asOf, -days).toISOString().slice(0, 10), ...toDate });",
        "      const days = interval.unit === \"day\" ? interval.count : interval.count * 7;\n"
        "      const base = interval.unit === \"day\" ? asOf : isoWeekStart(asOf);\n"
        "      return resolved({ start: addDays(base, -days).toISOString().slice(0, 10), ...toDate });",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 5. Not a substitute for the full set.")

sys.exit(harness([PERIOD], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
