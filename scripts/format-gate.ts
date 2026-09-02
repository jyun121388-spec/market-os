/**
 * The formatting gate as CI sees it, for an EXACT revision, without touching the working tree.
 *
 * ## FIVE DEFECTS, EACH FOUND AFTER THE PREVIOUS REPAIR
 *
 * 1. A commit reached CI with one badly formatted file and failed run `33547628222` at
 *    `npm run format:check`. Units ran `prettier --write` over the files they touched, which is not
 *    the gate; and the real gate drowns locally, because this checkout has CRLF endings and the
 *    config wants LF, so it lists sixty-seven files while CI lists one.
 * 2. The first fix ran `prettier --write .` against the LIVE tree and asked git what changed. It
 *    snapshotted only the NAMES of already-dirty files, so a user's uncommitted work could be
 *    reformatted by the diagnostic and then excluded from both the report and the restore.
 * 3. The second read committed BYTES but kept `catch { continue; }` — fail-open, when the canonical
 *    gate exits non-zero on an evaluation failure.
 * 4. The third took its FILE SET from the live index and its IGNORE/CONFIG from the live checkout,
 *    so the answer was `f(committed bytes, live configuration)` rather than `f(rev)`.
 * 5. The fourth materialised the whole revision with `git archive` — which transforms content via
 *    `export-subst`, applies the checkout's line-ending conversion, and cannot even extract a
 *    symlink on Windows.
 *
 * ## WHAT IT DOES NOW, AND WHY IT IS SMALLER
 *
 * Measured rather than assumed: Prettier's `resolveConfig` and `getFileInfo` DO NOT REQUIRE THE
 * FILE TO EXIST. They walk directories looking for config and match ignore patterns against the
 * path string. So the whole revision never needed materialising — only its CONFIG-BEARING files.
 *
 *     enumeration   `git ls-tree -r` on the revision, WITH MODES
 *     content       `git show <rev>:<path>` — the blob, so nothing can transform it
 *     config        the revision's `.prettierrc*` / `.prettierignore` / `package.json`, written
 *                   into a scratch tree that contains nothing else
 *     formatter     the version the revision pins, compared with the one actually loaded
 *
 * The active index, worktree, staged and untracked state have no authority anywhere in that list,
 * and there is no write path to them: the scratch tree is the only thing written, and it holds a
 * handful of config files.
 *
 * Symlinks are identified by git mode `120000`, not by `lstat`. `git archive` writes a symlink as
 * an ordinary file on Windows, so the filesystem answers "not a link" and a guard that asked it
 * never fired — its mutant came back MISSED, which is how that was found.
 *
 *   npx tsx scripts/format-gate.ts [<rev>]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { check, getFileInfo, resolveConfig } from "prettier";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

/** A revision's committed content, or null when that tree has no such path. */
function committedFile(path: string, rev: string, cwd: string): string | null {
  try {
    return execFileSync("git", ["show", rev + ":" + path], {
      cwd,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** What the gate found. Every kind means the canonical gate would also refuse the tree. */
export type GateFinding =
  | { path: string; kind: "MISFORMATTED" }
  | { path: string; kind: "EVALUATION_ERROR"; detail: string }
  /** Prettier could not resolve options or ignore rules for the path. Unknown, never clean. */
  | { path: string; kind: "CONFIG_ERROR"; detail: string }
  /** The revision names the path and its content could not be read. */
  | { path: string; kind: "CONTENT_UNREADABLE" }
  /** The running Prettier is not, or cannot be shown to be, the one the revision pins. */
  | { path: string; kind: "TOOL_IDENTITY"; detail: string }
  /** A symlink: it could resolve outside the revision, so it is not judged. */
  | { path: string; kind: "SYMLINK_NOT_JUDGED" };

/** Basenames that carry Prettier authority. Anything matching is copied out of the revision. */
const CONFIG_BASENAMES = new Set([
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  ".prettierignore",
  ".editorconfig",
  "package.json",
]);

/**
 * Is the Prettier about to run the one this revision pins?
 *
 * The lock file is the authority when there is one, because it names an exact version. A manifest
 * RANGE cannot establish identity on its own — `^3.9.6` is satisfied by versions that format
 * differently — so it is accepted only when the running version matches the floor exactly.
 */
export function formatterIdentity(
  cwd: string,
  rev: string,
  running: string,
): { ok: true } | { ok: false; detail: string } {
  const lock = committedFile("package-lock.json", rev, cwd);
  if (lock !== null) {
    try {
      const parsed = JSON.parse(lock) as { packages?: Record<string, { version?: string }> };
      const pinned = parsed.packages?.["node_modules/prettier"]?.version;
      if (typeof pinned === "string" && pinned.length > 0) {
        return pinned === running
          ? { ok: true }
          : { ok: false, detail: `revision pins prettier ${pinned}, running ${running}` };
      }
    } catch (error) {
      return {
        ok: false,
        detail: `revision's package-lock.json is unreadable (${(error as Error).message.split("\n")[0]})`,
      };
    }
  }

  const manifest = committedFile("package.json", rev, cwd);
  if (manifest === null) {
    return { ok: false, detail: "revision has neither package-lock.json nor package.json" };
  }
  try {
    const parsed = JSON.parse(manifest) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const range = parsed.devDependencies?.prettier ?? parsed.dependencies?.prettier;
    if (typeof range !== "string") {
      return { ok: false, detail: "revision does not declare prettier at all" };
    }
    const floor = range.replace(/^[\^~>=<\s]+/, "");
    return floor === running
      ? { ok: true }
      : {
          ok: false,
          detail: `revision declares prettier ${range} with no lock; running ${running} cannot be shown to be it`,
        };
  } catch (error) {
    return {
      ok: false,
      detail: `revision's package.json is unreadable (${(error as Error).message.split("\n")[0]})`,
    };
  }
}

/** Everything about REV that would make `prettier --check .` exit non-zero. */
export async function committedFormatFindings(
  cwd: string = process.cwd(),
  rev = "HEAD",
): Promise<GateFinding[]> {
  // Before anything is judged: the judge itself has to belong to this revision.
  const running = (
    JSON.parse(
      readFileSync(createRequire(import.meta.url).resolve("prettier/package.json"), "utf8"),
    ) as { version: string }
  ).version;
  const identity = formatterIdentity(cwd, rev, running);
  if (!identity.ok) {
    return [{ path: "package-lock.json", kind: "TOOL_IDENTITY", detail: identity.detail }];
  }

  // Modes as well as names, because GIT is the authority on what a path IS.
  const entries = git(["ls-tree", "-r", "-z", rev], cwd)
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return { mode: meta.split(" ")[0], path };
    });

  const scratch = mkdtempSync(join(tmpdir(), "format-gate-rev-"));
  try {
    // Only the revision's config authority is written out, and nothing else is present to be
    // mistaken for it. Copying the live checkout's config here would be the defect in disguise.
    for (const { mode, path } of entries) {
      if (mode === "120000" || !CONFIG_BASENAMES.has(basename(path))) continue;
      const content = committedFile(path, rev, cwd);
      if (content === null) continue;
      const target = join(scratch, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }

    const ignorePath = join(scratch, ".prettierignore");
    const findings: GateFinding[] = [];

    for (const { mode, path } of entries) {
      if (mode === "120000") {
        // A symlink can point anywhere, including back into the active filesystem, which is the
        // one door left open in an otherwise sealed answer. Not formatting subject matter either.
        findings.push({ path, kind: "SYMLINK_NOT_JUDGED" });
        continue;
      }

      // The path need not exist: Prettier resolves config by walking directories and matches
      // ignore rules against the path string. Measured before being relied on.
      const asked = join(scratch, path);
      let options: Awaited<ReturnType<typeof resolveConfig>>;
      let ignored: boolean;
      let parser: string | null;
      try {
        const info = await getFileInfo(asked, { resolveConfig: true, ignorePath });
        ignored = info.ignored;
        parser = info.inferredParser;
        options = await resolveConfig(asked);
      } catch (error) {
        // Config or plugin authority that cannot be established is UNKNOWN — a revision whose
        // config names a plugin nothing here can load lands exactly here.
        findings.push({
          path,
          kind: "CONFIG_ERROR",
          detail: (error as Error).message.split("\n")[0],
        });
        continue;
      }

      if (ignored || !parser) continue;

      const source = committedFile(path, rev, cwd);
      if (source === null) {
        findings.push({ path, kind: "CONTENT_UNREADABLE" });
        continue;
      }

      let formatted: boolean;
      try {
        formatted = await check(source, { ...(options ?? {}), filepath: asked, parser });
      } catch (error) {
        // NOT `continue`. The canonical gate exits non-zero when it cannot evaluate a file, so
        // skipping one let this gate report clean about a tree CI rejects.
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
    console.log("  " + f.kind.padEnd(22) + f.path + detail);
  }
  console.log(
    "\nMISFORMATTED: run prettier --write on those paths. Every other kind means the revision " +
      "could not be judged, which the canonical gate also fails on — unknown, not clean.",
  );
  return 1;
}

// A named async main rather than top-level await: tsx transpiles this to CJS here, where top-level
// await is a syntax error.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  void main().then((code) => process.exit(code));
}
