"""M-FMT: can the format gate be talked into writing, into calling unknown clean, or into
answering about the live checkout instead of the revision it names?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

Four defects, each found after the previous repair, and each leaving a property behind:

  1. it must measure the gate CI runs, not the files one unit happened to touch;
  2. it must never write to the tree it measures;
  3. it must never convert an evaluator error into a pass;
  4. its answer must be f(rev) -- not f(rev, live index, live ignore, live config).

Every mutant below breaks exactly one of those and must be caught by a control that reproduces the
situation, not by an assertion about output text.

Expected cardinalities, written before the run:

  M-FMT-READ-DISK            read the working copy instead of the revision
                             -> PREDICTED 1, MEASURED 2: the CRLF control and the
                                dirty-and-committed-offender control.

  M-FMT-WRITE-TREE           write the formatted result back
                             -> PREDICTED 4, MEASURED 1, then 2 after a control was added for the
                                gap that number exposed. It writes only where the revision's bytes
                                are an offender, and every preservation fixture committed clean
                                content and dirtied it afterwards -- so a writing gate had nothing
                                to reach for. The original bug's scenario, dirty work over a file
                                that is ALSO a committed offender, was the missing control.

  M-FMT-FAIL-OPEN            treat an evaluation failure as "not an offence"
                             -> 3 red, as predicted: unparsable TS, unparsable JSON, and the
                                both-kinds control.
                                Each compares against the CANONICAL gate in the same test, so the
                                catch is a measured disagreement with `prettier --check .`.

  M-FMT-NO-OFFENDERS         answer "clean" for everything
                             -> PREDICTED 5, MEASURED 10. Eight more controls exist than when
                                that figure was written, and most of them name an offender.

  M-FMT-LIVE-FILESET         enumerate the live index instead of the revision's tree
                             -> PREDICTED 1, MEASURED 2: the staged-deletion control, where
                                `git ls-files` no longer lists a file the revision still contains,
                                plus the rev-binding control.

  M-FMT-LIVE-IGNORE          resolve `.prettierignore` from the active checkout
                             -> PREDICTED 3, MEASURED 2: the uncommitted-ignore and staged-ignore
                                controls. The committed-ignore control stays GREEN, and the reason
                                is worth keeping: in that fixture the committed ignore file is also
                                the one on disk, so live and revision authority agree and the mutant
                                is invisible there. Only a DIVERGENCE between them can catch it.

  M-FMT-LIVE-CONFIG          resolve Prettier options from the active checkout
                             -> 1 red: the uncommitted-options control, whose committed file is
                                clean under the revision's defaults and an offender under a dirty
                                `singleQuote` config.

  M-FMT-ARCHIVE-CONVERTS     let `git archive` apply the checkout's line-ending conversion
                             -> 1 red: the autocrlf control. This is defect (1) reappearing inside
                                the fourth repair: on this machine it turned a clean tree into 423
                                reported offenders, measured before it was fixed.

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
        "M-FMT-READ-DISK the working copy is measured instead of the revision",
        GATE,
        "      const source = readFileSync(materialised, \"utf8\");",
        '      const source = readFileSync((await import("node:path")).join(cwd, path), "utf8");',
    ),
    (
        "M-FMT-WRITE-TREE the gate writes the formatted result back to the tree",
        GATE,
        '      if (!formatted) findings.push({ path, kind: "MISFORMATTED" });',
        "      if (!formatted) {\n"
        '        findings.push({ path, kind: "MISFORMATTED" });\n'
        '        const fs = await import("node:fs");\n'
        '        const p = await import("node:path");\n'
        '        const prettier = await import("prettier");\n'
        "        fs.writeFileSync(\n"
        "          p.join(cwd, path),\n"
        "          await prettier.format(source, { ...(options ?? {}), filepath: materialised, parser }),\n"
        '          "utf8",\n'
        "        );\n"
        "      }",
    ),
    (
        "M-FMT-FAIL-OPEN an evaluation failure is skipped instead of reported",
        GATE,
        "        findings.push({\n"
        "          path,\n"
        '          kind: "EVALUATION_ERROR",\n'
        '          detail: (error as Error).message.split("\\n")[0],\n'
        "        });\n"
        "        continue;",
        "        void error;\n        continue;",
    ),
    (
        "M-FMT-NO-OFFENDERS every file is reported as clean",
        GATE,
        '      if (!formatted) findings.push({ path, kind: "MISFORMATTED" });\n    }\n\n    return findings;',
        "      void formatted;\n    }\n\n    return findings;",
    ),
    (
        "M-FMT-LIVE-FILESET the live index decides which files exist",
        GATE,
        '  const expected = git(["ls-tree", "-r", "--name-only", "-z", rev], cwd)',
        '  const expected = git(["ls-files", "-z"], cwd)',
    ),
    (
        "M-FMT-LIVE-IGNORE the active checkout's ignore file decides what is skipped",
        GATE,
        '          ignorePath: join(tree, ".prettierignore"),',
        '          ignorePath: join(cwd, ".prettierignore"),',
    ),
    (
        "M-FMT-LIVE-CONFIG the active checkout's Prettier options judge the revision",
        GATE,
        "        options = await resolveConfig(materialised);",
        "        options = await resolveConfig(join(cwd, path));",
    ),
    (
        "M-FMT-ARCHIVE-CONVERTS the archive applies the checkout's line-ending conversion",
        GATE,
        '    execFileSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", "-o", tar, rev], {',
        '    execFileSync("git", ["archive", "--format=tar", "-o", tar, rev], {',
    ),
]

sys.exit(harness([GATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
