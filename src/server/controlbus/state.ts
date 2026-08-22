/**
 * The control bus: GitHub issue #2 as an asynchronous rendezvous, not a message board.
 *
 * Claude posts a question and keeps working. Some time later — minutes or days, and nothing here
 * may care which — ChatGPT answers on the issue. A local watcher notices, writes the answer down,
 * and the scheduler picks it up as work. No step waits on the next one.
 *
 * This module is the pure half: state, identity, and the transitions between them. It never opens
 * a socket and never touches a disk, so every case that matters — a redelivered comment, a decision
 * with no escalation, a replay after a crash — is exercised in a unit test rather than hoped about.
 *
 * **Identity is `(githubCommentId, protocolId)` and never a timestamp.** Two comments can share a
 * second, clocks disagree, and a redelivered fetch returns the same `created_at` as the first. The
 * comment id is assigned by GitHub and never reused; the protocol id is chosen by us and stable
 * across sessions. Between them they answer both questions that matter: "have I seen this message"
 * and "have I already answered this question".
 *
 * **The bus is transport, not authority.** Nothing here decides whether a decision may be obeyed.
 * A parsed `[CHATGPT_DECISION]` is a message that arrived, which is a strictly weaker fact than a
 * decision that may be applied — Governance answers the second, and a comment on a public issue
 * cannot promote itself past it.
 */

import type { ProtocolMessage, RemoteComment } from "../escalation/transport";
import { parseProtocolMessage } from "../escalation/transport";

/** Where a received decision has got to. The watcher may only ever produce the first. */
export type InboxStatus =
  /** Written down by the watcher. Nothing has judged it yet, and the name says so. */
  | "RECEIVED_UNVALIDATED"
  /** The consumer matched it to an open escalation and Governance permitted the action. */
  | "VALIDATED"
  /** Carried out and verified. */
  | "APPLIED"
  /** Rejected — no matching escalation, wrong repository, stale, or forbidden by policy. */
  | "REJECTED";

/**
 * Whether a received decision answers something this repository asked for.
 *
 * Added by `[CHATGPT_DECISION][ESC-012]`. The consumer previously modelled the channel as
 * request/response and rejected everything else as `NO_MATCHING_ESCALATION`, which was right about
 * the rule and wrong about the channel: most traffic on issue #2 has been operational directives
 * nobody here requested, including the one that authorised the twenty-gate review chain.
 *
 * Provenance is a description, never a permission. An unsolicited directive passes exactly the
 * same author, governance, declaration and staleness gates as a solicited one, and neither class
 * applies anything by itself.
 */
export type DecisionProvenance =
  /** A matching `[ESCALATION]` with this protocol id was posted from here. */
  | "SOLICITED_DECISION"
  /** No matching escalation. A trusted author sent an instruction we did not ask for. */
  | "UNSOLICITED_DIRECTIVE";

export interface InboxEntry {
  protocolId: string;
  githubCommentId: number;
  /** Supplied by the caller so this module stays pure and deterministic under test. */
  receivedAt: string;
  author: string;
  body: string;
  status: InboxStatus;
  /**
   * The project segment from the tag, where the message carried one.
   *
   * `[ESCALATION][MARKET-OS][ESC-012]` has one; `[CHATGPT_DECISION][ESC-009]` does not, and most
   * of this channel's history is the second shape. Absent means the tag named no project, never
   * that it named this one.
   */
  project?: string;
  /** Set when the consumer judges the entry. Absent while the status is RECEIVED_UNVALIDATED. */
  provenance?: DecisionProvenance;
  /** Why it was rejected, or how it was applied. Empty until something has happened to it. */
  note?: string;
}

export interface OutboxEntry {
  protocolId: string;
  kind: "ESCALATION" | "CLAUDE_APPLIED";
  body: string;
  composedAt: string;
  /** Set once a read-back proves the comment exists remotely. Never set on a successful POST. */
  transmittedCommentId?: number;
}

export type TransportState =
  | "READ_ONLY_VERIFIED"
  | "WRITE_PENDING_AUTH"
  | "HALF_DUPLEX"
  | "FULL_DUPLEX_VERIFIED"
  | "TRANSPORT_DEGRADED";

