/**
 * The escalation channel's state machine — GitHub issue #2, Claude ↔ ChatGPT.
 *
 * Pure. Nothing here opens a socket. It takes the comments someone else fetched and the local
 * record, and returns what has happened and what is owed; the reading and writing live in the
 * script that calls it. That split is what makes every case in this protocol testable without
 * touching a real issue, including the ones that matter most — a duplicate acknowledgement, a
 * decision with no escalation behind it, a replay after restart.
 *
 * **The distinction the whole module exists to hold: transport state is not decision state.**
 * A decision can be received, validated and fully applied while its acknowledgement sits unposted
 * because there is no write credential. Collapsing those two would make a missing token look like
 * unfinished engineering, or — far worse — make an unposted acknowledgement look like an
 * unapplied decision and invite doing the work twice.
 *
 * Nothing here may invent a decision, and a transport failure is never read as approval.
 */

/** The three message kinds the channel carries, and nothing else. */
export type ProtocolKind = "ESCALATION" | "CHATGPT_DECISION" | "CLAUDE_APPLIED";

export interface ProtocolMessage {
  kind: ProtocolKind;
  /** Stable identifier shared by all three messages of one exchange, e.g. `TEST-002`. */
  id: string;
  /** GitHub's comment id. Identity comes from this, never from a timestamp. */
  commentId: number;
  author: string;
  body: string;
}

export interface RemoteComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}

const TAG = /^\[(ESCALATION|CHATGPT_DECISION|CLAUDE_APPLIED)\]\[([A-Z0-9][A-Z0-9-]{0,31})\]/;

/**
 * Reads a comment's protocol tag, or returns null.
 *
 * Deliberately strict, and deliberately silent on a miss. The issue is a human-readable thread and
 * ordinary prose will appear in it; treating an untagged comment as malformed would turn every
 * side remark into an error, while treating a MALFORMED tag as valid is how a typo becomes a
 * decision applied to the wrong exchange.
 */
export function parseProtocolMessage(comment: RemoteComment): ProtocolMessage | null {
  const match = TAG.exec(comment.body.trim());
  if (!match) return null;
  return {
    kind: match[1] as ProtocolKind,
    id: match[2],
    commentId: comment.id,
    author: comment.user.login,
    body: comment.body,
  };
}

/** Where one exchange has got to. Transport and decision states are separate fields on purpose. */
export type ExchangeState =
  | "CLAUDE_ESCALATED"
  | "WAITING_FOR_DECISION"
  | "DECISION_RECEIVED"
  | "DECISION_VALIDATED"
  | "APPLIED"
  | "ACK_PENDING"
  | "ACK_POSTED"
  | "DECISION_INVALID";

export interface Exchange {
  id: string;
  state: ExchangeState;
  /** True once a matching `[ESCALATION][id]` is visible remotely. */
  escalationPosted: boolean;
  decisionCommentId?: number;
  /** Set locally when the decision's substance has actually been carried out. */
  applied: boolean;
  ackPosted: boolean;
  /** Why the exchange is where it is, in words. A bare state is not an audit record. */
  note: string;
}

/** What the local side knows that GitHub cannot tell us. */
export interface LocalRecord {
  /** Exchange ids whose decisions have been applied in the repository. */
  appliedIds: string[];
  /** Acknowledgements written, queued, and not yet posted. */
  pendingAckIds: string[];
  /** Escalations composed locally that could not be posted. */
  pendingEscalationIds: string[];
}

export interface ChannelState {
  exchanges: Exchange[];
  /** Highest comment id seen. Identity, never a timestamp — comments can share a second. */
  lastCommentId: number | null;
  /** Tagged messages that could not be parsed into a known kind and id. */
  malformed: { commentId: number; body: string }[];
}

/**
 * Reconciles what GitHub shows against what the repository recorded.
 *
 * Remote is the authority on what was POSTED; local is the authority on what was APPLIED. Neither
 * can answer the other's question, and a reconciliation that trusted one for both would either
 * re-apply a decision whose acknowledgement failed to post, or report work as done because a
 * comment exists.
 */
