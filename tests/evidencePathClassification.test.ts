import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isEvidenceOnlyPath } from "@/server/release/preflight";

/**
 * A file is evidence-only if nothing reads it. That is checkable, so it is checked.
 *
 * The review-freshness rule needs a set of paths whose contents a code review is not evidence
 * about — otherwise recording a review creates a commit, that commit moves HEAD, and the review is
 * stale the instant it is written down. The release could never close no matter how clean the code.
 *
 * The first version of that set was the prefix `^docs/`, which was wrong by a wide margin and
 * would have quietly widened the hole it was meant to close. `PROJECT_STATE.md` is read by a test.
 * `HUMAN_GATE_QUEUE.md` supplies the preflight its list of open gates. `SESSION_HANDOFF.md` is
 * parsed by the orphan check. `CLAUDE.md` is operating policy. Editing any of them changes what
 * the system does, and a review is precisely evidence about what the system does.
 *
 * So membership is not a judgement recorded once in a comment. It is a property this file
 * verifies: an evidence-only path may not be referenced by any source or test file. If someone
 * later teaches the code to read the attestation, this goes red and the classification has to be
 * argued for again rather than inherited.
 */

const ROOTS = ["src", "tests", "scripts", "prisma"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const sourceFiles = ROOTS.filter((r) => {
  try {
    return statSync(join(process.cwd(), r)).isDirectory();
  } catch {
    return false;
  }
}).flatMap((r) => walk(join(process.cwd(), r)));

/** The paths the preflight will treat as not invalidating a review. */
const CLAIMED_EVIDENCE_ONLY = [
  "docs/REVIEW_ATTESTATION.md",
  "docs/escalation/PENDING_PR_UPDATE.md",
];

describe("evidence-only paths are read by nothing", () => {
  it("has files to search, so a green result means something", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it.each(CLAIMED_EVIDENCE_ONLY)("nothing reads %s", (evidencePath) => {
    const basename = evidencePath.split("/").pop() ?? evidencePath;
    const readers = sourceFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!source.includes(evidencePath) && !source.includes(basename)) return false;
      // NAMING a path is not reading it. `preflight.ts` has to name the allowlist and this file
      // has to name it back; neither opens anything. What matters is a file that both mentions
      // the path and performs a read, which is the shape that makes the contents behavioural.
      return /readFileSync|readFile\(|existsSync|createReadStream|import\(/.test(source);
    });
    const external = readers.filter((file) => !file.endsWith("evidencePathClassification.test.ts"));
    expect(
      external.map((f) => relative(process.cwd(), f)),
      `${evidencePath} is classified as evidence-only but is referenced in code. Either it ` +
        "affects behaviour — in which case it invalidates a review and must leave the list — or " +
        "the reference is incidental and should be removed.",
    ).toEqual([]);
  });

  it("agrees with the preflight's own classification", () => {
    for (const path of CLAIMED_EVIDENCE_ONLY) expect(isEvidenceOnlyPath(path)).toBe(true);
  });

  it.each([
    "docs/PROJECT_STATE.md",
    "docs/SESSION_HANDOFF.md",
    "docs/HUMAN_GATE_QUEUE.md",
    "docs/INTERIM_REVIEW_FINDINGS.md",
    "CLAUDE.md",
    "src/server/controlbus/store.ts",
    "package.json",
    "prisma/schema.prisma",
  ])("treats %s as review-invalidating", (path) => {
    // The negative control, and the more important half. Each of these is read by something or is
    // policy; a review of the code says nothing about a tree in which they have changed.
    expect(isEvidenceOnlyPath(path)).toBe(false);
  });

  it("treats an unclassified path as invalidating", () => {
    // The default that matters. A path nobody has thought about is not thereby harmless, and this
    // is the field somebody would widen to make a release close.
    expect(isEvidenceOnlyPath("docs/something-new.md")).toBe(false);
    expect(isEvidenceOnlyPath("")).toBe(false);
  });

  it("normalises Windows separators before deciding", () => {
    // `git diff --name-only` gives forward slashes, but a caller assembling paths with `join` on
    // this machine would not. A separator mismatch here silently classifies everything as
    // invalidating, which fails safe — and would make the attestation permanently unusable.
    expect(isEvidenceOnlyPath("docs\\REVIEW_ATTESTATION.md")).toBe(true);
  });
});
