import { describe, expect, it } from "vitest";
import {
  describeTransport,
  parseProtocolMessage,
  queuePendingComment,
  reconcile,
  type PendingComment,
  type RemoteComment,
} from "@/server/escalation/transport";

/**
 * The escalation channel's state machine, tested without touching GitHub.
 *
 * Every case here is one the live channel will eventually produce and none of them can be
 * rehearsed against the real issue: a duplicate acknowledgement, a decision with no escalation
 * behind it, the same comment processed twice after a restart, an acknowledgement that could not
 * be posted. Making the module pure is what buys that, and it is why the reading and writing live
 * in the calling script rather than here.
 *
 * The property under all of them: **transport state is not decision state.** A decision can be
 * applied in full while its acknowledgement sits unposted for want of a credential, and conflating
 * the two would either make a missing token look like unfinished engineering or — worse — make an
 * unposted acknowledgement look like an unapplied decision and invite doing the work twice.
 */

let nextId = 1000;
const comment = (body: string, login = "jyun121388-spec"): RemoteComment => ({
  id: nextId++,
  user: { login },
  body,
  created_at: "2026-08-19T00:00:00Z",
});

const empty = { appliedIds: [], pendingAckIds: [], pendingEscalationIds: [] };

describe("reading a protocol tag", () => {
  it("reads the three kinds and their id", () => {
    for (const kind of ["ESCALATION", "CHATGPT_DECISION", "CLAUDE_APPLIED"] as const) {
      const parsed = parseProtocolMessage(comment(`[${kind}][ESC-042]\n\nbody`));
      expect(parsed?.kind).toBe(kind);
      expect(parsed?.id).toBe("ESC-042");
    }
  });

  it("ignores ordinary prose rather than calling it malformed", () => {
    // The issue is a human-readable thread. Treating a side remark as an error would make the
    // channel unusable for the humans who also read it.
    expect(parseProtocolMessage(comment("Just a note about the release."))).toBeNull();
  });

  it.each([
    "[ESCALATION] ESC-042",
    "[ESCALATION][esc-042]",
    "[UNKNOWN_KIND][ESC-042]",
    "[CHATGPT_DECISION][]",
  ])("refuses a malformed tag rather than guessing: %s", (body) => {
    expect(parseProtocolMessage(comment(body))).toBeNull();
  });

  it("surfaces a bracketed-but-invalid tag as malformed, not as prose", () => {
    // A typo in a tag is the dangerous case — it looks deliberate. It must be visible rather than
    // silently ignored like prose.
    const state = reconcile([comment("[ESCALATON][ESC-042] typo in the kind")], empty);
    expect(state.malformed).toHaveLength(1);
    expect(state.exchanges).toHaveLength(0);
  });
});

describe("a decision with no escalation behind it", () => {
  /**
   * This is TEST-001's exact shape, and the reason the state exists instead of an exception. A
   * decision nobody asked for may be a test, a stray, or aimed at another repository, and applying
   * it would be acting on an instruction this repository never requested.
   */
  it("is recorded as invalid and not applied", () => {
    const state = reconcile(
      [comment("[CHATGPT_DECISION][TEST-001]\nDecision: ACKNOWLEDGED")],
      empty,
    );
    expect(state.exchanges[0].state).toBe("DECISION_INVALID");
    expect(state.exchanges[0].applied).toBe(false);
    expect(state.exchanges[0].note).toContain("no matching [ESCALATION]");
  });

  it("becomes receivable once the escalation is there too", () => {
    const state = reconcile(
      [comment("[ESCALATION][ESC-042]\nquestion"), comment("[CHATGPT_DECISION][ESC-042]\nanswer")],
      empty,
    );
    expect(state.exchanges[0].state).toBe("DECISION_RECEIVED");
  });
});

