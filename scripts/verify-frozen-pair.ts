/**
 * Verifies a frozen reviewed/attestation pair from the git objects it names.
 *
 * Separate from `rc-preflight.ts` on purpose. That script reports on HEAD, which is the right
 * question while HEAD is the candidate and the wrong one the moment follow-up work starts: the
 * release pair is frozen at two commits, the branch you are standing on is somewhere else, and a
 * dirty tool worktree is not evidence that the frozen candidate is dirty.
 *
 * So this reports TARGET_RELEASE_TREE state, and says plainly that it is not reporting
 * TOOL_WORKTREE state. Read-only; every fact comes from `git`.
 *
 *   npm run rc:verify-pair -- <reviewedCodeSha> <attestationSha>
 *
 * With no arguments it reads the pair from `docs/REVIEW_ATTESTATION.json` at HEAD, which is the
 * ordinary case while the candidate is still checked out.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAttestation } from "@/server/release/attestation";
import { verifyFrozenPair, type GitReader } from "@/server/release/frozenPair";
import { countPendingEscalations } from "@/server/release/pendingEscalations";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() }).trim();

const reader: GitReader = {
  exists(sha) {
    try {
      return git("cat-file", "-t", sha) === "commit";
    } catch {
      return false;
    }
  },
  isAncestor(ancestor, descendant) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
        cwd: process.cwd(),
      });
      return true;
    } catch {
      return false;
    }
  },
  changedPaths(from, to) {
    return git("diff", "--name-only", from, to)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  },
  commitCount(from, to) {
    return Number(git("rev-list", "--count", `${from}..${to}`));
  },
  fileAt(sha, path) {
    try {
      // `--` separates the revision from the path so a path that looks like a revision cannot be
      // read as one, and MSYS_NO_PATHCONV stops Git Bash rewriting `sha:path` into a Windows path.
      return execFileSync("git", ["show", `${sha}:${path}`], {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MSYS_NO_PATHCONV: "1" },
      });
    } catch {
      return null;
    }
  },
};

function pairFromArguments(): [string, string] | null {
  const [reviewed, attestation] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  return reviewed && attestation ? [reviewed, attestation] : null;
}

function pairFromHead(): [string, string] | null {
  const path = join(process.cwd(), "docs", "REVIEW_ATTESTATION.json");
  if (!existsSync(path)) return null;
  const parsed = parseAttestation(readFileSync(path, "utf8"));
  return parsed ? [parsed.reviewedCodeSha, git("rev-parse", "HEAD")] : null;
}

const pair = pairFromArguments() ?? pairFromHead();
if (!pair) {
  console.error(
    "No pair to verify. Pass two SHAs, or run from a checkout carrying docs/REVIEW_ATTESTATION.json.",
  );
  process.exit(2);
}

const [reviewedCodeSha, attestationSha] = pair;
const report = verifyFrozenPair(reviewedCodeSha, attestationSha, reader);

const short = (sha: string) => {
  try {
    return git("rev-parse", "--short", sha);
  } catch {
    return sha;
  }
};

console.log(
  `FROZEN PAIR — reviewed ${short(reviewedCodeSha)} → attestation ${short(attestationSha)}\n`,
);
for (const check of report.checks) {
  const mark = check.state === "PASS" ? "  ok " : check.state === "FAIL" ? " FAIL" : " ??? ";
  console.log(`${mark}  ${check.name.padEnd(46)} ${check.detail}`);
}

// The escalation queue, reported separately from pair validity and labelled with the tree it was
// read from. At the frozen commit the document predates the structured-record format, so the
// parser cannot read it — which is a fact about that document's age, not about the release.
const frozenQueueDoc = reader.fileAt(attestationSha, "docs/escalation/PENDING_COMMENTS.md");
const frozenPending = frozenQueueDoc === null ? 0 : countPendingEscalations(frozenQueueDoc);
const workingQueueDoc = existsSync(join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"))
  ? readFileSync(join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"), "utf8")
  : null;
const workingPending = workingQueueDoc === null ? 0 : countPendingEscalations(workingQueueDoc);

const describePending = (value: number | null) =>
  value === null ? "UNREADABLE (records declare no state this parser knows)" : String(value);

console.log(
  `
OUTBOUND_QUEUE at ${short(attestationSha)}   ${describePending(frozenPending)}` +
    `  — not part of pair validity; reported for completeness.`,
);
console.log(
  `OUTBOUND_QUEUE in this checkout   ${describePending(workingPending)}` +
    `  — the document as it stands on this branch.`,
);

// Reported separately and labelled, so neither can be mistaken for the other.
const toolWorktreeClean = git("status", "--porcelain").length === 0;
console.log(
  `\nTARGET_RELEASE_TREE  ${report.valid ? "VALID" : "NOT VALID"}` +
    `  — decided from git objects at the two SHAs above.`,
);
console.log(
  `TOOL_WORKTREE_CLEAN  ${toolWorktreeClean}` +
    `  — the checkout this script ran from. Not evidence about the frozen pair either way.`,
);

process.exit(report.valid ? 0 : 1);