export interface ControlBusState {
  issueNumber: number;
  /**
   * The high-water mark, advanced ONLY after every message below it is durably stored.
   *
   * The ordering is the whole of the crash safety argument. Advance the cursor first and a crash
   * before the write loses a decision permanently — the watcher will never look at that comment
   * again, and nothing anywhere will know it existed. Write first and a crash merely means the
   * next cycle re-reads a comment it has already stored, which deduplication absorbs.
   *
   * At-least-once delivery plus idempotent local processing gives exactly-once application. Those
   * three properties have to be arranged in that order or they give none of it.
   */
  lastRemoteCommentId: number | null;
  processedCommentIds: number[];
  processedProtocolIds: string[];
  inbox: InboxEntry[];
  outbox: OutboxEntry[];
  lastSuccessfulRead: string | null;
  lastSuccessfulWrite: string | null;
  transportState: TransportState;
  /** Consecutive failed polls. Drives backoff, and nothing else reads it. */
  consecutiveFailures: number;
}

export function emptyState(issueNumber: number): ControlBusState {
  return {
    issueNumber,
    lastRemoteCommentId: null,
    processedCommentIds: [],
    processedProtocolIds: [],
    inbox: [],
    outbox: [],
    lastSuccessfulRead: null,
    lastSuccessfulWrite: null,
    transportState: "WRITE_PENDING_AUTH",
    consecutiveFailures: 0,
  };
}

export interface IngestResult {
  state: ControlBusState;
  /** Decisions written to the inbox by THIS cycle. Empty on a quiet poll or a full redelivery. */
  admitted: InboxEntry[];
  /** Recognised but not admitted, with the reason. Visible rather than silently dropped. */
  skipped: { commentId: number; protocolId?: string; reason: string }[];
}

/**
 * Folds a fetched page of comments into the state.
 *
 * Deliberately tolerant of the transport and strict about the protocol. GitHub may return comments
 * in any order, return the same comment twice, or return one already seen; none of those is an
 * error. A `[CHATGPT_DECISION]` whose id has already been processed is also not an error — it is
 * the normal consequence of the cursor being advanced after the write rather than before it.
 *
 * What it will not do is admit the same protocol id twice. A second decision under an id that has
 * already been applied is skipped and named, because obeying it would apply an engineering change
 * twice on the strength of a transport redelivery.
 */
export function ingestComments(
  state: ControlBusState,
  comments: RemoteComment[],
  receivedAt: string,
): IngestResult {
  const seenComments = new Set(state.processedCommentIds);
  const seenProtocols = new Set(state.processedProtocolIds);
  const admitted: InboxEntry[] = [];
  const skipped: IngestResult["skipped"] = [];

  // Sorted by GitHub's id, which is monotonic per issue. Sorting by `created_at` would reorder
  // comments posted in the same second and make the high-water mark meaningless.
  const ordered = [...comments].sort((a, b) => a.id - b.id);

  for (const comment of ordered) {
    if (seenComments.has(comment.id)) {
      skipped.push({ commentId: comment.id, reason: "comment already processed" });
      continue;
    }

    const message: ProtocolMessage | null = parseProtocolMessage(comment);
    if (!message) {
      // Ordinary prose on a human-readable thread. Recorded as processed so it is not re-parsed
      // every cycle, but nothing else happens to it.
      seenComments.add(comment.id);
      continue;
    }

    if (message.kind !== "CHATGPT_DECISION") {
      // Our own escalations and acknowledgements come back on every read. Marking them processed
      // is what stops the watcher treating its own output as input.
      seenComments.add(comment.id);
      seenProtocols.add(`${message.kind}:${message.id}`);
      continue;
    }

    const protocolKey = `CHATGPT_DECISION:${message.id}`;
    if (seenProtocols.has(protocolKey)) {
      skipped.push({
        commentId: comment.id,
        protocolId: message.id,
        reason: "a decision for this protocol id has already been admitted",
      });
      seenComments.add(comment.id);
      continue;
    }

    seenComments.add(comment.id);
    seenProtocols.add(protocolKey);
    admitted.push({
      protocolId: message.id,
      githubCommentId: comment.id,
      receivedAt,
      author: message.author,
      // Carried through unchanged. The watcher does not judge whether the project matches; it
      // records what the tag said, and the consumer decides.
      ...(message.project ? { project: message.project } : {}),
      body: message.body,
      // The only status the watcher may write. Transport observed a message; that is all it knows.
      status: "RECEIVED_UNVALIDATED",
    });
  }

  const highWater = ordered.length > 0 ? ordered[ordered.length - 1].id : state.lastRemoteCommentId;

  return {
    state: {
      ...state,
      processedCommentIds: [...seenComments].sort((a, b) => a - b),
      processedProtocolIds: [...seenProtocols].sort(),
      inbox: [...state.inbox, ...admitted],
      lastRemoteCommentId:
        state.lastRemoteCommentId === null
          ? highWater
          : Math.max(state.lastRemoteCommentId, highWater ?? state.lastRemoteCommentId),
      lastSuccessfulRead: receivedAt,
      consecutiveFailures: 0,
    },
    admitted,
    skipped,
  };
}

