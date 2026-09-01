/**
 * The formatting gate as CI sees it, which is not what `npm run format:check` shows on Windows.
 *
 * ## WHY THIS EXISTS
 *
 * A commit reached CI with one badly formatted file and failed run `33547628222` at
 * `npm run format:check`, before lint, typecheck, tests or build had a chance to run. Two things
 * combined, and both are worth naming:
 *
 * 1. Every unit this session ran `prettier --write` over THE FILES IT TOUCHED. That is not the
 *    gate. The gate is the whole repository, and a file can be left unformatted by a later edit
 *    that the per-file pass has already gone past — which is exactly what happened, twice, when a
 *    patch script was re-run after the formatting pass.
 * 2. Running the real gate locally does not help, because it drowns. This checkout has CRLF line
 *    endings and the repo's Prettier config wants LF, so `format:check` reports SIXTY-SEVEN files
 *    and CI reports ONE. A signal buried in sixty-six false positives is not a signal, and I read
 *    past it.
 *
 * ## THE MEASUREMENT THAT SETTLES IT
 *
 * Git is the normaliser. It stores LF and converts on checkout, so what git reports as CHANGED
 * after a repository-wide `prettier --write` is exactly what CI would object to — line-ending noise
 * cancels out because git never saw it. Run against the failing tree, this reported one file, and
 * so did CI.
 *
 *   npx tsx scripts/format-gate.ts          report, leaving the formatting applied
 *   npx tsx scripts/format-gate.ts --check  report and restore, changing nothing
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const PRETTIER_BIN = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

/** Files whose COMMITTED content Prettier would rewrite. Line-ending noise excluded by git. */
export function formatOffenders(): string[] {
  const dirtyBefore = new Set(git(["diff", "--name-only"]).split("\n").filter(Boolean));

  // Node runs Prettier's own entrypoint rather than `npx`, which is a .cmd shim on Windows and
  // cannot be exec'd directly — the first version of this script died on exactly that.
  execFileSync(process.execPath, [PRETTIER_BIN, "--write", ".", "--log-level", "error"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  // Anything already dirty before the run is the caller's own edit, not a formatting finding.
  return git(["diff", "--name-only"])
    .split("\n")
    .filter(Boolean)
    .filter((f) => !dirtyBefore.has(f));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const restore = process.argv.includes("--check");
  const before = git(["diff", "--name-only"]).split("\n").filter(Boolean);
  const offenders = formatOffenders();

  if (offenders.length === 0) {
    console.log("format gate: clean — nothing CI would object to");
  } else {
    console.log(`format gate: ${offenders.length} file(s) CI would reject\n`);
    for (const f of offenders) console.log(`  ${f}`);
    console.log(
      "\nThese are the files whose COMMITTED bytes differ. A local `format:check` on Windows also " +
        "lists every file with CRLF endings; those are not findings and are not shown here.",
    );
  }

  if (restore) {
    // Leave the tree exactly as found: only the files this run touched, and only those that were
    // clean beforehand.
    const toRestore = offenders.filter((f) => !before.includes(f));
    if (toRestore.length > 0) git(["checkout", "--", ...toRestore]);
    console.log(restore && toRestore.length > 0 ? "\n(restored; --check changes nothing)" : "");
  }
  process.exit(offenders.length === 0 ? 0 : 1);
}
