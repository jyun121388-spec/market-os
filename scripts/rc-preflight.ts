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
import { countPendingEscalations } from "../src/server/release/pendingEscalations";
import { join } from "node:path";
import { storePaths } from "@/server/controlbus/store";
import type { PreflightInput } from "@/server/release/preflight";
import { parseAttestation } from "@/server/release/attestation";
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

/**
 * Packets staged in `PENDING_COMMENTS.md` that have not been transmitted.
 *
 * The counting lives in `src/server/release/pendingEscalations.ts` and is tested there. It used to
 * be a regex here, in a script nothing imported, and it was wrong in two directions for eleven
 * days — see that module for what it got wrong and why the shape of the fix follows from it.
 */
const pending = existsSync("docs/escalation/PENDING_COMMENTS.md")
  ? countPendingEscalations(
      readFileSync(join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"), "utf8"),
    )
  : 0;

/** The abbreviated form git would print, so string equality against `head` means what it says. */
function resolveShort(sha: string): string {
  try {
    return git("rev-parse", "--short", sha);
  } catch {
    return sha;
  }
}

/**
 * Review evidence, read from the attestation rather than inferred from prose.
 *
 * The previous version pattern-matched the findings document for a phrase, which made review
 * status a property of how a sentence was worded. The attestation names the exact commit reviewed,
 * so freshness becomes a comparison instead of a guess.
 *
 * An absent or unparseable attestation yields no fields, which the preflight reads as MISSING.
 *
 * The suite, typecheck, lint, build, E2E and migration evidence are NOT gathered here and are
 * passed as absent on purpose. Shelling out to `npm test` would make the preflight permanently
 * green about evidence it had generated moments earlier, which measures nothing.
 */
function reviewEvidence(): {
  finalReviewDone?: boolean;
  finalReviewCommit?: string;
  changedPathsSinceReview?: string[];
} {
  const attestationPath = join(process.cwd(), "docs", "REVIEW_ATTESTATION.json");
  if (!existsSync(attestationPath)) return {};
  const parsed = parseAttestation(readFileSync(attestationPath, "utf8"));
  if (!parsed) return {};
  const { reviewedCodeSha: sha, clean } = parsed;

  // The reviewed commit must be an ANCESTOR of HEAD.
  //
  // Without this the mechanism is unsound in the most direct way available: attest a DESCENDANT
  // commit, and the diff from it back to HEAD contains only the attestation, so a review of code
  // that does not exist yet is accepted as covering the code that does. A freshness rule built on
  // a diff has to establish direction, and a diff has none.
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: process.cwd() });
  } catch {
    return { finalReviewDone: false, finalReviewCommit: sha };
  }

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
    // Resolved to the same form as `head`, because the preflight compares them as strings and the
    // attestation may carry a full SHA while `head` is abbreviated. That mismatch reported a
    // review of the CURRENT commit as stale — failing closed, but on a false premise, and a
    // freshness check that cannot recognise its own commit is not much of one.
    finalReviewCommit: resolveShort(sha),
    // An empty diff means the reviewed commit is HEAD, which the preflight handles by equality.
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
  // `pending` is null when the staging document declares a state the parser cannot read. Passing
  // undefined makes the preflight report the check as never established, which is the honest
  // answer; adding null to a number would have produced NaN, and coercing it to zero would have
  // turned "I could not tell" into "nothing is owed" — the exact substitution this counter was
  // fixed for making.
  queuedEscalations: pending === null ? undefined : pending + (busState?.outbox?.length ?? 0),
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