/**
 * Records the outcome of judging an inbox entry. The watcher never calls this; the consumer does.
 *
 * `provenance` is recorded alongside the status because the two answer different questions and
 * were being conflated: VALIDATED says a decision passed judgement, and the provenance says
 * whether it answered something we asked. Reading a validated entry six months later without the
 * second field, there is no way to tell which.
 */
export function resolveInboxEntry(
  state: ControlBusState,
  protocolId: string,
  status: Exclude<InboxStatus, "RECEIVED_UNVALIDATED">,
  note: string,
  provenance?: DecisionProvenance,
): ControlBusState {
  return {
    ...state,
    inbox: state.inbox.map((entry) =>
      entry.protocolId === protocolId
        ? { ...entry, status, note, ...(provenance ? { provenance } : {}) }
        : entry,
    ),
  };
}

/** Decisions the consumer has not judged yet. This is what turns into startable work. */
export function unprocessedDecisions(state: ControlBusState): InboxEntry[] {
  return state.inbox.filter((entry) => entry.status === "RECEIVED_UNVALIDATED");
}

export type ControlBusHealth =
  | "HEALTHY"
  | "READ_ONLY"
  | "WRITE_BLOCKED"
  | "NETWORK_DEGRADED"
  | "AUTH_FAILURE"
  | "INBOX_BACKLOG"
  | "OUTBOX_BACKLOG"
  | "DECISION_PENDING"
  | "IDLE_WATCHING";

/**
 * One health state, chosen from the most actionable condition that holds.
 *
 * Not a boolean, and the order is the argument. A degraded network is worse news than a blocked
 * write, because a blocked write is a known standing condition (HG-001) while a failing read means
 * decisions are arriving unseen. An inbox backlog outranks an outbox one for the same reason: work
 * that has arrived and is not being consumed is a stall, whereas an outbox that cannot flush is
 * just the credential situation restated.
 */
export function health(input: {
  state: ControlBusState;
  watcherAlive: boolean;
  writeAvailable: boolean;
}): ControlBusHealth {
  const { state, watcherAlive, writeAvailable } = input;
  if (!watcherAlive) return "NETWORK_DEGRADED";
  if (state.consecutiveFailures >= 3) return "NETWORK_DEGRADED";
  if (state.transportState === "TRANSPORT_DEGRADED") return "AUTH_FAILURE";

  const pending = unprocessedDecisions(state);
  if (pending.length > 3) return "INBOX_BACKLOG";
  if (pending.length > 0) return "DECISION_PENDING";

  const untransmitted = state.outbox.filter((entry) => entry.transmittedCommentId === undefined);
  if (untransmitted.length > 3) return "OUTBOX_BACKLOG";
  if (!writeAvailable) return untransmitted.length > 0 ? "WRITE_BLOCKED" : "READ_ONLY";

  return state.inbox.length === 0 ? "IDLE_WATCHING" : "HEALTHY";
}

/**
 * Poll delay in milliseconds.
 *
 * 45 seconds at rest — the middle of the 30–60 second band, fast enough that a decision is picked
 * up while whoever posted it is still nearby, slow enough to be invisible to GitHub's rate limit.
 *
 * On failure it backs off geometrically to a ceiling of eight minutes and stops there. Unbounded
 * backoff is how a watcher goes quietly dead after a laptop lid closes: the machine wakes, the
 * network returns, and the next poll is scheduled for some hour hence. A ceiling means the worst a
 * transient outage costs is eight minutes of extra latency.
 */
export function pollDelayMs(consecutiveFailures: number): number {
  const base = 45_000;
  if (consecutiveFailures === 0) return base;
  return Math.min(base * 2 ** Math.min(consecutiveFailures, 4), 480_000);
}
