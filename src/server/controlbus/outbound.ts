/**
 * The outbound half of the control bus: compose, post, READ BACK, then commit.
 *
 * ## WHY THIS EXISTS (IR-115)
 *
 * `controlBusStanding` requires a verified transmission before a protocol id counts as open. That
 * rule is right and it was unreachable: `appendOutbox` had no callers, nothing wrote a transmission
 * proof, and `ControlBusState.outbox` — the array every reader consults — was written by nobody. So
 * the predicate could be green in tests and structurally unable to say `OPEN` in real operation.
 * This module is the producer that makes it reachable, and it is deliberately the ONLY one.
 *
 * ## THE ORDER IS THE ARGUMENT
 *
 *     compose -> (adopt | post) -> read back -> verify the binding -> commit log -> commit state
 *
 * Nothing before the last two steps is durable, and a proof is written only after a read-back has
 * matched. `CLAUDE.md` states the invariant: `REMOTE_POST_NOT_CONFIRMED => CHATGPT_NOT_YET_NOTIFIED`.
 *
 * ## CRASH WINDOWS, EACH ANSWERED RATHER THAN HOPED ABOUT
 *
 *   after compose, before post        nothing durable. Replay composes again. Not open.
 *   after post, before read-back      nothing durable, and a comment now exists remotely. Replay
 *                                     calls `find` FIRST and ADOPTS it instead of posting twice.
 *                                     That is why adoption exists; without it the only crash-safe
 *                                     choices are a duplicate post or a lost proof.
 *   after read-back, before commit    same as above — the remote comment is found and adopted.
 *   after log, before state           the log is append-only and advisory; the state array is the
 *                                     authority, so a half-committed cycle reads as not-yet-open.
 *                                     The ordering matches `commitCycle`: never let the authority
 *                                     get ahead of the record.
 *   after commit                      open, and a further replay short-circuits on ALREADY_PROVEN.
 *
 * ## SERIALISATION
 *
 * The watcher owns `state.json`. Rather than invent a second lock protocol, this REFUSES while a
 * live watcher holds the existing lock. Fail closed and say so; do not write out of band and hope
 * the renames interleave kindly.
 */

import {
  bodyDigest,
  CONTROL_BUS_REPOSITORY,
  isTransmitted,
  type ControlBusState,
  type OutboxEntry,
} from "./state";
import {
  appendOutboxLog,
  lockIsStale,
  processAlive,
  readLock,
  writeState,
  type StorePaths,
} from "./store";

/** One remote comment, as the transport sees it. */
export interface RemoteCommentRef {
  commentId: number;
  body: string;
  repository: string;
  issueNumber: number;
}

/**
 * What this module needs from GitHub, and nothing more.
 *
 * An interface because every crash window and every mismatch has to be exercised offline. A test
 * that needs the network is a test that will be skipped.
 */
export interface OutboundTransport {
  /**
   * An existing comment on the canonical issue carrying this protocol id and this exact digest.
   *
   * The replay-safety primitive. `null` means "not there", and a transport that cannot tell must
   * throw rather than answer `null` — a false negative here posts a duplicate.
   */
  find(protocolId: string, digest: string): Promise<RemoteCommentRef | null>;
  post(body: string): Promise<{ commentId: number }>;
  /** `null` if the comment cannot be read back. Never a guess. */
  readBack(commentId: number): Promise<RemoteCommentRef | null>;
}

export interface OutboundDraft {
  protocolId: string;
  kind: OutboxEntry["kind"];
  body: string;
  composedAt: string;
}

export type OutboundOutcome =
  /** Posted, read back, verified, committed. */
  | { status: "COMMITTED"; entry: OutboxEntry }
  /** The comment was already on the issue — a replay after a crash. Adopted, not re-posted. */
  | { status: "ADOPTED_EXISTING"; entry: OutboxEntry }
  /** Durable proof already exists for this id and body. Nothing was sent. */
  | { status: "ALREADY_PROVEN"; entry: OutboxEntry }
  /** Composed and committed WITHOUT proof, or not committed at all. Never open either way. */
  | { status: "REFUSED"; reason: string; entry?: OutboxEntry };

export interface OutboundDeps {
  now: () => string;
  /** Injected so the staleness budget is not a fourth copy of 45s. */
  heartbeatStaleMs: number;
  nowMs: () => number;
  pid: number;
}

