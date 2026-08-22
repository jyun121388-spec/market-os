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

import { screenPublicComment } from "./screen";

/** The three message kinds the channel carries, and nothing else. */
export type ProtocolKind = "ESCALATION" | "CHATGPT_DECISION" | "CLAUDE_APPLIED";

export interface ProtocolMessage {
  kind: ProtocolKind;
  /** Stable identifier shared by all three messages of one exchange, e.g. `TEST-002`. */
  id: string;
  /**
   * The project segment, where the message carries one.
   *
   * `CLAUDE.md` documents the tag as `[ESCALATION][<PROJECT_ID>][<ESC_ID>]`, and this parser read
   * only two segments — so `[ESCALATION][MARKET-OS][ESC-012]` became an exchange whose id was
   * `MARKET-OS`, and the decision that answered it, tagged `[CHATGPT_DECISION][ESC-012]`, matched
   * nothing. Reproduced against the real ESC-012 pair (IR-086).
   *
   * Absent for a two-segment tag, which is most of the channel's history and stays valid.
   */
  project?: string;
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

/**
 * The tag, with the optional project segment the protocol has always documented.
 *
 * Two shapes are valid and no others: `[KIND][ID]` and `[KIND][PROJECT][ID]`. When three segments
 * are present the LAST is the exchange id, because that is what the answering
 * `[CHATGPT_DECISION][ID]` carries — reading the second segment as the id is what made an
 * escalation and its own decision fail to match each other (IR-086).
 *
 * **The trailing `(?=\s|$)` is the grammar, not a detail.** Without it the pattern matched a
 * PREFIX of the tag and ignored whatever followed, which did not merely accept a malformed
 * message — it silently reassigned identity:
 *
 *     [CHATGPT_DECISION][ESC-X][EXTRA]        -> project=ESC-X,     id=EXTRA
 *     [CHATGPT_DECISION][MARKET-OS][ESC-X     -> project=undefined, id=MARKET-OS
 *     [CHATGPT_DECISION][MARKET-OS][]         -> project=undefined, id=MARKET-OS
 *
 * The last two are IR-086's failure mode reachable through a typo: the project segment becomes the
 * exchange id, so a directive addressed to MARKET-OS is filed as an exchange CALLED MARKET-OS and
 * the project gate never sees a project at all.
 *
 * With the boundary, all four malformed forms fail to parse entirely. The regex backtracks out of
 * the optional third segment, finds the two-segment reading also bounded by `[`, and gives up —
 * which is the right answer: a tag this parser cannot read exactly is not a tag it may read
 * approximately. `reconcile()` collects it as `malformed`, so it is visible rather than dropped.
 *
 * Ordinary prose after a valid tag is unaffected: the boundary asks for whitespace, and every real
 * message has some.
 */
const TAG =
  /^\[(ESCALATION|CHATGPT_DECISION|CLAUDE_APPLIED)\]\[([A-Z0-9][A-Z0-9-]{0,31})\](?:\[([A-Z0-9][A-Z0-9-]{0,31})\])?(?=\s|$)/;

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
  const [, kind, second, third] = match;
  return {
    kind: kind as ProtocolKind,
    // Three segments: the middle one is the project and the last is the exchange id.
    id: third ?? second,
    ...(third ? { project: second } : {}),
    commentId: comment.id,
    author: comment.user.login,
    body: comment.body,
  };
}

/**
 * Whether a message is addressed to this repository.
 *
 * The single definition, imported by both state machines. It exists as a function rather than as
 * two inline comparisons because two inline comparisons is exactly what went wrong: the consumer
 * grew a project gate, `reconcile()` did not, and the same foreign-project directive was
 * `WRONG_PROJECT` to one and a valid `UNSOLICITED_DIRECTIVE` to the other.
 */
export type ProjectMatch =
  /** The tag names this project. */
  | "MATCHES"
  /** The tag names a different project. */
  | "FOREIGN"
  /** The tag names no project. Legacy, valid, and most of this channel's history. */
  | "UNTAGGED"
  /** The tag names a project and we have no identity to compare it against. */
  | "LOCAL_IDENTITY_UNKNOWN";

/**
 * Compares a message's project segment against this repository's own.
 *
 * `LOCAL_IDENTITY_UNKNOWN` is deliberately a distinct answer from `FOREIGN`, and both callers
 * refuse on either. Collapsing them would either report a configuration gap as somebody else's
 * message, or — far worse the other way — let an unconfigured deployment accept instructions
 * addressed to any repository at all. Unknown is not a match.
 */
