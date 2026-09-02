"""M-FMT: can the format gate be talked into writing, into calling unknown clean, or into
answering about the live checkout instead of the revision it names?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

Five defects, each found after the previous repair, each leaving a property behind:

  1. measure the gate CI runs, not the files one unit happened to touch;
  2. never write to the tree being measured;
  3. never convert an evaluator error into a pass;
  4. the answer must be f(rev) -- not f(rev, live index, live ignore, live config);
  5. and the revision's BYTES are its blobs: `git archive` transforms content via `export-subst`,
     applies checkout line-ending conversion, and cannot extract a symlink on Windows.

The fifth repair made the gate SMALLER. Prettier's `resolveConfig` and `getFileInfo` were MEASURED
not to require the file to exist, so only the revision's config-bearing files are written to a
scratch tree; content comes from `git show`, and enumeration from `git ls-tree` with modes.

Expected cardinalities, written before the run:

  M-FMT-READ-DISK            judge the ACTIVE WORKING COPY instead of the blob
                             -> 3 red: the CRLF control, the dirty-and-committed-offender control
                                and the export-subst control.

  M-FMT-WRITE-TREE           write the formatted result back into the active checkout
                             -> 3 red: the preservation controls, which hash the whole repository.

  M-FMT-FAIL-OPEN            treat an evaluation failure as "not an offence"
                             -> 3 red: unparsable TS, unparsable JSON, both-kinds. Each compares
                                against the CANONICAL gate in the same test, so the catch is a
                                measured disagreement with `prettier --check .`.

  M-FMT-NO-OFFENDERS         answer "clean" for everything
                             -> 12 red: every control that names an offender.

  M-FMT-LIVE-FILESET         enumerate the live index instead of the revision's tree
                             -> 3 red: staged deletion, staged rename, rev-binding.

  M-FMT-LIVE-IGNORE          resolve `.prettierignore` from the active checkout
                             -> 2 red: uncommitted-ignore and staged-ignore. The committed-ignore
                                control stays GREEN because there the two authorities agree, and
                                only a DIVERGENCE between them can catch this.

  M-FMT-LIVE-CONFIG          resolve Prettier options from the active checkout
                             -> 1 red: the uncommitted-options control.

  M-FMT-NO-TOOL-IDENTITY     judge with whatever Prettier happens to be installed
                             -> PREDICTED 3, MEASURED 4: no-declaration, wrong-version, range-only
                                and the symlink control, whose fixture also declares a formatter.
                                The lock-matches control stays GREEN, so "always refuse" cannot
                                pass for the fix.

  M-FMT-FOLLOW-SYMLINK       judge a symlink as if it were a file
                             -> 1 red: the symlink control.

RETIRED, with reasons rather than deletion:

  M-FMT-ARCHIVE-BYTES        there is no materialised file left to read instead of the blob. The
                             property it protected is covered by M-FMT-READ-DISK plus the
                             export-subst control, which is what made the distinction observable.

  M-FMT-ARCHIVE-CONVERTS     `git archive` is gone, and with it the conversion it applied. It had
                             already come back MISSED once: after content moved to `git show` the
                             flag stopped affecting any judged byte, and the honest answer was that
                             the mutant had stopped testing anything.

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
        "M-FMT-READ-DISK the active working copy is judged instead of the blob",
        GATE,
        "      const source = committedFile(path, rev, cwd);\n      if (source === null) {",
        '      const source = readFileSync((await import("node:path")).join(cwd, path), "utf8");\n'
        "      if (false) {",
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
        "          await prettier.format(source, { ...(options ?? {}), filepath: asked, parser }),\n"
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
        '  const entries = git(["ls-tree", "-r", "-z", rev], cwd)\n'
        '    .split("\\0")\n'
        "    .filter(Boolean)\n"
        "    .map((line) => {\n"
        '      const [meta, path] = line.split("\\t");\n'
        '      return { mode: meta.split(" ")[0], path };\n'
        "    });",
        '  const entries = git(["ls-files", "-z"], cwd)\n'
        '    .split("\\0")\n'
        "    .filter(Boolean)\n"
        '    .map((path) => ({ mode: "100644", path }));',
    ),
    (
        "M-FMT-LIVE-IGNORE the active checkout's ignore file decides what is skipped",
        GATE,
        '    const ignorePath = join(scratch, ".prettierignore");',
        '    const ignorePath = join(cwd, ".prettierignore");',
    ),
    (
        "M-FMT-LIVE-CONFIG the active checkout's Prettier options judge the revision",
        GATE,
        "        options = await resolveConfig(asked);",
        "        options = await resolveConfig(join(cwd, path));",
    ),
    (
        "M-FMT-NO-TOOL-IDENTITY the running formatter is assumed to be the revision's",
        GATE,
        "  const identity = formatterIdentity(cwd, rev, running);",
        "  const identity = { ok: true } as ReturnType<typeof formatterIdentity>;",
    ),
    (
        "M-FMT-FOLLOW-SYMLINK a symlink is judged as if it were a file",
        GATE,
        '      if (mode === "120000") {',
        "      if (false) {",
    ),
]

sys.exit(harness([GATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=2400))