export function reconcile(comments: RemoteComment[], local: LocalRecord): ChannelState {
  const parsed: ProtocolMessage[] = [];
  const malformed: ChannelState["malformed"] = [];

  for (const comment of comments) {
    const message = parseProtocolMessage(comment);
    if (message) parsed.push(message);
    else if (/^\s*\[/.test(comment.body))
      // Opens with a bracket but does not match the protocol: a typo in a tag, not prose.
      malformed.push({ commentId: comment.id, body: comment.body.slice(0, 120) });
  }

  const ids = [...new Set(parsed.map((m) => m.id))].sort();
  const applied = new Set(local.appliedIds);
  const pendingAcks = new Set(local.pendingAckIds);

  const exchanges = ids.map((id): Exchange => {
    const forId = parsed.filter((m) => m.id === id);
    const escalationPosted = forId.some((m) => m.kind === "ESCALATION");
    const decision = forId.find((m) => m.kind === "CHATGPT_DECISION");
    const ackPosted = forId.some((m) => m.kind === "CLAUDE_APPLIED");
    const isApplied = applied.has(id);

    // Ordered most-settled first, so a later stage always wins over an earlier one.
    if (ackPosted) {
      return {
        id,
        state: "ACK_POSTED",
        escalationPosted,
        decisionCommentId: decision?.commentId,
        applied: true,
        ackPosted: true,
        note: "Acknowledged on the issue; this exchange is closed.",
      };
    }
    if (isApplied) {
      return {
        id,
        state: pendingAcks.has(id) ? "ACK_PENDING" : "APPLIED",
        escalationPosted,
        decisionCommentId: decision?.commentId,
        applied: true,
        ackPosted: false,
        note: pendingAcks.has(id)
          ? "Decision applied; acknowledgement queued and not posted. Transport, not engineering."
          : "Decision applied; no acknowledgement queued yet.",
      };
    }
    if (decision) {
      // A decision with no escalation behind it is not obeyed. It may be a test, a stray, or aimed
      // at another repository, and applying it would be acting on an instruction nobody here asked
      // for. TEST-001 is exactly this shape and is why the state exists rather than throwing.
      return {
        id,
        state: escalationPosted ? "DECISION_RECEIVED" : "DECISION_INVALID",
        escalationPosted,
        decisionCommentId: decision.commentId,
        applied: false,
        ackPosted: false,
        note: escalationPosted
          ? "Decision received against a posted escalation; validate before applying."
          : "Decision has no matching [ESCALATION] on this issue. Not applied.",
      };
    }
    return {
      id,
      state: "WAITING_FOR_DECISION",
      escalationPosted,
      applied: false,
      ackPosted: false,
      note: "Escalation posted; no decision yet. Independent work continues.",
    };
  });

  return {
    exchanges,
    lastCommentId: comments.length > 0 ? Math.max(...comments.map((c) => c.id)) : null,
    malformed,
  };
}

/** A message composed locally that could not be sent. */
export interface PendingComment {
  kind: ProtocolKind;
  id: string;
  body: string;
  /** ISO timestamp of composition, supplied by the caller so this stays pure. */
  createdAt: string;
  reasonNotPosted: string;
  /** Always a state change, never elapsed time — nothing improves by waiting. */
  retryCondition: "CREDENTIAL_STATE_CHANGED";
}

/**
 * Adds a pending comment unless the same message is already queued or already on the issue.
 *
 * Idempotent by (kind, id). The transport is retried whenever a credential appears, and a queue
 * that grew a duplicate on each attempt would post the same acknowledgement several times the
 * moment one did.
 */
export function queuePendingComment(
  queue: PendingComment[],
  candidate: PendingComment,
  channel: ChannelState,
): PendingComment[] {
  const alreadyQueued = queue.some((p) => p.kind === candidate.kind && p.id === candidate.id);
  const alreadyPosted = channel.exchanges.some(
    (e) => e.id === candidate.id && candidate.kind === "CLAUDE_APPLIED" && e.ackPosted,
  );
  if (alreadyQueued || alreadyPosted) return queue;
  return [...queue, candidate];
}

export type WriteCapability = "WRITE_AVAILABLE" | "READ_ONLY" | "NO_CREDENTIAL" | "AUTH_FAILURE";

export type TransportState =
  | "READ_ONLY_VERIFIED"
  | "WRITE_PENDING_AUTH"
  | "HALF_DUPLEX"
  | "FULL_DUPLEX_VERIFIED"
  | "TRANSPORT_DEGRADED";

/**
 * The most honest description of the channel, given what has actually been observed.
 *
 * `FULL_DUPLEX_VERIFIED` requires a write that was READ BACK. A successful POST is not evidence the
 * channel works — the round trip is — and this project has already learned what an unverified
 * green result is worth.
 */
export function describeTransport(input: {
  readVerified: boolean;
  write: WriteCapability;
  ackReadBack: boolean;
}): TransportState {
  if (!input.readVerified) return "TRANSPORT_DEGRADED";
  if (input.write === "WRITE_AVAILABLE") {
    return input.ackReadBack ? "FULL_DUPLEX_VERIFIED" : "HALF_DUPLEX";
  }
  return "WRITE_PENDING_AUTH";
}
