import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { committedFormatFindings } from "../scripts/format-gate";

/**
 * The gate must never write. Not to the worktree, not to the index, not to untracked files, and not
 * on the path where it throws.
 *
 * Its first version measured by running `prettier --write .` against the LIVE tree and asking git
 * what changed. That found the right answer and could silently reformat a user's uncommitted work:
 * it snapshotted only the NAMES of already-dirty files, so a pre-existing dirty file was rewritten
 * by the diagnostic and then excluded from both the report and the restore. A verifier editing the
 * thing it measures is the exact failure the gate exists to catch, committed while writing it.
 *
 * The repair is not "restore afterwards" — that still writes, and still loses on the throwing path.
 * It reads COMMITTED BYTES out of git and never opens anything for writing. These controls prove
 * that by hashing the whole repository before and after.
 */
describe("the format gate leaves the repository exactly as it found it", () => {
  const BADLY_FORMATTED = "export const a = {   b:1,\n     c:2 };\n";
  const WELL_FORMATTED = "export const d = { e: 1, f: 2 };\n";

  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

  /** Everything that could possibly have been mutated, in one comparable value. */
  const snapshot = (root: string) => {
    const files: Record<string, string> = {};
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (name.name === ".git") continue;
        const abs = join(dir, name.name);
        const rel = prefix ? `${prefix}/${name.name}` : name.name;
        if (name.isDirectory()) walk(abs, rel);
        else files[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex");
      }
    };
    walk(root, "");
    return {
      files,
      // Index entries with their blob hashes: catches a staged change being rewritten.
      index: git(["ls-files", "-s"], root),
      status: git(["status", "--porcelain"], root),
    };
  };

  const withRepo = async <T>(
    build: (root: string) => void,
    fn: (root: string) => Promise<T>,
  ): Promise<T> => {
    const root = mkdtempSync(join(tmpdir(), "format-gate-"));
    try {
      git(["init", "-q"], root);
      git(["config", "user.email", "t@example.invalid"], root);
      git(["config", "user.name", "t"], root);
      git(["config", "core.autocrlf", "false"], root);
      build(root);
      return await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const commitAll = (root: string) => {
    git(["add", "-A"], root);
    git(["commit", "-qm", "fixture"], root);
  };

  it("reports a committed offender and stays silent about a committed clean file", async () => {
    await withRepo(
      (root) => {
        writeFileSync(join(root, "bad.ts"), BADLY_FORMATTED, "utf8");
        writeFileSync(join(root, "good.ts"), WELL_FORMATTED, "utf8");
        commitAll(root);
      },
      async (root) => {
        const before = snapshot(root);
        expect(await committedFormatFindings(root)).toEqual([
          { path: "bad.ts", kind: "MISFORMATTED" },
        ]);
        // Neither file in the ACTIVE tree may have been touched to find that out.
        expect(snapshot(root)).toEqual(before);
      },
    );
  });

  it("does not rewrite a pre-existing dirty file Prettier would reformat", async () => {
    // THE control. This is the case the first version got wrong: dirty, and therefore excluded from
    // both the report and the restore, after being rewritten.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "clean.ts"), WELL_FORMATTED, "utf8");
        commitAll(root);
        writeFileSync(join(root, "clean.ts"), BADLY_FORMATTED, "utf8");
      },
      async (root) => {
        const before = snapshot(root);
        await committedFormatFindings(root);
        const after = snapshot(root);
        expect(after).toEqual(before);
        expect(readFileSync(join(root, "clean.ts"), "utf8")).toBe(BADLY_FORMATTED);
      },
    );
  });

  it("does not rewrite a dirty file whose COMMITTED bytes are also an offender", async () => {
    // The original bug's exact scenario, and the one every other preservation fixture missed:
    // those commit well-formatted content and dirty it afterwards, so a gate that writes has
    // nothing to write in them. Here the committed bytes ARE an offender, so a writing gate would
    // reach for this file — and the user's uncommitted version is what it would destroy.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "both.ts"), BADLY_FORMATTED, "utf8");
        commitAll(root);
        writeFileSync(join(root, "both.ts"), "export const z = {  q:9 };\n", "utf8");
      },
      async (root) => {
        const before = snapshot(root);
        expect(await committedFormatFindings(root)).toEqual([
          { path: "both.ts", kind: "MISFORMATTED" },
        ]);
        expect(snapshot(root)).toEqual(before);
        expect(readFileSync(join(root, "both.ts"), "utf8")).toBe("export const z = {  q:9 };\n");
      },
    );
  });

  it("does not rewrite a staged modification, in the index or the worktree", async () => {
    await withRepo(
      (root) => {
        writeFileSync(join(root, "staged.ts"), WELL_FORMATTED, "utf8");
        commitAll(root);
        writeFileSync(join(root, "staged.ts"), BADLY_FORMATTED, "utf8");
        git(["add", "staged.ts"], root);
      },
      async (root) => {
        const before = snapshot(root);
        await committedFormatFindings(root);
        expect(snapshot(root)).toEqual(before);
      },
    );
  });

  it("does not touch or delete an untracked file", async () => {
    await withRepo(
      (root) => {
        writeFileSync(join(root, "tracked.ts"), WELL_FORMATTED, "utf8");
        commitAll(root);
        writeFileSync(join(root, "scratch.ts"), BADLY_FORMATTED, "utf8");
      },
      async (root) => {
        const before = snapshot(root);
        await committedFormatFindings(root);
        expect(snapshot(root)).toEqual(before);
        expect(readFileSync(join(root, "scratch.ts"), "utf8")).toBe(BADLY_FORMATTED);
      },
    );
  });

  it("does not call a CRLF working copy an offender when the committed bytes are LF", async () => {
    // The whole reason the gate reads git rather than disk. A checkout artefact is not a finding,
    // and treating it as one is what made the real `format:check` unreadable here.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "lf.ts"), WELL_FORMATTED, "utf8");
        commitAll(root);
        writeFileSync(join(root, "lf.ts"), WELL_FORMATTED.replace(/\n/g, "\r\n"), "utf8");
      },
      async (root) => {
        expect(await committedFormatFindings(root)).toEqual([]);
      },
    );
  });

  it("leaves the repository identical when it throws", async () => {
    // The path a restore-afterwards design loses on: there is nothing to restore from, because the
    // throw happens before any restore would run.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "a.ts"), BADLY_FORMATTED, "utf8");
        commitAll(root);
      },
      async (root) => {
        const before = snapshot(root);
        await expect(committedFormatFindings(join(root, "no-such-directory"))).rejects.toThrow();
        expect(snapshot(root)).toEqual(before);
      },
    );
  });

  it("finds the offender it is supposed to find, so the controls are not vacuous", async () => {
    // Every assertion above is about what did NOT happen. Without this, a gate that returned an
    // empty list for every input would satisfy all of them.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "bad.ts"), BADLY_FORMATTED, "utf8");
        commitAll(root);
      },
      async (root) => {
        expect(await committedFormatFindings(root)).toEqual([
          { path: "bad.ts", kind: "MISFORMATTED" },
        ]);
      },
    );
  });
});

