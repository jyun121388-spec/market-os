"""M-BUS: can the control bus be talked into being two buses?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

`.local/control-bus` was a NAME being used as a PLACE. `storePaths()` defaulted to that relative
string, resolved against `process.cwd()`, so every module agreed on what the bus was called and
nothing agreed on where it was. Measured across the two worktrees this repository actually has:

    from C:/AI-Projects/market-os                  -> market-os/.local/control-bus     state EXISTS
    from C:/AI-Projects/market-os-ask-guardrail    -> guardrail/.local/control-bus     state ABSENT

Reading from the second reports an empty inbox. WRITING from it is the hazard: `control-bus.ts` and
`rc-preflight.ts` accept no root at all, so starting the watcher from the wrong worktree would have
built a second durable inbox with its own cursor -- against "one issue, never a second", and against
`DURABLE_INBOX_BEFORE_CURSOR_ADVANCE`, which assumes there is one cursor to advance. It had not
fired only because every write so far passed `--bus-root` by hand.

NOT MUTATED, deliberately: "storePaths ignores its explicit root". It is a plausible reversal, and
under it the fixtures in the binding test would write through the DEFAULT root -- which, after this
repair, is the real live control bus. A mutation that corrupts the production inbox is not a
measurement. The property is covered instead by a control asserting an explicit root survives
untouched, which is what the mutant would have had to break.

Expected cardinalities, written before the run:

  M-BUS-CWD-ROOT             ignore git; hand back the relative name, as before the repair
                             -> PREDICTED 3, MEASURED 4: the gitignore/absoluteness control, the
                                absolute-from-both control, the beside-the-shared-.git control --
                                and the FAIL-CLOSED control, which the prediction missed. Returning
                                early short-circuits the git call entirely, so an unanswerable
                                question also stops producing an error. The mutant subsumes
                                M-BUS-FALLBACK-ON-ERROR, and only running it said so.

                                NOT the cross-worktree equality control. A constant is equal to
                                itself, so the very control that names the defect is the one that
                                cannot catch its most obvious form -- which is the point of writing
                                the prediction down instead of counting the tests that mention it.

  M-BUS-PER-WORKTREE-GIT-DIR  `--git-dir` instead of `--git-common-dir`
                             -> PREDICTED 2, MEASURED 3: cross-worktree equality (a linked
                                worktree's own git dir is under `.git/worktrees/<name>`),
                                beside-the-shared-.git, and the gitignore/absoluteness control.
                                The third is a consequence of WHERE THE SUITE RUNS: vitest's cwd is
                                the linked worktree, so the root lands inside `.git/worktrees/...`,
                                and git reports nothing inside the git dir as ignored.

  M-BUS-PLAIN-PATH-FORMAT    drop `--path-format=absolute`
                             -> PREDICTED 2, MEASURED 3: cross-worktree equality, absolute-from-
                                both, and the SUBDIRECTORY equality control. git answers `.git` only
                                from the top of the main worktree and an absolute path from
                                anywhere else, so top-vs-subdirectory diverges for the same reason
                                main-vs-linked does. The two equality controls are not redundant;
                                they catch different halves of the same cwd-dependence.

                                The gitignore control stays GREEN here, and that is the hazard this
                                mutant exists to show: vitest runs from a LINKED worktree, where the
                                plain form is already absolute. Tested only from there, the missing
                                flag looks like no defect at all.

  M-BUS-IGNORE-ALWAYS-TRUE   the ignore question always answers yes
                             -> 1 red: the clean-checkout control, whose second half asserts that a
                                path the ignore rules do NOT cover comes back false. The main
                                control cannot catch this -- it only ever asks about a path that is
                                genuinely ignored.

  M-BUS-IGNORE-CWD-RESIDUE   ask git from the runtime directory instead of the repository root
                             -> 1 red: the clean-checkout control. This IS the defect remote CI run
                                33665629122 caught and every local run missed, because this
                                machine's `.local` holds a portable PostgreSQL and has existed for
                                weeks. The main control stays GREEN under this mutant on any machine
                                with runtime residue, which is exactly why the clean fixture had to
                                be built: a control that passes because of what is lying around is
                                not a control.

  M-BUS-FALLBACK-ON-ERROR    on an unanswerable question, fall back to the relative name
                             -> 1 red: the fail-closed control. Falling back to the working
                                directory when git cannot answer restores exactly the defect, at
                                the moment there is least evidence about where the bus is.

    python scripts/mutation/busroot.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

ROOT = "src/server/controlbus/root.ts"
TEST = "tests/controlBus.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

RESOLVE = '''  let common: string;
  try {
    common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {'''

MUTATIONS = [
    (
        "M-BUS-CWD-ROOT the bus root is the relative name again, resolved against the cwd",
        ROOT,
        RESOLVE,
        '''  return { root: RUNTIME_DIR };
  let common: string;
  try {
    common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {''',
    ),
    (
        "M-BUS-PER-WORKTREE-GIT-DIR each worktree's own git dir stands in for the shared one",
        ROOT,
        '["rev-parse", "--path-format=absolute", "--git-common-dir"]',
        '["rev-parse", "--path-format=absolute", "--git-dir"]',
    ),
    (
        "M-BUS-PLAIN-PATH-FORMAT the absolute path format is dropped",
        ROOT,
        '["rev-parse", "--path-format=absolute", "--git-common-dir"]',
        '["rev-parse", "--git-common-dir"]',
    ),
    (
        "M-BUS-IGNORE-ALWAYS-TRUE the ignore question always answers yes",
        TEST,
        '''    execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", path], { stdio: "ignore" });
    return true;''',
        """    void repoRoot;
    void path;
    return true;""",
    ),
    (
        "M-BUS-IGNORE-CWD-RESIDUE the ignore question is asked from the runtime directory",
        TEST,
        'execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", path], { stdio: "ignore" });',
        'execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: dirname(path), stdio: "ignore" });',
    ),
    (
        "M-BUS-FALLBACK-ON-ERROR an unanswerable question falls back to the working directory",
        ROOT,
        """      error: `git cannot name the repository from ${cwd} (${(error as Error).message.split("\\n")[0]})`,
    };""",
        """      root: RUNTIME_DIR,
    } as unknown as { error: string };""",
    ),
]

sys.exit(harness([ROOT, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