export function matchProject(
  messageProject: string | undefined,
  localProject: string | undefined,
): ProjectMatch {
  if (messageProject === undefined) return "UNTAGGED";
  if (localProject === undefined) return "LOCAL_IDENTITY_UNKNOWN";
  return messageProject.trim().toUpperCase() === localProject.trim().toUpperCase()
    ? "MATCHES"
    : "FOREIGN";
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
  /**
   * A trusted directive with no matching escalation. Valid input; nothing applied.
   *
   * Added by [CHATGPT_DECISION][ESC-012]. Previously these were DECISION_INVALID, which said the
   * message was worthless when what was actually true is that this repository had not asked for
   * it — and it had acted on seven of them.
   */
  | "UNSOLICITED_DIRECTIVE"
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
  /**
   * GitHub logins whose decisions this repository will read as directives.
   *
   * The same allowlist the consumer uses, and it fails closed here for the same reason: the issue
   * is publicly commentable, so without it an unmatched decision from anyone at all would be
   * reported as an unsolicited directive rather than as noise.
   */
  trustedAuthors?: string[];
  /**
   * This repository's project id, from committed configuration — `controlbus/identity`.
   *
   * A parameter rather than an import so this module stays pure and every case is testable
   * without a repository. Absent means a project-tagged message is refused here exactly as the
   * consumer refuses it: unknown is not a match.
   */
  project?: string;
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
      // Two state machines described the same message differently until ESC-012, and the
      // inconsistency was the finding rather than a detail: the consumer called an unmatched
      // trusted directive invalid, and so did this, while the project acted on those directives
      // as its primary channel.
      //
      // The split here is by AUTHOR, because that is the only authorisation fact reconciliation
      // can see. A trusted author with no matching escalation sent an unsolicited directive; an
      // untrusted one sent something this repository has no reason to read as anything. Neither
      // is applied by this function, which reports where an exchange has got to and never moves
      // it — `applied` stays false in both branches, exactly as before.
      //
      // Fails closed with no allowlist: absent `trustedAuthors`, nobody is trusted and an
      // unmatched decision stays INVALID, so forgetting to configure it cannot widen anything.
      // Addressed to us? Asked FIRST, and asked through the same function the consumer calls.
      //
      // The first ESC-012 application gave the consumer a project gate and left this one without
      // it, so `[CHATGPT_DECISION][OTHER-REPO][ESC-X]` was WRONG_PROJECT to one state machine and
      // a valid UNSOLICITED_DIRECTIVE to the other. Two definitions of one boundary means the
      // answer depends on which caller you ask, which is not a boundary.
      const projectMatch = matchProject(decision.project, local.project);
      if (projectMatch === "FOREIGN" || projectMatch === "LOCAL_IDENTITY_UNKNOWN") {
        return {
          id,
          state: "DECISION_INVALID",
          escalationPosted,
          decisionCommentId: decision.commentId,
          applied: false,
          ackPosted: false,
          note:
            projectMatch === "FOREIGN"
              ? `Tagged for project ${decision.project}, which is not this repository. Not a ` +
                "directive here, whoever sent it and whatever it says."
              : `Tagged for project ${decision.project}, and no local project identity was ` +
                "supplied to compare it against. Unknown is not a match.",
        };
      }

      const trusted = (local.trustedAuthors ?? []).some(
        (login) => login.toLowerCase() === decision.author.toLowerCase(),
      );
      const unsolicited = !escalationPosted && trusted && !/^TEST-/.test(id);
      return {
        id,
        state: escalationPosted
          ? "DECISION_RECEIVED"
          : unsolicited
            ? "UNSOLICITED_DIRECTIVE"
            : "DECISION_INVALID",
        escalationPosted,
        decisionCommentId: decision.commentId,
        applied: false,
        ackPosted: false,
        note: escalationPosted
          ? "Decision received against a posted escalation; validate before applying."
          : unsolicited
            ? "A trusted directive with no matching [ESCALATION]. Valid input, not yet applied — " +
              "the consumer judges it and the application prerequisite gates any effect."
            : "Decision has no matching [ESCALATION] and no trusted author. Not applied.",
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
  // Screened at the queue boundary rather than at the post, because the queue is durable: a
  // comment that reaches it is written to `docs/escalation/PENDING_COMMENTS.md` and committed,
  // so a credential in the body is published to the repository whether or not the post ever
  // happens. Checking at the last moment would be checking after the leak.
  //
  // Throwing rather than dropping. A silently discarded escalation is a question nobody knows was
  // asked, and the caller composed this text believing it would be sent.
  const screened = screenPublicComment(candidate.body);
  if (screened.length > 0) {
    throw new Error(
      `Refusing to queue ${candidate.kind}[${candidate.id}] for a public channel: ` +
        screened.map((f) => `line ${f.line} — ${f.reason}`).join("; "),
    );
  }

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
