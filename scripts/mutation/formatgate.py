"""M-FMT: can the format gate be talked into writing to the tree it is measuring?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

The gate's first version measured by running `prettier --write .` against the LIVE working tree and
asking git what changed. It found the right answer and could silently reformat a user's uncommitted
work, because it snapshotted only the NAMES of already-dirty files and then excluded them from both
the report and the restore. A verifier editing the thing it measures is the failure the gate exists
to catch, committed while writing it.

The repair is not "restore afterwards" -- that still writes, and still loses on the throwing path.
So the mutants attack the two properties that replaced it: read COMMITTED bytes, and never write.

Expected cardinalities, written before the run:

  M-FMT-READ-DISK            read the working copy instead of the committed blob
                             -> 1 red: the CRLF control. This is the "checkout noise counted as a
                                committed offender" case, and it is exactly why the real
                                `format:check` is unreadable on this machine -- 67 files against
                                CI's 1.

  M-FMT-WRITE-TREE           write the formatted result back, as the first version effectively did
                             -> PREDICTED 4, MEASURED 1, then 2 after a control was added for the
                                gap that number exposed.

                                The prediction assumed the mutant would write in every preservation
                                fixture. It writes only where the COMMITTED bytes are an offender,
                                and every fixture committed WELL-formatted content and dirtied it
                                afterwards -- so a writing gate had nothing to reach for in any of
                                them. That left the original bug's exact scenario unexercised: a
                                user's dirty work on top of a file that is ALSO a committed
                                offender. A control for it was added and the mutant went to 2.

                                The untracked control stays green under it, and that is worth
                                knowing rather than fixing: an untracked file is not in
                                `git ls-files`, so the guarantee there comes from never
                                enumerating it rather than from a check.

  M-FMT-NO-OFFENDERS         answer "clean" for everything
                             -> 2 red: the vacuity control and the offender-plus-clean control.
                                Every other assertion is about what did NOT happen, so without
                                these two a gate that always returned an empty list would satisfy
                                the entire suite.

    python scripts/mutation/formatgate.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

GATE = "scripts/format-gate.ts"
TEST = "tests/formatGate.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-FMT-READ-DISK the working copy is measured instead of the committed bytes",
        GATE,
        "    const source = committedBytes(path, rev, cwd);\n    if (source === null) continue;",
        "    const source = (await import(\"node:fs\")).readFileSync(\n"
        "      (await import(\"node:path\")).join(cwd, path),\n"
        '      "utf8",\n'
        "    );",
    ),
    (
        "M-FMT-WRITE-TREE the gate writes the formatted result back to the tree",
        GATE,
        "    if (!formatted) offenders.push(path);",
        "    if (!formatted) {\n"
        "      offenders.push(path);\n"
        "      const fs = await import(\"node:fs\");\n"
        "      const p = await import(\"node:path\");\n"
        "      const prettier = await import(\"prettier\");\n"
        "      fs.writeFileSync(\n"
        "        p.join(cwd, path),\n"
        "        await prettier.format(source, { ...options, filepath: path }),\n"
        '        "utf8",\n'
        "      );\n"
        "    }",
    ),
    (
        "M-FMT-NO-OFFENDERS every committed file is reported as clean",
        GATE,
        "    if (!formatted) offenders.push(path);\n  }\n\n  return offenders;",
        "    void formatted;\n  }\n\n  return offenders;",
    ),
]

sys.exit(harness([GATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
