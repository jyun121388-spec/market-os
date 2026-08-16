import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Catches UTF-8 corruption in tracked text files.
 *
 * This repository contains Korean throughout — legal-guardrail examples like "삼성전자 지금
 * 살까?", ECOS series names, DART report names — plus em dashes in most prose. On Windows
 * PowerShell 5.1, `Get-Content` reads as the system ANSI codepage unless told otherwise, so a
 * `Get-Content | Set-Content` round-trip silently mangles all of it.
 *
 * It has happened twice. Once it turned a test file's Korean strings into an invalid regular
 * expression, which at least failed loudly; once it replaced every em dash in PROJECT_STATE.md
 * with `??`, which failed silently and would have been committed unnoticed. Prose corruption is
 * the dangerous case: nothing type-checks documentation, and a mangled guardrail fixture would
 * quietly stop testing the phrase it names.
 *
 * A guard is worth more than a note in the handoff, since the note was already there both times.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/** U+FFFD, what a decoder emits when it gives up. Never legitimate in source. */
const REPLACEMENT_CHAR = "�";

/**
 * `??` immediately followed by a letter — the signature of an em dash or Hangul lost to an ANSI
 * round-trip. Deliberately not a bare `??`, which is the nullish-coalescing operator and appears
 * legitimately all over the TypeScript.
 */
const MANGLED_PUNCTUATION = /\?\?[A-Za-z가-힣]/;

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx|md|json|prisma|sql|mjs|css|yml|yaml)$/.test(f));
}

describe("source encoding guard", () => {
  const files = trackedTextFiles();

  it("finds tracked text files to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("contains no Unicode replacement characters", () => {
    const bad: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(path.join(REPO_ROOT, file), "utf8");
      } catch {
        continue; // deleted-but-still-tracked mid-rebase; not this test's problem
      }
      if (content.includes(REPLACEMENT_CHAR)) bad.push(file);
    }
    expect(bad, `files containing U+FFFD: ${bad.join(", ")}`).toEqual([]);
  });

  it("contains no ANSI-mangled em dashes or Hangul", () => {
    const bad: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(path.join(REPO_ROOT, file), "utf8");
      } catch {
        continue;
      }
      // This guard file necessarily contains the pattern it looks for.
      if (file.endsWith("tests/encoding-guard.test.ts")) continue;
      if (MANGLED_PUNCTUATION.test(content)) bad.push(file);
    }
    expect(bad, `files with mangled punctuation: ${bad.join(", ")}`).toEqual([]);
  });

  it("still contains the Korean guardrail fixtures it is meant to protect", () => {
    // A corruption that removed these entirely would otherwise pass both checks above while
    // quietly disabling the legal-guardrail coverage that names them.
    const askMarket = readFileSync(path.join(REPO_ROOT, "tests/askMarket.test.ts"), "utf8");
    expect(askMarket).toContain("삼성전자 지금 살까?");

    const e2e = readFileSync(path.join(REPO_ROOT, "scripts/e2e-full-walkthrough.ts"), "utf8");
    expect(e2e).toContain("삼성전자 지금 살까?");
  });
});