/**
 * @returns the outcome. A `REFUSED` result with an `entry` means the draft was durably recorded as
 *          COMPOSED — visible, queued, and by construction not open.
 */
export async function transmitAndCommit(
  paths: StorePaths,
  state: ControlBusState,
  draft: OutboundDraft,
  transport: OutboundTransport,
  deps: OutboundDeps,
): Promise<OutboundOutcome> {
  const expect = { repository: CONTROL_BUS_REPOSITORY, issueNumber: state.issueNumber };
  const digest = bodyDigest(draft.body);

  // --- serialisation ---------------------------------------------------------------------------
  const lock = readLock(paths);
  if (lock !== null && lock.pid !== deps.pid && processAlive(lock.pid)) {
    if (!lockIsStale(lock, deps.heartbeatStaleMs, deps.nowMs())) {
      return {
        status: "REFUSED",
        reason: `a live watcher holds the lock (pid ${lock.pid}); refusing to write state out of band`,
      };
    }
  }

  // --- idempotency: is this already proven? ------------------------------------------------------
  const existing = state.outbox.find(
    (e) =>
      e.protocolId === draft.protocolId &&
      e.kind === draft.kind &&
      bodyDigest(e.body) === digest &&
      isTransmitted(e, expect),
  );
  if (existing) return { status: "ALREADY_PROVEN", entry: existing };

  // --- adopt a comment a previous crashed attempt already posted --------------------------------
  let remote: RemoteCommentRef | null = null;
  let adopted = false;
  const found = await transport.find(draft.protocolId, digest);
  if (found) {
    remote = found;
    adopted = true;
  } else {
    const posted = await transport.post(draft.body);
    // A successful POST is NOT evidence. Only the read-back is.
    remote = await transport.readBack(posted.commentId);
  }

  const composed: OutboxEntry = {
    protocolId: draft.protocolId,
    kind: draft.kind,
    body: draft.body,
    composedAt: draft.composedAt,
  };

  const mismatch = describeMismatch(remote, expect, digest);
  if (mismatch !== null) {
    // Committed WITHOUT proof. The attempt is visible and the id stays closed, which is the point:
    // a failed read-back must leave a record, not a silence, and must not leave an opening.
    commit(paths, state, composed);
    return { status: "REFUSED", reason: mismatch, entry: composed };
  }

  const proven: OutboxEntry = {
    ...composed,
    transmission: {
      repository: remote!.repository,
      issueNumber: remote!.issueNumber,
      commentId: remote!.commentId,
      bodyDigest: digest,
      readBackAt: deps.now(),
    },
  };
  // Belt and braces: the proof must satisfy the same predicate every reader uses, before it is
  // written. A producer that can emit something its own consumer rejects is the split again.
  if (!isTransmitted(proven, expect)) {
    commit(paths, state, composed);
    return { status: "REFUSED", reason: "the assembled proof did not satisfy isTransmitted" };
  }

  commit(paths, state, proven);
  return { status: adopted ? "ADOPTED_EXISTING" : "COMMITTED", entry: proven };
}

/** Why this read-back is not proof, or `null` if it is. */
function describeMismatch(
  remote: RemoteCommentRef | null,
  expect: { repository: string; issueNumber: number },
  digest: string,
): string | null {
  if (remote === null) return "no read-back: the comment could not be fetched after posting";
  if (remote.repository.toLowerCase() !== expect.repository.toLowerCase()) {
    return `read back from ${remote.repository}, not ${expect.repository}`;
  }
  if (remote.issueNumber !== expect.issueNumber) {
    return `read back from issue #${remote.issueNumber}, not #${expect.issueNumber}`;
  }
  if (!Number.isInteger(remote.commentId) || remote.commentId <= 0) {
    return `read back with a malformed comment id (${remote.commentId})`;
  }
  if (bodyDigest(remote.body) !== digest) {
    return "the body read back does not match the body composed";
  }
  return null;
}

/**
 * Append-only log first, then the authority. The same ordering `commitCycle` enforces, for the same
 * reason: a crash between them costs a re-read, never a claim that outran its evidence.
 */
function commit(paths: StorePaths, state: ControlBusState, entry: OutboxEntry): void {
  appendOutboxLog(paths, entry);
  state.outbox.push(entry);
  writeState(paths, state);
}
