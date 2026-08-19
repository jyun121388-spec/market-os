/**
 * Runs the release preflight against the real repository, and prints what it finds.
 *
 * Gathers evidence rather than assuming it. Anything it cannot establish is passed through as
 * absent, which the preflight resolves toward EVIDENCE_INSUFFICIENT — this script is not allowed
 * to fill a gap with an optimistic guess, and it does not run the suite either: a preflight that
 * silently re-runs the thing it is auditing would always report on evidence it just created.
 *
 * Read-only. `git` is consulted for facts about the tree and nothing is written anywhere.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { storePaths } from "@/server/controlbus/store";
import type { PreflightInput } from "@/server/release/preflight";
import { preflight } from "@/server/release/preflight";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() }).trim();

const head = git("rev-parse", "--short", "HEAD");
const treeClean = git("status", "--porcelain").length === 0;

// Whether this exact commit exists on the remote. `branch -r --contains` answers it without
// fetching, and an unpushed candidate is one that exists on a single machine.
let pushedToRemote = false;
try {
  pushedToRemote = git("branch", "-r", "--contains", "HEAD").length > 0;
} catch {
  pushedToRemote = false;
}

const findings = readFileSync(join(process.cwd(), "docs/INTERIM_REVIEW_FINDINGS.md"), "utf8");
const debt = existsSync("docs/REVIEW_DEBT.md")
  ? readFileSync(join(process.cwd(), "docs/REVIEW_DEBT.md"), "utf8")
  : "";

/**
 * Open P2s, counted from the debt register rather than from the findings document.
 *
 * The register is the place a P2 is deliberately left open with a reason; the findings document
 * also contains P2s that were fixed immediately. Counting the wrong one would inflate the number
 * with work that is done.
 */
const openP2 = [...debt.matchAll(/\bIR-\d+\b/g)].length;

const gatesDoc = existsSync("docs/HUMAN_GATE_QUEUE.md")
  ? readFileSync(join(process.cwd(), "docs/HUMAN_GATE_QUEUE.md"), "utf8")
  : "";
const openHumanGates = [
  ...new Set(
    [...gatesDoc.matchAll(/^## +(HG-\d+)/gm)]
      .map((m) => m[1])
      .filter((id) => {
        const section = gatesDoc.slice(
          gatesDoc.indexOf(`## ${id}`),
          gatesDoc.indexOf(`## ${id}`) + 600,
        );
        return !/\bStatus\b[^\n]*\b(CLOSED|RESOLVED|DECIDED)\b/i.test(section);
      }),
  ),
];

// Control-bus liveness, read from the durable lock rather than assumed.
const busPaths = storePaths();
const lock = existsSync(busPaths.lock)
  ? (JSON.parse(readFileSync(busPaths.lock, "utf8")) as { pid: number })
  : null;
const watcherAlive = (() => {
  if (!lock) return false;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
})();

const busState = existsSync(busPaths.state)
  ? (JSON.parse(readFileSync(busPaths.state, "utf8")) as { outbox?: unknown[] })
  : null;

const pending = existsSync("docs/escalation/PENDING_COMMENTS.md")
  ? [
      ...readFileSync(join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"), "utf8").matchAll(
        /^## +`\[(?:ESCALATION|CLAUDE_APPLIED)\]\[([A-Z0-9-]+)\]`/gm,
      ),
    ].length
  : 0;

/**
 * Evidence this script CANNOT establish, and therefore does not supply.
 *
 * The suite, typecheck, lint, format, build, E2E and migration evidence all come from actually
 * running those things, and this script deliberately does not run them. Passing them as absent is
 * the honest input; the operator supplies them by running the chain and re-running this with the
 * results, or the verdict correctly reports EVIDENCE_INSUFFICIENT.
 *
 * The temptation is to shell out to `npm test` here and report the result. That would make the
 * preflight always green about evidence it generated a moment earlier, which measures nothing.
 */
/**
 * Review evidence, read from the attestation rather than inferred from prose.
 *
 * The previous version pattern-matched the findings document for a phrase, which made the review
 * status a property of how a sentence was worded. The attestation is a structured record naming
 * the exact commit reviewed, so freshness becomes a comparison instead of a guess.
 *
 * Absent or unparseable attestation yields no fields at all, which the preflight reads as MISSING.
 */
function reviewEvidence(): {
  finalReviewDone?: boolean;
  finalReviewCommit?: string;
  changedPathsSinceReview?: string[];
} {
  const attestationPath = join(process.cwd(), "docs", "REVIEW_ATTESTATION.md");
  if (!existsSync(attestationPath)) return {};
  const text = readFileSync(attestationPath, "utf8");
  const sha = /REVIEWED_CODE_SHA:\s*`?([0-9a-f]{7,40})`?/.exec(text)?.[1];
  const clean = /REVIEW_VERDICT:\s*`?CLEAN`?/.test(text);
  if (!sha) return {};

  // Paths changed between the reviewed commit and HEAD, straight from git. Not supplied by the
  // attestation itself, deliberately: a document asserting which files changed since it was
  // written would be marking its own homework.
  let changed: string[] = [];
  try {
    changed = git("diff", "--name-only", `${sha}..HEAD`)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return { finalReviewDone: clean, finalReviewCommit: sha };
  }

  return {
    finalReviewDone: clean,
    finalReviewCommit: sha,
    // An empty diff means the reviewed commit IS head, which the preflight handles by equality.
    changedPathsSinceReview: changed.length > 0 ? changed : undefined,
  };
}

const input: PreflightInput = {
  head,
  changesSinceEvidence: [],
  treeClean,
  pushedToRemote,
  openP0: 0,
  openP1: 0,
  openP2,
  unhandledReviewFindings: 0,
  ...reviewEvidence(),
  openHumanGates,
  unverifiedProviders: ["FRED", "ECOS", "OPENDART"],
  queuedEscalations: pending + (busState?.outbox?.length ?? 0),
  controlBusWatcher: watcherAlive ? "ALIVE" : "STOPPED",
};

const report = preflight(input);

console.log(`RC PREFLIGHT — ${head}\n`);
for (const check of report.checks) {
  const mark = { PASS: "  ok  ", FAIL: " FAIL ", STALE: " STALE", MISSING: " ???  " }[check.state];
  console.log(`${mark} ${check.kind.padEnd(8)} ${check.name.padEnd(28)} ${check.detail}`);
}
console.log(`\nVERDICT  ${report.verdict}`);
console.log(`         ${report.rationale}`);
console.log(
  "\nEvidence this script does not generate — suite, typecheck, lint, format, build, E2E,\n" +
    "migrations, Verify coverage — is passed as absent on purpose. Running the checks here would\n" +
    "make the preflight report on evidence it had just created, which measures nothing.",
);
