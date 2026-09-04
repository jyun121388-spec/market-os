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
 * ## THE ORDER IS THE ARGUMENT (IR-125 moved the authority in front of the network)
 *
 *     compose -> BEGIN under authority (durable intent) -> (adopt | post) -> read back
 *             -> verify the binding -> COMMIT under authority, fenced by the intent's nonce
 *
 * Until IR-125 the authority was taken only at commit, AFTER the POST. A foreign watcher arriving
 * during the round trip left a comment on the issue with no local record, and the CLI — truthfully
 * describing the local store — said "nothing written". The operator posted again. Reproduced with a
 * deterministic seam before repair: a live foreign lock installed inside `find` gave
 * `posts === 1, outbox.length === 0`.
 *
 * The intent is the transferable publication authorisation: it is written while holding the
 * canonical write authority, it names the exact digest, and it carries the attempt's nonce and OS
 * identity. A foreign watcher acquiring the LOCK after BEGIN does not revoke it — the lock protects
 * `state.json`, and what the intent secured is precisely the local record the POST would otherwise
 * lack. The proof commit re-checks ownership afterwards and is fenced by the nonce.
 *
 * Nothing before the read-back is a proof, and a proof is written only after a read-back has
 * matched. `CLAUDE.md` states the invariant: `REMOTE_POST_NOT_CONFIRMED => CHATGPT_NOT_YET_NOTIFIED`.
 *
 * ## CRASH WINDOWS, EACH ANSWERED RATHER THAN HOPED ABOUT
 *
 *   authority refused at BEGIN        nothing sent, nothing written. POST provably uncalled.
 *   after BEGIN, before post          a durable intent exists. Replay: the intent's owner is GONE
 *                                     (the process died) so it is taken over; `find` runs FIRST.
 *   after post, before read-back      intent durable, comment remote. Replay calls `find` FIRST and
 *                                     ADOPTS it instead of posting twice. That is why adoption
 *                                     exists; without it the crash-safe choices are a duplicate or
 *                                     a lost proof.
 *   after read-back, before commit    same as above — found and adopted.
 *   commit refused (ownership moved)  the intent REMAINS, naming the digest, so no caller can say
 *                                     "nothing written"; the outcome carries
 *                                     `remoteSideEffect: "POSTED_UNRECORDED"` with the comment id.
 *   exception in a LIVE process       the intent is marked ABANDONED under authority, so a
 *                                     same-process retry is never wedged by its own corpse and the
 *                                     evidence survives. `find` still discriminates on retry.
 *   two attempts, same unit, racing   both serialise at BEGIN; the second sees a live foreign
 *                                     intent and refuses. At most one POST.
 *   after log, before state           the log is append-only and advisory; the state array is the
 *                                     authority, so a half-committed cycle reads as not-yet-open.
 *   after commit                      open, and a further replay short-circuits on ALREADY_PROVEN.
 *
 * ## SERIALISATION
 *
 * The watcher owns `state.json`. Rather than invent a second lock protocol, this REFUSES while a
 * live watcher holds the existing lock. Fail closed and say so; do not write out of band and hope
 * the renames interleave kindly.
 */

import { randomUUID } from "node:crypto";
import {
  bodyDigest,
  CONTROL_BUS_REPOSITORY,
  isTransmitted,
  type ControlBusState,
  type OutboxEntry,
  type PublicationIntent,
} from "./state";
import { ownerLiveness, selfIdentity, type StartProbe } from "./owner";
import { mayPostPublicly } from "../escalation/screen";
import {
  appendOutboxLog,
  loadState,
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
  /**
   * Not open. `remoteSideEffect` says what the WORLD looks like, which the local store cannot:
   *
   *   NONE               no POST was made by this call
   *   POSTED_UNRECORDED  a POST was made and read back, and the local commit was then refused —
   *                      the comment exists and `commentId` names it
   *   UNKNOWN            a POST was attempted and this call cannot say whether it landed
   *
   * The CLI used to print "nothing written" from the local store alone while a comment already
   * existed. A refusal that cannot describe its own side effect is how that happens.
   */
  | {
      status: "REFUSED";
      reason: string;
      entry?: OutboxEntry;
      remoteSideEffect: "NONE" | "POSTED_UNRECORDED" | "UNKNOWN";
      commentId?: number;
    };

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
  /** This attempt's exclusive in-flight identity. Random by default; injectable for determinism. */
  attemptNonce?: string;
  /** Test seam: fires after the intent is durable and before the transport is touched. */
  afterIntentWritten?: () => void;
}

