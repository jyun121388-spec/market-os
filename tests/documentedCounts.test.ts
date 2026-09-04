import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The numbers the state documents claim must be the numbers on disk.
 *
 * From the `EVIDENCE_FABRICATION` countermeasure, taken as tooling rather than as a resolution: the
 * cluster is about a confident claim accepted because nothing in its form distinguished it from a
 * verified one, and a stale figure in `PROJECT_STATE.md` is exactly that. It reads like evidence. It
 * was evidence, once.
 *
 * This class has been hit repeatedly in one session — the suite size, the E2E check count, the
 * runtime, the no-database figures, the local-commit count — each corrected by hand after someone
 * happened to notice. Correcting them one at a time is not a fix; the next figure goes stale the
 * next time the suite grows, and the document keeps its authoritative tone throughout.
 *
 * The file count is checked rather than the test count, deliberately. Test totals move with every
 * `it.each` row and would make this a maintenance tax that gets deleted; the file count moves only
 * when someone adds or removes a test file, which is precisely when the claim goes stale.
 */

const TEST_DIRS = ["tests", "tests/adapters", "tests/domain", "tests/integration"];

function countTestFiles(): number {
  let total = 0;
  for (const dir of TEST_DIRS) {
    const entries = readdirSync(join(process.cwd(), dir), { withFileTypes: true });
    total += entries.filter((e) => e.isFile() && e.name.endsWith(".test.ts")).length;
  }
  return total;
}

describe("PROJECT_STATE's headline numbers", () => {
  // Line endings normalised on read. `state.indexOf("TESTS\n")` returned -1 in a fresh
  // `git worktree` on Windows, where `core.autocrlf` delivers CRLF — the slice then silently
  // became the last character of the file, and the section assertions were checking a newline.
  // Passing in one checkout of a commit and failing in another checkout of the SAME commit is
  // EN-05, and a documentation guard is the wrong place to be sensitive to it.
  const state = readFileSync(join(process.cwd(), "docs/PROJECT_STATE.md"), "utf8").replace(
    /\r\n/g,
    "\n",
  );

  it("makes exactly one suite-size claim, so there is one thing to keep true", () => {
    const claims = state.match(/\d+ \/ \d+ PASS across \d+ files/g) ?? [];
    expect(claims.length, `found ${claims.length} suite-size claims: ${claims.join("; ")}`).toBe(1);
  });

  it("claims the number of test files that actually exist", () => {
    const match = /(\d+) \/ (\d+) PASS across (\d+) files/.exec(state);
    expect(match, "PROJECT_STATE no longer states a suite size").not.toBeNull();

    const [, passed, total, files] = match!;
    // A partial pass recorded as the headline would be a worse claim than a stale one.
    expect(passed, "the headline must not record a failing suite").toBe(total);
    // The FILE count is checked against reality below; the TEST count is not, and cannot be
    // without running the suite from inside it. So a stated total can drift by a few while this
    // stays green — it did, by one, when a test was added after the number was written down.
    // Recorded rather than papered over: what this guard proves is that the headline is
    // self-consistent and that its file count is true, not that its test count is.
    expect(Number(files), `PROJECT_STATE says ${files} test files; ${countTestFiles()} exist`).toBe(
      countTestFiles(),
    );
  });

  /**
   * A dated measurement is checkable and an undated one is folklore. This does not verify the
   * figures — nothing here can re-run an E2E suite — it verifies that a reader can tell how old
   * they are, which is the difference between a stale number and an unfalsifiable one.
   */
  it("dates the measurements a reader cannot re-run from this file", () => {
    const testsSection = state.slice(state.indexOf("TESTS\n"));
    expect(testsSection).toMatch(/\bE2E\b|npm run e2e/);
    expect(testsSection).toMatch(/20\d\d-\d\d-\d\d/);
  });
});

describe("the escalation channel's staged replies", () => {
  /**
   * A staged reply that has been posted, or a posted reply that was never staged, both leave the
   * record wrong in a way nobody notices — the channel is asynchronous and nothing else reconciles
   * it. This asserts only what is checkable from here: that the staging file names the gate that
   * makes staging necessary, so it cannot quietly become a place where replies are forgotten.
   */
  it("says why the reply is staged rather than posted", () => {
    const pending = readFileSync(
      join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"),
      "utf8",
    );
    expect(pending).toContain("HG-001");
    expect(pending).toContain("BLOCKED_MISSING_CREDENTIAL");
    // And carries the comment verbatim, not a summary of it.
    expect(pending).toContain("[CLAUDE_APPLIED][TEST-001]");
  });
});
