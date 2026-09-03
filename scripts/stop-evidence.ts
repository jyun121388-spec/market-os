/**
 * Evidence for `evaluateStopSentinel()`, gathered from the machine rather than left unknown.
 *
 * ## WHY THIS EXISTS
 *
 * `CLAUDE.md` names `evaluateStopSentinel()` as "the only normal completion sentinel". It is
 * carefully written, thoroughly tested, and — until this file — could not answer.
 *
 * The sentinel takes eight substantive inputs and treats every absent one as unsatisfied, because
 * unknown is not zero. That is right. But the ONLY non-test caller in the repository is
 * `scripts/next-work.ts`, and it supplies exactly one field: the queue. So eight of the nine
 * conditions have never once been evaluated against reality, and `MAY STOP` is `false` by
 * construction rather than by finding. A predicate that cannot vary is not a sentinel.
 *
 * This is the same shape as the last several defects on this branch: two halves that each work,
 * with nothing joining them. `unprocessedDecisions()` and `readLock()`/`processAlive()` already
 * exist, are already tested, and nothing ever asked them what the sentinel needs to know.
 *
 * ## THE RULE THIS FILE IS BUILT AROUND
 *
 * A gatherer that cannot establish a fact returns UNDEFINED. Never zero, never "ALIVE".
 *
 * That is not a stylistic preference. `loadState()` returns `emptyState()` when the state file is
 * absent, so the obvious implementation —
 *
 *     unprocessedDecisions(loadState(paths, 2)).length
 *
 * — answers `0` for "the inbox has never been read", which the sentinel would then record as an
 * ESTABLISHED zero. That single line would convert "we have no idea" into "there is nothing
 * waiting", which is the precise failure the sentinel was written to refuse. Every field here is
 * therefore guarded by its own existence check before the value is trusted.
 *
 * Supplying only a subset is safe by construction: `mayStop` requires EVERY condition satisfied, so
 * a field left undefined can only hold the answer at `false`. Adding a gatherer can never cause a
 * premature stop; it can only stop the sentinel from lying about why it will not.
 *
 *   npx tsx scripts/stop-evidence.ts
 */

import { existsSync } from "node:fs";
import type { StopSentinelInput } from "../src/server/evolution/scheduler";
import { lockIsStale, readLock, storePaths } from "../src/server/controlbus/store";
import { ownerLiveness } from "../src/server/controlbus/owner";
import { type GitOracle, localGit, triageInbox } from "./inbox-triage";

/**
 * How long a watcher may go without rewriting its lock before it is presumed dead.
 *
 * `store.ts` and `scripts/control-bus.ts` each already define this as 45s, privately, and a third
 * copy here would be one more thing to drift. It stays a parameter, and `stopEvidence.test.ts`
 * asserts this default still equals the literal in `scripts/control-bus.ts` — so the duplication is
 * at least self-checking rather than merely regrettable.
 */
export const HEARTBEAT_STALE_MS = 45_000;

export interface StopEvidence {
  /**
   * Established facts that are NOT sentinel inputs but change how one reads them.
   *
   * Added because two modules of mine, reading the same file, printed numbers a reader would take
   * as contradictory: this one said `11 received decisions` while `inbox-triage` said all 11 were
   * `NOT_ACTIONABLE`. Neither was wrong — they answered different questions — and nothing said so.
   * That is the same two-halves-and-no-joining-rule shape review has caught here five times, found
   * this time by joining two things already built rather than by being told.
   */
  notes: string[];
  /** Fields established from the machine. Spread straight into the sentinel. */
  supplied: Partial<StopSentinelInput>;
  /** Fields NOT established, and why. Printed, so the sentinel's refusal is legible. */
  unestablished: { field: string; because: string }[];
}

/**
 * Facts this file deliberately does not attempt, each with the reason.
 *
 * Listing them is the point. An unlisted gap reads as an oversight; a listed one is a decision, and
 * the operator can see exactly what would have to be built for the sentinel to be able to say yes.
 */
const NOT_ATTEMPTED: { field: string; because: string }[] = [
  {
    field: "unresolvedFailures",
    because:
      "requires actually running the suite, build and typecheck; a cached result is a claim about " +
      "a past tree, and this module must not turn one into a fact about this one",
  },
  {
    field: "advanceableBlockers",
    because:
      "whether a blocker can be advanced by code, tests, docs or analysis is a judgement about the " +
      "blocker, and nothing in the repository encodes it mechanically",
  },
  {
    field: "unhandledReviewFindings",
    because:
      "docs/REVIEW_DEBT.md records findings in prose; 'handled' is not a field, and inferring it " +
      "from wording is how a review finding gets quietly dropped",
  },
  {
    field: "discoveryCandidates",
    because:
      "requires a second-order discovery pass to have been RUN. An empty queue is a statement " +
      "about the queue, and this module cannot make it a statement about the work",
  },
  {
    field: "orphanedDocumentedWork",
    because:
      "comparing state documents against queue ids needs a naming contract neither side declares",
  },
  {
    field: "trueIdleEscalation",
    because: "whether the true-idle packet has left is a fact about a post, not about this machine",
  },
];

