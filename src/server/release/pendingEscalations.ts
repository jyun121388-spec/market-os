/**
 * How many staged escalation packets are still owed, decided from an explicit record state.
 *
 * This began as a regex inside `scripts/rc-preflight.ts` and was wrong in two directions at once,
 * which is how it produced a number that looked plausible:
 *
 *  - The pattern required backticks around the tag. Two of the three staged headers did not have
 *    them, so it saw one entry where there were three.
 *  - It treated a STAGED packet as an untransmitted one. The entry it did see had been posted to
 *    issue #2 days earlier and read back.
 *
 * An under-count of an over-count reported "1 escalation queued and not transmitted" — a false
 * blocker in the release preflight, which is the most expensive place for one, because the honest
 * response to a blocker is to stop.
 *
 * The first repair keyed on the header's prose ("transmitted as comment 1234"). That is better and
 * still wrong in kind: it makes the answer depend on how a heading is worded, so a record's meaning
 * lives in its formatting. Whether a tag is in backticks was never evidence about anything, and
 * neither is whether somebody wrote "transmitted" or "sent".
 *
 * So a record declares its state, from a closed set, in a field. Anything else — a heading with no
 * state, a state nobody has defined, prose that happens to contain the word QUEUED, a fenced code
 * block demonstrating the syntax — is either not a record or is a record this cannot read, and the
 * difference between "no packets are owed" and "I could not tell" is the whole point of the module.
 * Unreadable fails closed as EVIDENCE_INSUFFICIENT. It never counts as zero.
 */

/** The states a staged packet can be in. Closed on purpose: an unlisted value is unreadable. */
export type PacketState =
  | "QUEUED_NOT_TRANSMITTED"
  | "TRANSMITTED"
  | "ARCHIVED"
  | "SUPERSEDED"
  | "WAITING_FOR_REMOTE_DECISION"
  | "HISTORICAL_EXAMPLE";

const KNOWN_STATES = new Set<string>([
  "QUEUED_NOT_TRANSMITTED",
  "TRANSMITTED",
  "ARCHIVED",
  "SUPERSEDED",
  "WAITING_FOR_REMOTE_DECISION",
  "HISTORICAL_EXAMPLE",
]);

/**
 * Only one state is an outbound debt.
 *
 * `WAITING_FOR_REMOTE_DECISION` deliberately is not: the packet has left, and what remains is
 * somebody else's turn. Counting it would make the preflight report a blocker that no amount of
 * work here can clear, which is the definition of a false blocker.
 */
const PENDING_STATES = new Set<PacketState>(["QUEUED_NOT_TRANSMITTED"]);

export interface StagedPacket {
  /** The protocol tag, e.g. ESCALATION or CLAUDE_APPLIED. */
  protocolId: string;
  /** The identifier inside the tag, e.g. ESC-009. */
  id: string;
  state: PacketState;
  /** The comment it went up as, where the record names one. */
  remoteCommentId: number | null;
  pending: boolean;
}

/** A record whose state could not be read. Named so the failure can be reported precisely. */
export interface UnreadableRecord {
  protocolId: string;
  id: string;
  /** What was found in place of a known state, or null when the field was absent entirely. */
  found: string | null;
}

export type QueueReading =
  | { readable: true; packets: StagedPacket[]; pending: number }
  | { readable: false; reason: string; unreadable: UnreadableRecord[] };

/**
 * A record heading. The tag is required; the backticks are not, and neither is anything after it.
 *
 * Deliberately permissive about FORMATTING and strict about STRUCTURE — the opposite of the
 * original, which was strict about backticks and had no notion of structure at all.
 */
const RECORD_HEADING = /^## +`?\[([A-Z_]+)\]\[([A-Z0-9-]+)\]`?/;

/** The state field, at the top level of a record body. `- state:` and `state:` both count. */
const STATE_FIELD = /^\s*-?\s*state:\s*([A-Za-z_]+)\s*$/;

/** The remote comment id, where the record carries one. */
const COMMENT_FIELD = /^\s*-?\s*remoteCommentId:\s*(\d+)\s*$/;

/**
 * Remove fenced code blocks before anything is parsed.
 *
 * A fenced block is an ILLUSTRATION of a record, not a record. This file stages the verbatim text
 * of packets inside fences, so without this the parser reads the staged content as more records —
 * and a document explaining the queue format would populate the queue.
 */
function withoutFences(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === null && opener) {
      fence = opener[1][0];
      continue;
    }
    if (fence !== null) {
      if (opener && opener[1][0] === fence) fence = null;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Every staged packet in the document, or a precise account of why it cannot be read.
 *
 * The caller gets `readable: false` rather than a number it cannot trust. That distinction is what
 * the preflight needs: "nothing is owed" and "I could not tell what is owed" are different facts,
 * and only one of them is evidence.
 */
export function readQueue(markdown: string): QueueReading {
  const lines = withoutFences(markdown).split("\n");

  const packets: StagedPacket[] = [];
  const unreadable: UnreadableRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = RECORD_HEADING.exec(lines[index]);
    if (!heading) continue;

    const [, protocolId, id] = heading;
    let state: string | null = null;
    let remoteCommentId: number | null = null;

    // The record body runs to the next heading of any level, so a record cannot inherit a field
    // from the one after it.
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^#{1,6} /.test(lines[cursor])) break;
      const stateMatch = STATE_FIELD.exec(lines[cursor]);
      if (stateMatch) state = stateMatch[1].toUpperCase();
      const commentMatch = COMMENT_FIELD.exec(lines[cursor]);
      if (commentMatch) remoteCommentId = Number(commentMatch[1]);
    }

    if (state === null || !KNOWN_STATES.has(state)) {
      unreadable.push({ protocolId, id, found: state });
      continue;
    }

    packets.push({
      protocolId,
      id,
      state: state as PacketState,
      remoteCommentId,
      pending: PENDING_STATES.has(state as PacketState),
    });
  }

  if (unreadable.length > 0) {
    const described = unreadable
      .map((r) => `[${r.protocolId}][${r.id}] (${r.found ?? "no state field"})`)
      .join(", ");
    return {
      readable: false,
      reason: `${unreadable.length} record(s) declare no state this parser recognises: ${described}. Unreadable is not empty.`,
      unreadable,
    };
  }

  return { readable: true, packets, pending: packets.filter((p) => p.pending).length };
}

/**
 * Packets still owed, or `null` when the document cannot be read.
 *
 * `null` rather than `0`, because the caller must be able to tell them apart. Every earlier
 * version of this returned a number in both cases.
 */
export function countPendingEscalations(markdown: string): number | null {
  const reading = readQueue(markdown);
  return reading.readable ? reading.pending : null;
}
