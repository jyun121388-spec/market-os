"""M-FMT: can the format gate be talked into writing to the tree, or into calling unknown clean?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

Two properties, arrived at through two separate defects in the same file.

The first version measured by running `prettier --write .` against the LIVE working tree and asking
git what changed. It found the right answer and could silently reformat a user's uncommitted work:
it snapshotted only the NAMES of already-dirty files and excluded them from both the report and the
restore. A verifier editing the thing it measures is the failure the gate exists to catch.

The rewritten version read committed bytes and never wrote -- and still carried
`catch { continue; }` around the Prettier call. That is fail-OPEN: canonical `prettier --check .`
exits non-zero when it cannot evaluate a file, so a throw here let the diagnostic report clean about
a tree CI rejects.

So: read COMMITTED bytes, never write, and never convert an evaluator error into a pass.

Expected cardinalities, written before the run:

  M-FMT-READ-DISK            read the working copy instead of the committed blob
                             -> 1 red: the CRLF control. This is the "checkout noise counted as a
                                committed offender" case, and it is why the real `format:check` is
                                unreadable on this machine -- 67 files against CI's 1.

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
                                `git ls-files`, so the guarantee there comes from never enumerating
                                it rather than from a check.

  M-FMT-FAIL-OPEN            treat a Prettier evaluation failure as "not an offence"
                             -> 3 red: the unparsable-TS control, the unparsable-JSON control and
                                the both-kinds control. Each of those fixtures is checked against
                                the CANONICAL gate in the same test, so the mutant is caught by a
                                measured disagreement with `prettier --check .` rather than by an
                                assertion about this gate alone.

  M-FMT-NO-OFFENDERS         answer "clean" for everything
                             -> PREDICTED 4, MEASURED 5 -- the both-kinds control fires too. The
                                vacuity, offender-plus-clean, dirty-and-committed-offender,
                                misformatted and both-kinds controls.
                                Every preservation assertion is about what did NOT happen, so
                                without these a gate returning an empty list would satisfy them all.

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
        '    const source = (await import("node:fs")).readFileSync(\n'
        '      (await import("node:path")).join(cwd, path),\n'
        '      "utf8",\n'
        "    );",
    ),
    (
        "M-FMT-WRITE-TREE the gate writes the formatted result back to the tree",
        GATE,
        '    if (!formatted) findings.push({ path, kind: "MISFORMATTED" });',
        "    if (!formatted) {\n"
        '      findings.push({ path, kind: "MISFORMATTED" });\n'
        '      const fs = await import("node:fs");\n'
        '      const p = await import("node:path");\n'
        '      const prettier = await import("prettier");\n'
        "      fs.writeFileSync(\n"
        "        p.join(cwd, path),\n"
        "        await prettier.format(source, { ...options, filepath: path }),\n"
        '        "utf8",\n'
        "      );\n"
        "    }",
    ),
    (
        "M-FMT-FAIL-OPEN an evaluation failure is skipped instead of reported",
        GATE,
        "      findings.push({\n"
        "        path,\n"
        '        kind: "EVALUATION_ERROR",\n'
        '        detail: (error as Error).message.split("\\n")[0],\n'
        "      });\n"
        "      continue;",
        "      void error;\n      continue;",
    ),
    (
        "M-FMT-NO-OFFENDERS every committed file is reported as clean",
        GATE,
        '    if (!formatted) findings.push({ path, kind: "MISFORMATTED" });\n  }\n\n  return findings;',
        "    void formatted;\n  }\n\n  return findings;",
    ),
]

sys.exit(harness([GATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1200))
