"""M-CUR: does current-value authority actually rest on the provider's vintage?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`[CHATGPT_DECISION][MARKET-REVISION-CHAIN-ORDERING-20260906]`, IR-131. Reproduced on a real
database: the writer attaches each new row to the chain's current tail, so chain structure encodes
ARRIVAL order, and `findRevisionChainTail` faithfully returns the last-arrived row. Ingesting FRED's
vintage history into a chain that already held the current value put three older vintages after the
newest, and the read path served 300.456 where the current value is 300.420.

Every mutant below reaches the PRODUCTION READ PATH. The binding suite is an integration file that
drives `getRecentObservationPair` and `getObservationsOneRowPerDate` against a real database -- the
two functions Morning Brief, What Changed, Macro Regime, Ask Market, Economic Calendar, Historical
Analog and the Verify shadow run all call. A helper-only surrogate would prove nothing about what a
user is shown, which is the whole subject here.

The failure modes are the ones that look like simplification. Arrival order is what the code did
for a year and reads as "the obvious way"; `retrievedAt` and `id` are right there in the query's
tiebreak clause; treating an unknown vintage as newest turns a refusal into an answer, which always
looks like progress.

Cardinalities were predicted before each run and are CORRECTED TO MEASURED below, with the reason
wherever they differed. Two runs exist: `28dd05ba07d8` (six mutants, 6/6 ISOLATED) and, after
adversarial review added the tie and validity mutants and moved `tests/revisionChain.test.ts` into
the binding set, `c23e8f988ec2` (eight mutants, 8/8 ISOLATED, unrelated 6/6 green throughout). The
per-mutant counts below are from the FIRST run for the original six, because that run's binding set
is the one the predictions were written against; the second run's counts are higher for the same
mutants only because a second binding file was added. Five of eight predictions were wrong, and
three of the misses are worth more than the numbers.

  M-CUR-ARRIVAL-TAIL       current is the structural tail again -- the defect, restored
                           -> PREDICTED 3 (A, B, C), MEASURED 5: A, C, D, D2, F.

                              **B stays GREEN, and that is the finding.** In B the vintages arrive
                              oldest-to-newest, so arrival order and vintage order AGREE and the
                              wrong rule gives the right answer. B is a real control -- it proves
                              the newest vintage wins -- but it cannot see the defect this unit
                              exists to fix. Only A puts the current row FIRST, which is the shape
                              that actually occurred. A suite of B-shaped controls would have been
                              fully green against the broken code.

                              D and D2 were predicted green on the theory that a mixed or tied chain
                              never reaches the vintage branch. Wrong: this mutant empties the
                              vintage set entirely, so mixed and tied chains stop being refused and
                              start returning a structural answer. F likewise -- its two rows are
                              written newest-vintage-first, so arrival order picks the older one.

  M-CUR-ORDER-RETRIEVEDAT  current is the most recently retrieved row
                           -> PREDICTED 3, MEASURED 3. C is the load-bearing one -- it forces every
                              row to an identical `retrievedAt`, so this mutant cannot even be
                              consistently wrong there.

  M-CUR-ORDER-ID           current is decided by row id
                           -> PREDICTED "1-3, not predictable", MEASURED 4 in the harness run and 2
                              (B, D2) in a repeat. Both are correct: ids are random UUIDs, so this
                              mutant is right by luck a varying fraction of the time, and the count
                              is genuinely a random variable rather than a property. The ISOLATED
                              verdict is what this mutant establishes; the number is not evidence
                              about anything and is recorded only to show it moved. C runs its
                              assertion five times for exactly this reason.

  M-CUR-REVERSE-VINTAGE    the OLDEST vintage wins
                           -> PREDICTED 2 (A, B), MEASURED 4: A, B, C, F. C and F were predicted
                              green on the theory that they only catch clock ordering; in fact both
                              fixtures happen to have a newest vintage that is not first in arrival
                              order either, so reversing the comparison moves their answer too. The
                              prediction was reasoning about what each control was FOR rather than
                              about the rows it contains.

  M-CUR-NULL-IS-NEWEST     an undated row is treated as the newest
                           -> PREDICTED 1, MEASURED 1: D alone. Nothing else has an undated row in a
                              chain that also has dated ones, so ONE control stands between this
                              repository and a rule that would silently prefer exactly the rows
                              carrying no evidence.

  M-CUR-NO-MIXED-REFUSAL   the mixed-chain branch is removed
                           -> PREDICTED 1, MEASURED 1: D alone, for the same reason. D and this
                              mutant are the only things in the suite that exercise the CPIAUCSL
                              shape, which is the shape that was actually measured wrong.

  M-CUR-NO-TIE-REFUSAL     a tied maximum vintage picks a row anyway
                           -> ADDED AFTER THE FIRST RUN, on a finding from adversarial review of
                              this repair: the six mutants above left the tied-maximum refusal
                              load-bearing in the integration suite but not mutation-proven, so
                              nothing would have caught its removal. D2 is the only control that
                              can see it. PREDICTED 1, MEASURED 1.

  M-CUR-INVALID-VINTAGE    an unusable Date counts as a vintage
                           -> ADDED AFTER THE FIRST RUN, with the precondition it guards. Also from
                              the review: without the validity filter an `Invalid Date` makes every
                              comparison NaN, the loop never moves `latest` and never sets `tied`,
                              and the first row is returned as if the provider had chosen it.
                              PREDICTED 1, MEASURED 2: both the mixed-chain validity control and
                              the every-vintage-unusable one, because without the filter an
                              unusable Date stops routing the chain to the structural answer as
                              well. The prediction counted the branch the mutant attacks and missed
                              the branch it silently stops reaching.

    python scripts/mutation/currentauthority.py [ID ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

CHAIN = "src/server/domain/revisionChain.ts"
READERS = "src/server/domain/seriesReadings.ts"
TEST = "tests/integration/revision-chain-current-authority.test.ts"

BINDING_TESTS = [
    TEST,
    # Moved here when the validity guard and its controls were added: this file now holds unit
    # controls for `selectCurrentObservation` itself, so it binds this contract. An invalid Date
    # cannot be written through the database, so those controls CANNOT live in the integration
    # suite -- which is the one case where a pure-function control is the right tool rather than a
    # surrogate for the production path.
    "tests/revisionChain.test.ts",
]
UNRELATED_TESTS = [
    # The IR-021 rollback reproduction, and it stays here deliberately: rollback protection and
    # current-value selection are different mechanisms, and this suite going green under every
    # mutant is the evidence that the repair did not weaken it.
    "tests/integration/revision-rollback.test.ts",
]

VINTAGE_LOOP = """  // Every row has one. The provider decides, and a tie means the provider did not.
  let latest = withVintage[0];
  let tied = false;
  for (const row of withVintage.slice(1)) {
    const delta = row.releaseDate!.getTime() - latest.releaseDate!.getTime();
"""

MIXED_BRANCH = """  if (withVintage.length !== rows.length) {
    return {
      kind: "UNVERIFIABLE",
      because:
        `${withVintage.length} of ${rows.length} rows carry a provider release date. A chain that ` +
        "mixes provider-dated rows with undated ones cannot be ordered: the undated rows cannot be " +
        "placed against the dated ones, and arrival order is the thing that is not trustworthy here.",
    };
  }
"""

MUTATIONS = [
    (
        "M-CUR-ARRIVAL-TAIL current is the structural tail again",
        CHAIN,
        "  const withVintage = rows.filter(hasUsableVintage);\n",
        '  const withVintage: T[] = [];\n',
    ),
    (
        "M-CUR-ORDER-RETRIEVEDAT current is the most recently retrieved row",
        CHAIN,
        VINTAGE_LOOP,
        """  let latest = withVintage[0];
  let tied = false;
  for (const row of withVintage.slice(1)) {
    const delta =
      (row as unknown as { retrievedAt: Date }).retrievedAt.getTime() -
      (latest as unknown as { retrievedAt: Date }).retrievedAt.getTime();
""",
    ),
    (
        "M-CUR-ORDER-ID current is decided by row id",
        CHAIN,
        VINTAGE_LOOP,
        """  let latest = withVintage[0];
  let tied = false;
  for (const row of withVintage.slice(1)) {
    const delta = row.id > latest.id ? 1 : row.id < latest.id ? -1 : 0;
""",
    ),
    (
        "M-CUR-REVERSE-VINTAGE the oldest vintage wins",
        CHAIN,
        "    const delta = row.releaseDate!.getTime() - latest.releaseDate!.getTime();\n",
        "    const delta = latest.releaseDate!.getTime() - row.releaseDate!.getTime();\n",
    ),
    (
        "M-CUR-NULL-IS-NEWEST an undated row is treated as the newest",
        CHAIN,
        MIXED_BRANCH,
        """  if (withVintage.length !== rows.length) {
    return {
      kind: "CURRENT",
      row: rows.find((r) => r.releaseDate === null)!,
      basis: "PROVIDER_VINTAGE",
    };
  }
""",
    ),
    (
        "M-CUR-NO-MIXED-REFUSAL the mixed-chain branch is removed",
        CHAIN,
        MIXED_BRANCH,
        "",
    ),
    (
        "M-CUR-NO-TIE-REFUSAL a tied maximum vintage picks a row anyway",
        CHAIN,
        "    } else if (delta === 0) {\n      tied = true;\n    }\n",
        "    }\n",
    ),
    (
        "M-CUR-INVALID-VINTAGE an unusable Date counts as a vintage",
        CHAIN,
        "    r.releaseDate instanceof Date && !Number.isNaN(r.releaseDate.getTime());\n",
        "    r.releaseDate !== null;\n",
    ),
]

SELECTED = sys.argv[1:]
if SELECTED:
    MUTATIONS = [m for m in MUTATIONS if any(m[0].startswith(s) for s in SELECTED)]
    if not MUTATIONS:
        print(f"no mutant matches {SELECTED}")
        sys.exit(3)
    print(f"PARTIAL RUN: {len(MUTATIONS)} of 8. Not a substitute for the full set.")

sys.exit(
    harness([CHAIN, READERS, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800)
)
