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
import { ownerLiveness, type StartProbe } from "./owner";
import { mayPostPublicly } from "../escalation/screen";
import {
  appendOutboxLog,
  loadState,
  readLock,
  withCanonicalWriteAuthority,
  writeState,
  type LockRecord,
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
  /**
   * THIS run's ownership identity, `(pid, nonce)`.
   *
   * A pid on its own was the previous identity and it is not one: pids are recycled, and the store
   * already treats the nonce as the sufficient condition — a same-pid different-nonce record is a
   * DIFFERENT lease, not us.
   */
  claim: LockRecord;
  /** Test seam, threaded straight through to the write authority. See . */
  afterRightTaken?: () => void;
  /** Ownership probe, injectable for the same reason the store injects it. */
  startProbe?: StartProbe;
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

  // --- screening, BEFORE the transport is touched at all ----------------------------------------
  //
  // `CLAUDE.md` says everything outbound passes the screen first, and issue #2 is publicly
  // readable. That guarantee lived in `post-outbound.ts` and not here, so it held for one CALLER
  // rather than for the OPERATION — the same one-sided invariant this branch keeps finding, in a
  // module written two units ago. A second caller, or a refactor of the first, would have posted
  // unscreened and nothing would have noticed.
  //
  // It runs before `find` as well as before `post`: an unscreened body should not reach the
  // transport at all, not even to be compared against comments already on the issue.
  const screen = mayPostPublicly(draft.body);
  if (!screen.allowed) {
    const where = screen.findings.map((f) => `${f.category} at line ${f.line}`).join(", ");
    return { status: "REFUSED", reason: `the body did not pass the public screen (${where})` };
  }

  // --- pre-flight, and it is ONLY that -------------------------------------------------------
  //
  // A cheap fast-fail so an obviously-live watcher costs no network round trip. It is deliberately
  // not the guarantee: a check here and a write after an `await` is a snapshot, and a snapshot is
  // not a serialisation primitive. The guarantee is taken at commit time, under
  // `withCanonicalWriteAuthority`, where the state is also RELOADED.
  //
  // It asks the SAME ownership question as everything else. It used `processAlive(pid) &&
  // !lockIsStale(...)`, which could not produce an unsafe outcome here — the commit-time authority
  // still refuses — but it was a THIRD definition of ownership in a codebase that had just been
  // reduced to one, and the IR-075 verification found the second by noticing exactly that kind of
  // split. A fast-fail that disagrees with the guarantee is a future defect with a green suite over
  // it.
  const lock = readLock(paths);
  const isOurs = lock !== null && lock.pid === deps.claim.pid && lock.nonce === deps.claim.nonce;
  const holder = lock !== null && !isOurs ? ownerLiveness(lock, deps.startProbe) : null;
  if (lock !== null && holder && holder.state !== "GONE") {
    return {
      status: "REFUSED",
      reason:
        `the lock (pid ${lock.pid}) is ${holder.state}: ${holder.because}; ` +
        "refusing before any remote call",
    };
  }

  // --- idempotency: is this already proven? ------------------------------------------------------
  //
  // Read from DISK, not from the state the caller handed in. After the reload-at-commit repair the
  // caller's object is a photograph that never receives the entry, so checking it made a second
  // call post again — found by the idempotency control, which is what it is for.
  const onDisk = loadState(paths, state.issueNumber);
  const existing = onDisk.outbox.find(
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
    // Recorded WITHOUT proof. The attempt is visible and the id stays closed, which is the point:
    // a failed read-back must leave a record, not a silence, and must not leave an opening. If
    // ownership is gone the record is skipped too — a refusal never writes.
    const written = commitUnderAuthority(paths, state, composed, deps, expect);
    return {
      status: "REFUSED",
      reason: written.committed ? mismatch : `${mismatch}; and ${written.reason}`,
      ...(written.committed ? { entry: composed } : {}),
    };
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
    commitUnderAuthority(paths, state, composed, deps, expect);
    return { status: "REFUSED", reason: "the assembled proof did not satisfy isTransmitted" };
  }

  const written = commitUnderAuthority(paths, state, proven, deps, expect);
  if (written.committed && written.reconciled !== null) {
    // Somebody landed the identical proof while we were away. Not a second entry, and not a
    // pretence that we wrote this one.
    return { status: "ALREADY_PROVEN", entry: written.reconciled };
  }
  if (!written.committed) {
    // The comment exists remotely and this machine may not record it. Fail closed: not open, and
    // NOT re-posted on the next attempt either — `find` will adopt the same comment by digest.
    return { status: "REFUSED", reason: written.reason };
  }
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
 * Append-only log first, then the authority — under proven exclusive ownership, over RELOADED
 * state.
 *
 * Both halves matter and review found both missing. The ordering is `commitCycle`'s, for the same
 * reason: a crash between them costs a re-read, never a claim that outran its evidence. The reload
 * is the other half: the state this function was handed was captured BEFORE a network round trip,
 * and writing it back would regress whatever the watcher advanced meanwhile. Nothing outside the
 * authority may touch `state.json`.
 */
function commitUnderAuthority(
  paths: StorePaths,
  captured: ControlBusState,
  entry: OutboxEntry,
  deps: OutboundDeps,
  expect: { repository: string; issueNumber: number },
):
  | { committed: true; state: ControlBusState; reconciled: OutboxEntry | null }
  | { committed: false; reason: string } {
  const result = withCanonicalWriteAuthority(
    paths,
    deps.claim,
    deps.heartbeatStaleMs,
    deps.nowMs(),
    () => {
      // RELOAD. `captured` is a photograph of the state before the await; `fresh` is what is
      // actually on disk now, cursor and inbox included.
      const fresh = loadState(paths, captured.issueNumber);

      // Reconcile rather than duplicate: another writer, or an earlier attempt of ours, may have
      // landed the very same proof while we were away.
      const already = fresh.outbox.find(
        (e) =>
          e.protocolId === entry.protocolId &&
          e.kind === entry.kind &&
          bodyDigest(e.body) === bodyDigest(entry.body) &&
          isTransmitted(e, expect),
      );
      if (already) return { fresh, reconciled: already };

      appendOutboxLog(paths, entry);
      fresh.outbox.push(entry);
      writeState(paths, fresh);
      return { fresh, reconciled: null };
    },
    deps.afterRightTaken,
  );

  return result.held
    ? { committed: true, state: result.value.fresh, reconciled: result.value.reconciled }
    : { committed: false, reason: result.reason };
}