describe("transport state is not decision state", () => {
  const posted = [
    comment("[ESCALATION][ESC-042]\nquestion"),
    comment("[CHATGPT_DECISION][ESC-042]\nanswer"),
  ];

  it("reports an applied decision whose acknowledgement is stuck as ACK_PENDING", () => {
    const state = reconcile(posted, {
      appliedIds: ["ESC-042"],
      pendingAckIds: ["ESC-042"],
      pendingEscalationIds: [],
    });
    expect(state.exchanges[0].state).toBe("ACK_PENDING");
    // The engineering is done. Only the comment is missing, and the note says which is which.
    expect(state.exchanges[0].applied).toBe(true);
    expect(state.exchanges[0].ackPosted).toBe(false);
    expect(state.exchanges[0].note).toContain("Transport, not engineering");
  });

  it("does not treat a posted acknowledgement as proof the work happened elsewhere", () => {
    // Remote is authoritative on what was POSTED, local on what was APPLIED. A posted ack closes
    // the exchange, and that is the one direction where remote settles both.
    const state = reconcile([...posted, comment("[CLAUDE_APPLIED][ESC-042]\ndone")], empty);
    expect(state.exchanges[0].state).toBe("ACK_POSTED");
  });
});

describe("replay after restart", () => {
  it("identifies comments by id, never by timestamp", () => {
    // Two comments in the same second is ordinary, and this project has already been bitten by a
    // timestamp used as identity — twice, on `timestamp(3)`.
    const a = { ...comment("[ESCALATION][ESC-1]"), created_at: "2026-08-19T00:00:00Z" };
    const b = { ...comment("[CHATGPT_DECISION][ESC-1]"), created_at: "2026-08-19T00:00:00Z" };
    const state = reconcile([a, b], empty);
    expect(state.lastCommentId).toBe(Math.max(a.id, b.id));
    expect(state.exchanges).toHaveLength(1);
  });

  it("produces the same state when the same comments are processed twice", () => {
    const comments = [comment("[ESCALATION][ESC-7]"), comment("[CHATGPT_DECISION][ESC-7]")];
    expect(reconcile(comments, empty)).toEqual(reconcile(comments, empty));
  });

  it("reports nothing rather than guessing when the issue is empty", () => {
    const state = reconcile([], empty);
    expect(state.exchanges).toEqual([]);
    expect(state.lastCommentId).toBeNull();
  });
});

describe("the pending queue", () => {
  const pending = (id: string): PendingComment => ({
    kind: "CLAUDE_APPLIED",
    id,
    body: `[CLAUDE_APPLIED][${id}]`,
    createdAt: "2026-08-19T00:00:00Z",
    reasonNotPosted: "no GitHub write credential (HG-001)",
    retryCondition: "CREDENTIAL_STATE_CHANGED",
  });

  it("does not queue the same message twice", () => {
    // The queue is flushed whenever a credential appears. One duplicate per attempt would post the
    // same acknowledgement several times the moment one succeeds.
    const once = queuePendingComment([], pending("ESC-9"), reconcile([], empty));
    const twice = queuePendingComment(once, pending("ESC-9"), reconcile([], empty));
    expect(twice).toHaveLength(1);
  });

  it("does not queue an acknowledgement that is already on the issue", () => {
    const channel = reconcile(
      [comment("[ESCALATION][ESC-9]"), comment("[CLAUDE_APPLIED][ESC-9]")],
      empty,
    );
    expect(queuePendingComment([], pending("ESC-9"), channel)).toEqual([]);
  });

  it("retries on a credential change, never on elapsed time", () => {
    // Nothing about this improves by waiting, and a time-based retry would busy-poll a public API
    // for a state that only a human can change.
    expect(pending("ESC-9").retryCondition).toBe("CREDENTIAL_STATE_CHANGED");
  });
});

describe("naming the transport state honestly", () => {
  it("is WRITE_PENDING_AUTH when reading works and there is no credential", () => {
    expect(
      describeTransport({ readVerified: true, write: "NO_CREDENTIAL", ackReadBack: false }),
    ).toBe("WRITE_PENDING_AUTH");
  });

  /**
   * A successful POST is not evidence the channel works; the round trip is. This project has
   * already reported a green E2E run from a server that was not running the code under test.
   */
  it("is only FULL_DUPLEX_VERIFIED once a write has been read back", () => {
    expect(
      describeTransport({ readVerified: true, write: "WRITE_AVAILABLE", ackReadBack: false }),
    ).toBe("HALF_DUPLEX");
    expect(
      describeTransport({ readVerified: true, write: "WRITE_AVAILABLE", ackReadBack: true }),
    ).toBe("FULL_DUPLEX_VERIFIED");
  });

  it("is degraded when even reading fails", () => {
    expect(
      describeTransport({ readVerified: false, write: "WRITE_AVAILABLE", ackReadBack: true }),
    ).toBe("TRANSPORT_DEGRADED");
  });
});