/**
 * Attempts currently EXECUTING in this process, by nonce.
 *
 * "In flight" has to mean "an attempt is running right now", and the store alone cannot say that
 * for a live process: an attempt that returned REFUSED because the commit was refused leaves its
 * intent behind, its owner is this very process, and this process is ALIVE — so a store-only rule
 * would block every retry from the same process forever (Codex read-only review, finding 1). Two
 * CONCURRENT attempts in one process must still exclude each other (finding 2). The registry is
 * the missing fact: an intent owned by this process blocks only while its nonce is in here.
 * A crashed process takes its registry with it, and its intents read as GONE by OS identity.
 */
const executing = new Set<string>();

function sameProcess(a: { pid: number; startedAt: string } | undefined, b: typeof a): boolean {
  return a !== undefined && b !== undefined && a.pid === b.pid && a.startedAt === b.startedAt;
}

/**
 * This process's OS identity, read once per probe.
 *
 * BEGIN and COMMIT each need it, and on Windows each read spawns PowerShell (~450ms measured).
 * A process's start time cannot change while it runs, so the second read can only agree with the
 * first. Keyed by the probe function so an injected test probe is never answered from a cache
 * filled by a different one.
 */
const identityByProbe = new Map<StartProbe | undefined, ReturnType<typeof selfIdentity>>();
function ownIdentity(probe: StartProbe | undefined): ReturnType<typeof selfIdentity> {
  if (!identityByProbe.has(probe)) identityByProbe.set(probe, selfIdentity(probe));
  return identityByProbe.get(probe)!;
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
  const attemptNonce = deps.attemptNonce ?? randomUUID();

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
    return {
      status: "REFUSED",
      reason: `the body did not pass the public screen (${where})`,
      remoteSideEffect: "NONE",
    };
  }

  const composed: OutboxEntry = {
    protocolId: draft.protocolId,
    kind: draft.kind,
    body: draft.body,
    composedAt: draft.composedAt,
  };

  // --- BEGIN: the authority, taken BEFORE the network, and a durable intent written under it ---
  //
  // This is the whole of IR-125. The authority used to be taken only at commit, so a foreign
  // watcher arriving during the POST left a comment with no local record. Now nothing reaches the
  // transport until this process has held the canonical write authority for THIS publication and
  // written the fact down. If the authority is refused here, the POST is provably uncalled.
  const begun = beginPublication(paths, state, composed, digest, attemptNonce, deps, expect);
  if (!begun.ok) {
    if (begun.alreadyProven) return { status: "ALREADY_PROVEN", entry: begun.alreadyProven };
    return { status: "REFUSED", reason: begun.reason, remoteSideEffect: "NONE" };
  }
  executing.add(attemptNonce);
  try {
    return await publishUnderIntent(
      paths,
      state,
      draft,
      composed,
      digest,
      attemptNonce,
      transport,
      deps,
      expect,
    );
  } finally {
    executing.delete(attemptNonce);
  }
}