/**
 * @param root      control-bus runtime directory; defaults to the REPOSITORY's, via `storePaths()`.
 *                  This parameter used to default to the relative `RUNTIME_DIR`, and this comment
 *                  used to say that a run from a different worktree "legitimately finds nothing".
 *                  It did find nothing, and there was nothing legitimate about why: the name
 *                  resolved against `process.cwd()`, so the sentinel asked a directory that was
 *                  never the bus and reported the two fields unestablished forever. Reporting an
 *                  unknown honestly is not the same as being able to know.
 * @param nowMs     injected so staleness is testable without waiting 135 seconds.
 * @param staleMs   heartbeat budget; see `HEARTBEAT_STALE_MS`.
 */
export function gatherStopEvidence(
  root: string = storePaths().root,
  nowMs: number = Date.now(),
  staleMs: number = HEARTBEAT_STALE_MS,
  git: GitOracle = localGit(),
): StopEvidence {
  const paths = storePaths(root);
  const supplied: Partial<StopSentinelInput> = {};
  const unestablished: { field: string; because: string }[] = [];
  const notes: string[] = [];

  // --- decisions waiting to be consumed -------------------------------------------------------
  //
  // Counted through `triageInbox`, NOT by counting `RECEIVED_UNVALIDATED` rows, and the difference
  // is the point. An unjudged row means the watcher wrote something down and nobody judged it; it
  // does not mean a decision is waiting to be consumed. A row that has been triaged and come back
  // NOT_ACTIONABLE — closed id, unverifiable standing, foreign repository — has been looked at and
  // cannot be consumed. Leaving it unfiled is transport hygiene, not a reason the loop must run on.
  //
  // Both numbers are reported, because the earlier version supplied one of them and said nothing
  // about the other, and a reader comparing the two modules would have seen a contradiction.
  if (!existsSync(paths.state)) {
    unestablished.push({
      field: "receivedDecisions",
      because: `${paths.state} does not exist, so the inbox has not been read — which is not the same as it being empty`,
    });
  } else {
    try {
      const rows = triageInbox(root, git);
      if (rows === null) throw new Error("triage found no state to read");
      const actionable = rows.filter((r) => r.disposition !== "NOT_ACTIONABLE");
      supplied.receivedDecisions = actionable.length;
      notes.push(
        `${rows.length} unjudged inbox row(s), of which ${actionable.length} are actionable ` +
          `(${rows.length - actionable.length} NOT_ACTIONABLE). Only the actionable count is fed ` +
          "to the sentinel; the rest have been looked at and cannot be consumed.",
      );
    } catch (error) {
      unestablished.push({
        field: "receivedDecisions",
        because: `${paths.state} could not be triaged (${(error as Error).message})`,
      });
    }
  }

  // --- is the watcher alive to receive one ----------------------------------------------------
  if (!existsSync(paths.root)) {
    unestablished.push({
      field: "controlBusWatcher",
      because: `${paths.root} does not exist, so this cannot tell a stopped watcher from a wrong root`,
    });
  } else {
    let lock;
    try {
      lock = readLock(paths);
    } catch (error) {
      lock = undefined;
      unestablished.push({
        field: "controlBusWatcher",
        because: `${paths.lock} could not be read (${(error as Error).message})`,
      });
    }
    if (lock !== undefined) {
      // A lock file is positive evidence either way: present and beating means alive, present and
      // stale means stopped, absent from an existing runtime dir means nothing is holding it.
      // `lock.pid > 0` is not defensive noise. `processAlive` asks `process.kill(pid, 0)`, and
      // signal 0 to pid 0 addresses the CURRENT PROCESS GROUP rather than a process — it succeeds,
      // so a lock file holding pid 0 reads as a live watcher. A real watcher always writes
      // `process.pid`, so this is a malformed record rather than a defect in the store, and the
      // store is frozen product code. The gatherer refuses it here instead.
      //
      // IR-075 replaced `processAlive` here too, and not for tidiness: measured on this machine,
      // `process.kill(28877, 0)` reported ALIVE while `Get-Process -Id` and `tasklist` both
      // reported no such process. Two independent sources against one. A sentinel input built on
      // the losing probe reports a dead watcher as ALIVE, which is the exact false green this
      // module exists to refuse.
      //
      // The heartbeat still has to be current: this field answers "is a watcher POLLING", which is
      // a health question, not the ownership question the lock asks. A live process that stopped
      // heartbeating is not receiving decisions, and saying ALIVE about it would be a lie of a
      // different kind.
      const owning = lock !== null && lock.pid > 0 ? ownerLiveness(lock) : null;
      if (owning?.state === "UNKNOWN") {
        // This module's own rule, applied to itself: a fact it cannot establish comes back
        // UNDEFINED. An unjudgeable ownership record is not a stopped watcher — it is an unread
        // one — and answering STOPPED would let the sentinel treat "we cannot tell" as "nothing is
        // running", which is the shape every other field here is guarded against.
        unestablished.push({
          field: "controlBusWatcher",
          because: owning.because,
        });
      } else {
        const alive = owning?.state === "ALIVE" && !lockIsStale(lock!, staleMs, nowMs);
        supplied.controlBusWatcher = alive ? "ALIVE" : "STOPPED";
      }
    }
  }

  unestablished.push(...NOT_ATTEMPTED);
  return { supplied, unestablished, notes };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const evidence = gatherStopEvidence();
  console.log("== ESTABLISHED ==");
  const entries = Object.entries(evidence.supplied);
  if (entries.length === 0) console.log("  (nothing)");
  for (const [field, value] of entries) console.log(`  ${field} = ${String(value)}`);
  console.log("\n== NOT ESTABLISHED ==");
  for (const { field, because } of evidence.unestablished) {
    console.log(`  ${field}`);
    console.log(`      ${because}`);
  }
}