/**
 * AN EVALUATOR ERROR IS UNKNOWN, AND UNKNOWN IS NOT CLEAN.
 *
 * The repaired gate still carried `catch { continue; }` around the Prettier call, with a comment
 * arguing that a file Prettier cannot parse is a different problem. That is fail-OPEN. The
 * canonical gate is `prettier --check .`, which exits non-zero when it cannot evaluate a file, so
 * this diagnostic could report clean about a tree CI rejects — the exact "unknown recorded as
 * success" this repository's rules forbid, written into a verifier.
 */
describe("the format gate fails closed on anything it cannot evaluate", () => {
  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

  const withRepo = async <T>(
    build: (root: string) => void,
    fn: (root: string) => Promise<T>,
  ): Promise<T> => {
    const root = mkdtempSync(join(tmpdir(), "format-gate-fc-"));
    try {
      git(["init", "-q"], root);
      git(["config", "user.email", "t@example.invalid"], root);
      git(["config", "user.name", "t"], root);
      git(["config", "core.autocrlf", "false"], root);
      build(root);
      git(["add", "-A"], root);
      git(["commit", "-qm", "fixture"], root);
      return await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  /** What the canonical gate says about the same tree, so the two are compared and not assumed. */
  const canonicalExitCode = (root: string): number => {
    try {
      execFileSync(
        process.execPath,
        [createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs"), "--check", "."],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return 0;
    } catch {
      return 1;
    }
  };

  it("agrees with the canonical gate on a clean tree", async () => {
    await withRepo(
      (root) => writeFileSync(join(root, "ok.ts"), "export const a = 1;\n", "utf8"),
      async (root) => {
        expect(canonicalExitCode(root)).toBe(0);
        expect(await committedFormatFindings(root)).toEqual([]);
      },
    );
  });

  it("agrees with it on a merely misformatted file, and names the offender", async () => {
    await withRepo(
      (root) => writeFileSync(join(root, "ugly.ts"), "export const a = {   b:1 };\n", "utf8"),
      async (root) => {
        expect(canonicalExitCode(root)).toBe(1);
        expect(await committedFormatFindings(root)).toEqual([
          { path: "ugly.ts", kind: "MISFORMATTED" },
        ]);
      },
    );
  });

  it("reports an unparsable committed file instead of skipping it", async () => {
    // THE control. Canonical `prettier --check .` exits non-zero here; before the repair this gate
    // returned an empty list and exited 0 about the very same tree.
    await withRepo(
      (root) => writeFileSync(join(root, "broken.ts"), "export const = ;\n", "utf8"),
      async (root) => {
        expect(canonicalExitCode(root), "the fixture must actually break the canonical gate").toBe(
          1,
        );
        const findings = await committedFormatFindings(root);
        expect(findings).toHaveLength(1);
        expect(findings[0].path).toBe("broken.ts");
        expect(findings[0].kind).toBe("EVALUATION_ERROR");
      },
    );
  });

  it("reports unparsable JSON the same way", async () => {
    await withRepo(
      (root) => writeFileSync(join(root, "broken.json"), '{"a": 1,,}\n', "utf8"),
      async (root) => {
        expect(canonicalExitCode(root)).toBe(1);
        const findings = await committedFormatFindings(root);
        expect(findings.map((f) => f.kind)).toEqual(["EVALUATION_ERROR"]);
      },
    );
  });

  it("still separates the two kinds when a tree has both", async () => {
    // Without this, mapping every finding to one kind would satisfy the controls above.
    await withRepo(
      (root) => {
        writeFileSync(join(root, "a-ugly.ts"), "export const a = {   b:1 };\n", "utf8");
        writeFileSync(join(root, "b-broken.ts"), "export const = ;\n", "utf8");
      },
      async (root) => {
        const findings = await committedFormatFindings(root);
        expect(findings.map((f) => [f.path, f.kind])).toEqual([
          ["a-ugly.ts", "MISFORMATTED"],
          ["b-broken.ts", "EVALUATION_ERROR"],
        ]);
      },
    );
  });
});
