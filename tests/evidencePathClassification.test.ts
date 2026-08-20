import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isEvidenceOnlyPath } from "@/server/release/preflight";

/**
 * A file is evidence-only if nothing but the evidence reporter reads it. That is checkable,
 * approximately, so it is checked — and the approximation is stated rather than glossed.
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
 * So membership is checked rather than asserted — but the check is a HEURISTIC and this docstring
 * used to claim more. It said the file "verifies that nothing reads" an evidence path. It does
 * not. It detects a literal mention of the path or its basename alongside a read call, and a
 * review found the evasion in one line:
 *
 *     const p = join("docs", "REVIEW_" + "ATTESTATION.md"); readFileSync(p);
 *
 * That was reproduced and it passes. Dynamic enumeration of `docs/`, a path imported from another
 * module, and `fs.promises.readFile` evade it too.
 *
 * Recorded as IR-076 and kept as a heuristic on purpose: proving the negative needs call-graph
 * analysis, and the cost of that is a test nobody maintains. What the heuristic catches is the
 * realistic case — somebody adds a straightforward read — and what it cannot catch is now written
 * down instead of implied.
 *
 * The exposure that leaves is narrow but real, and the earlier wording overstated it as "the
 * allowlist fails closed regardless": a dynamically constructed reader would make an evidence
 * document behavioural while its edits stayed review-exempt. The allowlist fails closed against
 * unclassified PATHS, which is a different guarantee from failing closed against unnoticed
 * READERS, and only the first one is actually held.
 *
 * The wholesale-directory case is checked separately below — and only for a literal `docs`
 * inside a `readdirSync` call, which is the common spelling and not all of them.
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

/**
 * Every source file read once, at module load.
 *
 * The checks below used to `readFileSync` inside each `it`, so the whole tree was re-read once per
 * evidence path. That was tolerable at two paths and a smaller repository; at three paths and this
 * many long files it crossed the 5-second timeout and the file failed as four timeouts rather than
 * four assertions — which reads exactly like a broken guard and is not one.
 */
const SOURCES: readonly (readonly [string, string])[] = sourceFiles.map(
  (file) => [file, readFileSync(file, "utf8")] as const,
);

/**
 * The one file allowed to read an evidence path, and why that is not a loophole.
 *
 * "Read by nothing" was too strict and the guard proved it by going red on the evidence REPORTER —
 * the preflight script whose entire job is to read evidence. Taken literally the rule made the
 * two-SHA mechanism impossible: an attestation nothing may read cannot inform a verdict.
 *
 * The honest rule is that an evidence path may be read only by the designated reporter, and the
 * reporter is itself review-invalidating. `scripts/rc-preflight.ts` is not on the evidence-only
 * list, so any change to it makes the review stale — which means the reader is always reviewed
 * even though the data it reads is not. That is the property that matters, and the exemption is
 * checked below rather than trusted.
 */
const PERMITTED_READERS = ["scripts/rc-preflight.ts"];

/** Compare paths on forward slashes; this machine produces backslashes. */
const normalise = (path: string) => path.split("\\").join("/");

/** The paths the preflight will treat as not invalidating a review. */
const CLAIMED_EVIDENCE_ONLY = [
  "docs/REVIEW_ATTESTATION.json",
  "docs/REVIEW_ATTESTATION.md",
  "docs/escalation/PENDING_PR_UPDATE.md",
];

describe("evidence-only paths are read only by the evidence reporter", () => {
  it("has files to search, so a green result means something", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it.each(CLAIMED_EVIDENCE_ONLY)("nothing reads %s", (evidencePath) => {
    const basename = evidencePath.split("/").pop() ?? evidencePath;
    const readers = SOURCES.filter(([, source]) => {
      if (!source.includes(evidencePath) && !source.includes(basename)) return false;
      // NAMING a path is not reading it. `preflight.ts` has to name the allowlist and this file
      // has to name it back; neither opens anything. What matters is a file that both mentions
      // the path and performs a read, which is the shape that makes the contents behavioural.
      return /readFileSync|readFile\(|existsSync|createReadStream|import\(/.test(source);
    }).map(([file]) => file);
    const external = readers.filter(
      (file) =>
        !file.endsWith("evidencePathClassification.test.ts") &&
        !PERMITTED_READERS.includes(normalise(relative(process.cwd(), file))),
    );
    expect(
      external.map((f) => relative(process.cwd(), f)),
      `${evidencePath} is classified as evidence-only but is referenced in code. Either it ` +
        "affects behaviour — in which case it invalidates a review and must leave the list — or " +
        "the reference is incidental and should be removed.",
    ).toEqual([]);
  });

  it("catches a reader that enumerates the docs directory wholesale", () => {
    // The one evasion cheap enough to close. Reading every file under `docs/` picks up the
    // attestation without ever naming it, and unlike constructed paths it has a distinctive shape.
    const offenders = SOURCES.filter(([, source]) =>
      /readdirSync\(\s*[^)]*["'`][^"'`]*docs/.test(source),
    ).map(([file]) => file);
    expect(
      offenders.map((f) => relative(process.cwd(), f)),
      "a file enumerates docs/ and would read the attestation without naming it",
    ).toEqual([]);
  });

  it("keeps the permitted reader itself review-invalidating", () => {
    // The whole exemption rests on this. If `rc-preflight.ts` were ever classified evidence-only,
    // the reader and the data would both be outside review and the mechanism would be circular.
    for (const reader of PERMITTED_READERS) {
      expect(isEvidenceOnlyPath(reader)).toBe(false);
    }
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
