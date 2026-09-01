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

import { existsSync, readFileSync } from "node:fs";
import type { StopSentinelInput } from "../src/server/evolution/scheduler";
import { unprocessedDecisions } from "../src/server/controlbus/state";
import type { ControlBusState } from "../src/server/controlbus/state";
import {
  lockIsStale,
  processAlive,
  readLock,
  RUNTIME_DIR,
  storePaths,
} from "../src/server/controlbus/store";

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
 * @param root      control-bus runtime directory. The watcher writes it relative to ITS cwd, so a
 *                  run from a different worktree legitimately finds nothing — which is reported as
 *                  unestablished rather than as an absence of decisions.
 * @param nowMs     injected so staleness is testable without waiting 135 seconds.
 * @param staleMs   heartbeat budget; see `HEARTBEAT_STALE_MS`.
 */
export function gatherStopEvidence(
  root: string = RUNTIME_DIR,
  nowMs: number = Date.now(),
  staleMs: number = HEARTBEAT_STALE_MS,
): StopEvidence {
  const paths = storePaths(root);
  const supplied: Partial<StopSentinelInput> = {};
  const unestablished: { field: string; because: string }[] = [];

  // --- decisions waiting to be consumed -------------------------------------------------------
  // The existence check is the whole defence. `loadState` answers `emptyState()` for a missing
  // file, and an empty state has an empty inbox, so the count would be a confident zero about a
  // file that was never there.
  if (!existsSync(paths.state)) {
    unestablished.push({
      field: "receivedDecisions",
      because: `${paths.state} does not exist, so the inbox has not been read — which is not the same as it being empty`,
    });
  } else {
    try {
      // No `Array.isArray` guard, deliberately. One was written here and then removed once no
      // control could tell it apart from the catch: any inbox that is not a list — an object, a
      // string, absent — makes `.filter` throw, which lands in the same place with a truer message.
      // A guard no mutant can kill is the `servesLocalBuild` shape again, and that one shipped.
      const state = JSON.parse(readFileSync(paths.state, "utf8")) as ControlBusState;
      supplied.receivedDecisions = unprocessedDecisions(state).length;
    } catch (error) {
      unestablished.push({
        field: "receivedDecisions",
        because: `${paths.state} could not be read as control-bus state (${(error as Error).message})`,
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
      const alive =
        lock !== null &&
        lock.pid > 0 &&
        processAlive(lock.pid) &&
        !lockIsStale(lock, staleMs, nowMs);
      supplied.controlBusWatcher = alive ? "ALIVE" : "STOPPED";
    }
  }

  unestablished.push(...NOT_ATTEMPTED);
  return { supplied, unestablished };
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