/** Everything after BEGIN: the intent is durable and this attempt is registered as executing. */
async function publishUnderIntent(
  paths: StorePaths,
  state: ControlBusState,
  draft: OutboundDraft,
  composed: OutboxEntry,
  digest: string,
  attemptNonce: string,
  transport: OutboundTransport,
  deps: OutboundDeps,
  expect: { repository: string; issueNumber: number },
): Promise<OutboundOutcome> {
  deps.afterIntentWritten?.();

  // From here on the intent is durable. Whatever happens, it is either upgraded to a proof under
  // the same authority, or marked abandoned so a live process never wedges its own retries.
  let posted: { commentId: number } | null = null;
  let remote: RemoteCommentRef | null = null;
  let adopted = false;
  try {
    // --- adopt a comment an earlier attempt already posted -------------------------------------
    //
    // `find` runs before EVERY post, not only on replay: the previous attempt may have crashed
    // after GitHub created the comment and before the read-back, or its `post()` may have thrown
    // on an ambiguous transport result after the comment landed. Remote evidence decides.
    const found = await transport.find(draft.protocolId, digest);
    if (found) {
      remote = found;
      adopted = true;
    } else {
      posted = await transport.post(draft.body);
      // A successful POST is NOT evidence. Only the read-back is.
      remote = await transport.readBack(posted.commentId);
    }
  } catch (error) {
    // The transport threw somewhere between `find` and the read-back. If `post` was never reached
    // there is no remote side effect; if it was, this call cannot say whether the comment landed —
    // and it must say THAT, not "nothing written". The intent is abandoned so a live process can
    // retry; the retry's `find` decides.
    abandonPublication(paths, state, composed, attemptNonce, deps);
    return {
      status: "REFUSED",
      reason: `the transport failed: ${(error as Error).message.split("\n")[0]}`,
      entry: composed,
      remoteSideEffect: posted === null && !transportReachedPost(error) ? "NONE" : "UNKNOWN",
      ...(posted ? { commentId: posted.commentId } : {}),
    };
  }

  const mismatch = describeMismatch(remote, expect, digest);
  if (mismatch !== null) {
    // Recorded WITHOUT proof — the composed entry stays and the intent is abandoned. The attempt is
    // visible and the id stays closed, which is the point: a failed read-back must leave a record,
    // not a silence, and must not leave an opening.
    abandonPublication(paths, state, composed, attemptNonce, deps);
    return {
      status: "REFUSED",
      reason: mismatch,
      entry: composed,
      remoteSideEffect: posted ? "UNKNOWN" : "NONE",
      ...(posted ? { commentId: posted.commentId } : {}),
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
    abandonPublication(paths, state, composed, attemptNonce, deps);
    return {
      status: "REFUSED",
      reason: "the assembled proof did not satisfy isTransmitted",
      entry: composed,
      remoteSideEffect: "UNKNOWN",
      commentId: remote!.commentId,
    };
  }

  const written = commitUnderAuthority(paths, state, proven, attemptNonce, deps, expect);
  if (written.committed && written.reconciled !== null) {
    // Somebody landed the identical proof while we were away. Not a second entry, and not a
    // pretence that we wrote this one.
    return { status: "ALREADY_PROVEN", entry: written.reconciled };
  }
  if (!written.committed) {
    // The comment exists remotely and this machine may not record the proof. Fail closed: not
    // open, and NOT re-posted on the next attempt either — `find` will adopt it by digest. The
    // intent stays in the store, naming the digest, so this is never "nothing written". It is
    // marked abandoned where the authority allows; where it does not (a live foreign lock is the
    // usual reason the commit was refused), the executing-registry releasing on return is what
    // keeps this process retryable, and the OS identity is what keeps others from a live one.
    abandonPublication(paths, state, composed, attemptNonce, deps);
    return {
      status: "REFUSED",
      reason: written.reason,
      entry: composed,
      remoteSideEffect: "POSTED_UNRECORDED",
      commentId: remote!.commentId,
    };
  }
  return { status: adopted ? "ADOPTED_EXISTING" : "COMMITTED", entry: proven };
}

/**
 * Whether a transport error came from `post()` or later, as opposed to from `find()`.
 *
 * Deliberately conservative: anything not proven to have failed BEFORE the POST is reported as
 * UNKNOWN. An error tagged by the transport as pre-post is the only thing that earns NONE.
 */
function transportReachedPost(error: unknown): boolean {
  return !(error instanceof Error && (error as { beforePost?: boolean }).beforePost === true);
}

/** The outbox key: one logical publication. The kind tag is inside the body, so it is in the digest. */
function sameUnit(e: OutboxEntry, entry: OutboxEntry, digest: string): boolean {
  return (
    e.protocolId === entry.protocolId && e.kind === entry.kind && bodyDigest(e.body) === digest
  );
}

/**
 * Take the canonical write authority and record that THIS attempt is publishing THIS body.
 *
 * Runs on the freshly reloaded state, mutates only the outbox, and writes it back through the same
 * atomic path as every other commit — so the watcher's cursor and inbox are preserved exactly.
 * Holds the mutation right for microseconds, the same as a commit; never across the network.
 */
function beginPublication(
  paths: StorePaths,
  captured: ControlBusState,
  composed: OutboxEntry,
  digest: string,
  attemptNonce: string,
  deps: OutboundDeps,
  expect: { repository: string; issueNumber: number },
): { ok: true } | { ok: false; reason: string; alreadyProven?: OutboxEntry } {
  const result = withCanonicalWriteAuthority(
    paths,
    deps.claim,
    deps.heartbeatStaleMs,
    deps.nowMs(),
    (): { ok: true } | { ok: false; reason: string; alreadyProven?: OutboxEntry } => {
      const fresh = loadState(paths, captured.issueNumber);

      const proven = fresh.outbox.find(
        (e) => sameUnit(e, composed, digest) && isTransmitted(e, expect),
      );
      if (proven) return { ok: false, reason: "already proven", alreadyProven: proven };

      // A live foreign intent is a publication genuinely in flight. Per ATTEMPT, not per process:
      // two concurrent calls from one process are two attempts, and at most one may proceed. A
      // crashed attempt's owner is GONE and its intent is taken over; an abandoned one never blocks.
      const self = ownIdentity(deps.startProbe) ?? deps.claim.owner;
      const inFlight = fresh.outbox.find((e) => {
        const intent = e.publication;
        if (!sameUnit(e, composed, digest) || !intent || intent.abandonedAt !== undefined) {
          return false;
        }
        if (intent.attemptNonce === attemptNonce) return false;
        // Our own process: in flight only while that attempt is still executing. A returned
        // attempt — refused commit, thrown transport — left its intent as evidence, not a claim.
        if (sameProcess(intent.owner, self)) return executing.has(intent.attemptNonce);
        // Another process: the OS decides. GONE is a crash and is taken over; anything else blocks.
        const owner = intent.owner ? { pid: intent.owner.pid, owner: intent.owner } : undefined;
        return ownerLiveness(owner, deps.startProbe).state !== "GONE";
      });
      if (inFlight) {
        return {
          ok: false,
          reason:
            `a publication of this exact body is already in flight (attempt ` +
            `${inFlight.publication!.attemptNonce}, pid ${inFlight.publication!.owner?.pid ?? "?"})`,
        };
      }

      const intent: PublicationIntent = { attemptNonce, owner: self, startedAt: deps.now() };
      const mine: OutboxEntry = { ...composed, publication: intent };
      // Replace any unproven record of this unit (a prior abandoned or crashed attempt) rather
      // than accumulating one composed entry per attempt.
      const at = fresh.outbox.findIndex((e) => sameUnit(e, composed, digest) && !e.transmission);
      if (at === -1) fresh.outbox.push(mine);
      else fresh.outbox[at] = mine;
      appendOutboxLog(paths, mine);
      writeState(paths, fresh);
      return { ok: true };
    },
    undefined,
    deps.startProbe,
  );
  return result.held ? result.value : { ok: false, reason: result.reason };
}

/**
 * An attempt ended without proof in a process that is still alive. Mark its intent abandoned —
 * under authority, and only if the intent is still ours — so the evidence survives and a retry is
 * not refused by its own corpse. If the authority cannot be had right now, the intent stays as it
 * is: its owner will read as GONE once this process exits, and as in-flight until then, which is
 * the fail-closed direction.
 */
function abandonPublication(
  paths: StorePaths,
  captured: ControlBusState,
  composed: OutboxEntry,
  attemptNonce: string,
  deps: OutboundDeps,
): void {
  const digest = bodyDigest(composed.body);
  withCanonicalWriteAuthority(
    paths,
    deps.claim,
    deps.heartbeatStaleMs,
    deps.nowMs(),
    () => {
      const fresh = loadState(paths, captured.issueNumber);
      const at = fresh.outbox.findIndex(
        (e) => sameUnit(e, composed, digest) && e.publication?.attemptNonce === attemptNonce,
      );
      if (at === -1) return;
      fresh.outbox[at] = {
        ...fresh.outbox[at],
        publication: { ...fresh.outbox[at].publication!, abandonedAt: deps.now() },
      };
      appendOutboxLog(paths, fresh.outbox[at]);
      writeState(paths, fresh);
    },
    undefined,
    deps.startProbe,
  );
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
 * state, and FENCED by the attempt nonce.
 *
 * Both halves matter and review found both missing. The ordering is `commitCycle`'s, for the same
 * reason: a crash between them costs a re-read, never a claim that outran its evidence. The reload
 * is the other half: the state this function was handed was captured BEFORE a network round trip,
 * and writing it back would regress whatever the watcher advanced meanwhile. Nothing outside the
 * authority may touch `state.json`.
 *
 * The fence is IR-125's third finding (Codex read-only review): if another permitted attempt has
 * replaced our intent, our proof must not overwrite ITS state. Compare-and-replace on the nonce;
 * an independently verified identical proof is reconciled, not clobbered.
 */
function commitUnderAuthority(
  paths: StorePaths,
  captured: ControlBusState,
  entry: OutboxEntry,
  attemptNonce: string,
  deps: OutboundDeps,
  expect: { repository: string; issueNumber: number },
):
  | { committed: true; state: ControlBusState; reconciled: OutboxEntry | null }
  | { committed: false; reason: string } {
  const digest = bodyDigest(entry.body);
  const result = withCanonicalWriteAuthority(
    paths,
    deps.claim,
    deps.heartbeatStaleMs,
    deps.nowMs(),
    (): { fresh: ControlBusState; reconciled: OutboxEntry | null } | { superseded: string } => {
      // RELOAD. `captured` is a photograph of the state before the await; `fresh` is what is
      // actually on disk now, cursor and inbox included.
      const fresh = loadState(paths, captured.issueNumber);

      // Reconcile rather than duplicate: another writer, or an earlier attempt of ours, may have
      // landed the very same proof while we were away.
      const already = fresh.outbox.find(
        (e) => sameUnit(e, entry, digest) && isTransmitted(e, expect),
      );
      if (already) return { fresh, reconciled: already };

      // The fence. Our intent must still be ours.
      const at = fresh.outbox.findIndex(
        (e) => sameUnit(e, entry, digest) && e.publication?.attemptNonce === attemptNonce,
      );
      if (at === -1) {
        const other = fresh.outbox.find((e) => sameUnit(e, entry, digest) && e.publication);
        return {
          superseded: other
            ? `the publication intent was superseded by attempt ${other.publication!.attemptNonce}`
            : "the publication intent is no longer in the store",
        };
      }

      const proven: OutboxEntry = { ...entry, publication: fresh.outbox[at].publication };
      appendOutboxLog(paths, proven);
      fresh.outbox[at] = proven;
      writeState(paths, fresh);
      return { fresh, reconciled: null };
    },
    deps.afterRightTaken,
    deps.startProbe,
  );

  if (!result.held) return { committed: false, reason: result.reason };
  if ("superseded" in result.value) return { committed: false, reason: result.value.superseded };
  return { committed: true, state: result.value.fresh, reconciled: result.value.reconciled };
}
