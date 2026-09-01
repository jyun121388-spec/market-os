/**
 * The formatting gate as CI sees it — measured WITHOUT touching the working tree.
 *
 * ## WHY THIS EXISTS
 *
 * A commit reached CI with one badly formatted file and failed run `33547628222` at
 * `npm run format:check`, before lint, typecheck, tests or build could run. Two things combined:
 * every unit ran `prettier --write` over the files it touched, which is not the gate; and running
 * the real gate locally drowns, because this checkout has CRLF endings and the config wants LF, so
 * `format:check` lists sixty-seven files while CI lists one.
 *
 * ## AND WHY IT WAS REWRITTEN
 *
 * The first version measured by running `prettier --write .` against the LIVE working tree and then
 * asking git what changed. It worked, and it was unsafe in a way worth stating plainly: it
 * snapshotted only the NAMES of already-dirty files, so a user's uncommitted work could be
 * reformatted by the diagnostic and then excluded from both the report and the restore. A command
 * advertised as a check could silently rewrite foreign work — a verifier manufacturing its own
 * evidence by editing the thing it measures, which is the failure this file exists to catch,
 * committed while writing the catcher.
 *
 * Nothing is written now. The COMMITTED bytes are read out of git and handed to Prettier's API in
 * memory. Worktree, index and untracked files are never opened for writing on any path, including
 * the throwing one, because there is no writing path at all. That is a stronger guarantee than
 * restoring afterwards, and it is why "restore what we broke" was rejected as the repair.
 *
 * Reading committed bytes is also what makes the CRLF noise vanish: git stores LF and converts on
 * checkout, so the bytes measured here are exactly the bytes CI receives.
 *
 * ## AND WHY IT FAILS CLOSED
 *
 * The rewritten version still contained `catch { continue; }` around the Prettier call, with a
 * comment arguing that a file Prettier cannot parse is a different problem. That is fail-OPEN: the
 * canonical gate is `prettier --check .`, which exits non-zero on an evaluation failure, so a file
 * that throws here could make this diagnostic report clean about a tree CI rejects. "Not a
 * formatting offence" is not "verified clean", and an evaluator error is UNKNOWN — which this
 * repository's rules say is never success.
 *
 * So a throw is now a FINDING with its own kind, and any finding exits non-zero. Errors resolving
 * config or inferring a parser are deliberately left to propagate, which reaches the same
 * non-zero outcome by the shortest path.
 *
 *   npx tsx scripts/format-gate.ts
 */

import { execFileSync } from "node:child_process";
import { check, getFileInfo, resolveConfig } from "prettier";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Committed content of one path at `rev`, or null when that tree does not contain it. */
function committedBytes(path: string, rev: string, cwd: string): string | null {
  try {
    return execFileSync("git", ["show", rev + ":" + path], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** What the gate found about one committed file. Both kinds mean CI would reject the tree. */
export type GateFinding =
  | { path: string; kind: "MISFORMATTED" }
  | { path: string; kind: "EVALUATION_ERROR"; detail: string };

/**
 * Everything about the COMMITTED bytes that would make `prettier --check .` exit non-zero.
 *
 * `getFileInfo` is asked about the PATH, so `.prettierignore` and parser inference keep the
 * repository's own semantics; the content it judges comes from git rather than from disk.
 */
export async function committedFormatFindings(
  cwd: string = process.cwd(),
  rev = "HEAD",
): Promise<GateFinding[]> {
  const tracked = git(["ls-files", "-z"], cwd).split("\0").filter(Boolean);
  const findings: GateFinding[] = [];

  for (const path of tracked) {
    const info = await getFileInfo(path, { resolveConfig: true, ignorePath: ".prettierignore" });
    if (info.ignored || !info.inferredParser) continue;

    const source = committedBytes(path, rev, cwd);
    if (source === null) continue;

    // Not inside the try: a config or plugin resolution failure is not a property of this file's
    // content, and letting it propagate reaches a non-zero exit by the shortest honest route.
    const options = (await resolveConfig(path)) ?? {};

    let formatted: boolean;
    try {
      formatted = await check(source, { ...options, filepath: path });
    } catch (error) {
      // NOT `continue`. That was fail-open: canonical `prettier --check .` exits non-zero when it
      // cannot evaluate a file, so skipping one here let this gate report clean about a tree CI
      // rejects. An evaluator error is UNKNOWN, and unknown is not success.
      findings.push({
        path,
        kind: "EVALUATION_ERROR",
        detail: (error as Error).message.split("\n")[0],
      });
      continue;
    }
    if (!formatted) findings.push({ path, kind: "MISFORMATTED" });
  }

  return findings;
}

async function main(): Promise<number> {
  const findings = await committedFormatFindings();
  if (findings.length === 0) {
    console.log("format gate: clean — nothing CI would object to in the committed tree");
    return 0;
  }
  console.log(findings.length + " committed file(s) CI would reject:");
  for (const f of findings) {
    console.log(
      "  " + f.kind.padEnd(18) + f.path + (f.kind === "EVALUATION_ERROR" ? "  — " + f.detail : ""),
    );
  }
  console.log(
    "\nMISFORMATTED: run prettier --write on those paths. EVALUATION_ERROR: Prettier could not " +
      "read the committed bytes at all, which the canonical gate also fails on — it is unknown, " +
      "not clean. A local format:check on Windows additionally lists every file with CRLF " +
      "endings; those are checkout noise and are not shown here.",
  );
  return 1;
}

// A named async main rather than top-level await: tsx transpiles this to CJS here, where top-level
// await is a syntax error.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  void main().then((code) => process.exit(code));
}
