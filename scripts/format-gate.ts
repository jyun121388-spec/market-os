/**
 * The formatting gate as CI sees it, for an EXACT revision, without touching the working tree.
 *
 * ## THREE DEFECTS, EACH FOUND AFTER THE PREVIOUS REPAIR
 *
 * 1. A commit reached CI with one badly formatted file and failed run `33547628222` at
 *    `npm run format:check`. Every unit had run `prettier --write` over the files it touched, which
 *    is not the gate; and running the real gate locally drowns, because this checkout has CRLF
 *    endings and the config wants LF, so it lists sixty-seven files while CI lists one.
 *
 * 2. The first fix measured by running `prettier --write .` against the LIVE tree and asking git
 *    what changed. It snapshotted only the NAMES of already-dirty files, so a user's uncommitted
 *    work could be reformatted by the diagnostic and then excluded from both the report and the
 *    restore. A verifier editing what it measures is the failure this file exists to catch.
 *
 * 3. The second fix read committed BYTES but still carried `catch { continue; }`, which is
 *    fail-open: the canonical gate exits non-zero when it cannot evaluate a file, so a throw here
 *    let this one report clean about a tree CI rejects.
 *
 * ## AND THE FOURTH, WHICH IS WHY THIS READS A MATERIALISED TREE
 *
 * Reading committed bytes was not enough, because only the BYTES came from the revision. The file
 * set came from `git ls-files` (the live index), and the ignore rules and Prettier options came
 * from the live checkout. So the answer was `f(committed bytes, live configuration)` — not
 * `f(rev)` — and three ordinary situations made them disagree:
 *
 *     a staged deletion            removes a committed offender from `git ls-files`
 *     an uncommitted .prettierignore   hides a committed offender
 *     an uncommitted .prettierrc*      judges committed bytes by rules the revision never had
 *
 * Non-destructive and still wrong: the tree was never written to, and the answer was about
 * something other than the revision it named.
 *
 * So the revision is MATERIALISED into a temporary directory with `git archive`, and Prettier's own
 * resolution runs inside it. Enumeration, ignore rules, options and `package.json` all come from
 * the revision, because they are the only ones there. Nothing in the active checkout is read for
 * authority and nothing in it is written at all.
 *
 * What is materialised is cross-checked against `git ls-tree`: a path the revision contains but the
 * archive did not produce is reported, not skipped. `.gitattributes export-ignore` is the way that
 * happens, and a silently shorter file list is exactly how a gate stops meaning anything.
 *
 *   npx tsx scripts/format-gate.ts [<rev>]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, getFileInfo, resolveConfig } from "prettier";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

/** What the gate found. Every kind means the canonical gate would also refuse the tree. */
export type GateFinding =
  | { path: string; kind: "MISFORMATTED" }
  | { path: string; kind: "EVALUATION_ERROR"; detail: string }
  /** Prettier could not resolve options or ignore rules for the path. Unknown, never clean. */
  | { path: string; kind: "CONFIG_ERROR"; detail: string }
  /** The revision contains the path and the materialised tree does not. */
  | { path: string; kind: "MATERIALIZATION_INCOMPLETE" };

/**
 * Everything about REV that would make `prettier --check .` exit non-zero, judged entirely from
 * that revision.
 *
 * @param cwd a repository to read the revision out of. Never written to.
 */
export async function committedFormatFindings(
  cwd: string = process.cwd(),
  rev = "HEAD",
): Promise<GateFinding[]> {
  // `ls-tree` is the authority on what the revision contains; the archive is only how the bytes
  // and the config files get somewhere Prettier can resolve them.
  const expected = git(["ls-tree", "-r", "--name-only", "-z", rev], cwd)
    .split("\0")
    .filter(Boolean);

  const scratch = mkdtempSync(join(tmpdir(), "format-gate-rev-"));
  try {
    const tar = join(scratch, "rev.tar");
    const tree = join(scratch, "tree");
    // `-c core.autocrlf=false` is load-bearing, and it was measured rather than reasoned about.
    // `git archive` applies the same conversions a checkout would, so on this machine it produced
    // a CRLF tree and the gate reported 423 offenders where CI reports none — defect (1) again, in
    // a new place. The revision's bytes are its blobs; a checkout convention is not part of them.
    execFileSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", "-o", tar, rev], {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
    });
    mkdirSync(tree, { recursive: true });
    // Relative paths, with `cwd` doing the work. GNU tar reads `C:\...` as a REMOTE HOST spec and
    // answers "Cannot connect to C: resolve failed"; a path with no colon in it cannot be
    // misread that way, and this is more portable than depending on `--force-local`.
    execFileSync("tar", ["-x", "-f", "../rev.tar"], {
      cwd: tree,
      maxBuffer: 256 * 1024 * 1024,
    });

    const findings: GateFinding[] = [];

    for (const path of expected) {
      const materialised = join(tree, path);
      if (!existsSync(materialised)) {
        // Reported rather than skipped: a shorter file list is how a gate quietly stops meaning
        // anything, and `.gitattributes export-ignore` produces exactly that.
        findings.push({ path, kind: "MATERIALIZATION_INCOMPLETE" });
        continue;
      }

      let options: Awaited<ReturnType<typeof resolveConfig>>;
      let ignored: boolean;
      let parser: string | null;
      try {
        // Resolved from INSIDE the materialised tree, so `.prettierignore` and `.prettierrc*` are
        // the revision's own. Passing the live ones in would be the defect wearing a scratch
        // directory.
        const info = await getFileInfo(materialised, {
          resolveConfig: true,
          ignorePath: join(tree, ".prettierignore"),
        });
        ignored = info.ignored;
        parser = info.inferredParser;
        options = await resolveConfig(materialised);
      } catch (error) {
        // Config or plugin authority that cannot be established is UNKNOWN. A revision whose
        // config references a plugin this materialised tree has no `node_modules` for lands here,
        // and saying so is the honest answer — not assuming the live checkout's plugins apply.
        findings.push({
          path,
          kind: "CONFIG_ERROR",
          detail: (error as Error).message.split("\n")[0],
        });
        continue;
      }

      if (ignored || !parser) continue;

      // Read from the materialised tree, not `git show`. Same bytes, one source of truth, and it
      // is what a checkout of this revision yields — which is what CI formats. It also drops one
      // process per file: 484 spawns, most of the runtime.
      const source = readFileSync(materialised, "utf8");

      let formatted: boolean;
      try {
        formatted = await check(source, { ...(options ?? {}), filepath: materialised, parser });
      } catch (error) {
        // NOT `continue`. Canonical `prettier --check .` exits non-zero when it cannot evaluate a
        // file, so skipping one let this gate report clean about a tree CI rejects.
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
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const rev = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "HEAD";
  const findings = await committedFormatFindings(process.cwd(), rev);
  if (findings.length === 0) {
    console.log("format gate: " + rev + " is clean — nothing CI would object to");
    return 0;
  }
  console.log(findings.length + " file(s) CI would reject at " + rev + ":");
  for (const f of findings) {
    const detail = "detail" in f ? "  — " + f.detail : "";
    console.log("  " + f.kind.padEnd(26) + f.path + detail);
  }
  console.log(
    "\nMISFORMATTED: run prettier --write on those paths. EVALUATION_ERROR / CONFIG_ERROR / " +
      "MATERIALIZATION_INCOMPLETE: the revision could not be judged, which the canonical gate " +
      "also fails on — unknown, not clean.",
  );
  return 1;
}

// A named async main rather than top-level await: tsx transpiles this to CJS here, where top-level
// await is a syntax error.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  void main().then((code) => process.exit(code));
}
