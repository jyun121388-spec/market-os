import { describe, expect, it } from "vitest";
import {
  emptyState,
  entryKind,
  ingestComments,
  unjudgedInbound,
  unprocessedDecisions,
  type ControlBusState,
} from "@/server/controlbus/state";
import {
  ADVISORY_INBOUND_KINDS,
  ALL_PROTOCOL_KINDS,
  AUTHORITATIVE_KINDS,
  isAuthorityBearing,
  isKnownProtocolKind,
  OUTBOUND_KINDS,
  parseProtocolMessage,
} from "@/server/escalation/transport";

/**
 * `[CHATGPT_DECISION][ESC-014]` — Option B: widen DURABLE INGESTION to the nine measured inbound
 * kinds, leave APPLICATION AUTHORITY at `CHATGPT_DECISION` alone.
 *
 * The parser knew three kinds. `scripts/channel-kinds.ts` measured fourteen on the live issue, so
 * eleven were dropped — including `CHATGPT_VERIFIED`, the largest inbound kind and every review of
 * this session, which reached this repository only because a person read the issue by hand.
 *
 * `INGESTED != AUTHORITATIVE != APPLIED` has to be STRUCTURAL, so these controls hold the body, the
 * author, the project and the id constant and vary ONLY the kind. Anything that passed because the
 * fixture differed elsewhere would prove nothing.
 */
describe("ESC-014: nine kinds durable, one authoritative", () => {
  const AUTHOR = "jyun121388-spec";
  const BODY = "the identical body, whatever tag is on it";

  const comment = (id: number, tag: string) => ({
    id,
    body: `[${tag}][MARKET-OS][ESC-777]\n\n${BODY}`,
    user: { login: AUTHOR },
    created_at: "2026-09-02T00:00:00Z",
  });

  const inboundKinds = [...AUTHORITATIVE_KINDS, ...ADVISORY_INBOUND_KINDS];

  const ingestAll = (): { state: ControlBusState; admittedKinds: string[] } => {
    const comments = inboundKinds.map((k, i) => comment(1000 + i, k));
    const result = ingestComments(emptyState(2), comments, "2026-09-02T00:00:00Z");
    return { state: result.state, admittedKinds: result.admitted.map((e) => entryKind(e)) };
  };

  it("carries the nine kinds the channel was measured to carry", () => {
    // The list IS the protocol. If it drifts from what `channel-kinds.ts` measures, the parser is
    // dropping traffic again, which is the finding ESC-014 came from.
    expect(inboundKinds).toEqual([
      "CHATGPT_DECISION",
      "CHATGPT_VERIFIED",
      "CHATGPT_ARCHITECT_GUIDANCE",
      "CHATGPT_TASK",
      "CHATGPT_GUIDANCE",
      "CHATGPT_CORRECTION",
      "CHATGPT_REVIEW_GUIDANCE",
      "CHATGPT_REVIEW_POLICY",
      "CHATGPT_TRANSPORT_STATUS",
    ]);
    expect(ALL_PROTOCOL_KINDS).toHaveLength(11);
  });

  it("parses every one of them with its exact identity", () => {
    for (const kind of ALL_PROTOCOL_KINDS) {
      const message = parseProtocolMessage(comment(1, kind));
      expect(message?.kind, kind).toBe(kind);
      expect(message?.id, kind).toBe("ESC-777");
      expect(message?.project, kind).toBe("MARKET-OS");
    }
  });

  it("ingests all nine durably, with the kind recorded on the row", () => {
    const { state, admittedKinds } = ingestAll();
    expect(admittedKinds).toEqual(inboundKinds);
    expect(unjudgedInbound(state)).toHaveLength(9);
  });

  it("makes exactly one of them startable", () => {
    // THE control. Identical bodies, identical author, identical id — only the tag differs, and
    // only the decision may become work.
    const { state } = ingestAll();
    expect(unprocessedDecisions(state).map((e) => entryKind(e))).toEqual(["CHATGPT_DECISION"]);
  });

  it("keeps a VERIFIED non-startable whether it approves or demands rework", () => {
    // It can say APPROVED. That is a record that a review happened, not permission.
    for (const verdict of ["Status: `APPROVED`", "Status: `REWORK_REQUIRED`"]) {
      const result = ingestComments(
        emptyState(2),
        [
          {
            id: 5,
            body: `[CHATGPT_VERIFIED][ESC-777]\n\n${verdict}`,
            user: { login: AUTHOR },
            created_at: "2026-09-02T00:00:00Z",
          },
        ],
        "2026-09-02T00:00:00Z",
      );
      expect(result.admitted, verdict).toHaveLength(1);
      expect(unprocessedDecisions(result.state), verdict).toEqual([]);
    }
  });

  it("does not deduplicate advisory kinds by protocol id", () => {
    // One exchange carries many reviews, one per rework round — 48 on this channel at the time of
    // the decision. Collapsing them to the first would discard the review history.
    const result = ingestComments(
      emptyState(2),
      [comment(10, "CHATGPT_VERIFIED"), comment(11, "CHATGPT_VERIFIED")],
      "2026-09-02T00:00:00Z",
    );
    expect(result.admitted).toHaveLength(2);
  });

  it("still admits only one decision per protocol id", () => {
    const result = ingestComments(
      emptyState(2),
      [comment(20, "CHATGPT_DECISION"), comment(21, "CHATGPT_DECISION")],
      "2026-09-02T00:00:00Z",
    );
    expect(result.admitted).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/already been admitted/);
  });

  it("never admits what this repository wrote", () => {
    const result = ingestComments(
      emptyState(2),
      OUTBOUND_KINDS.map((k, i) => comment(30 + i, k)),
      "2026-09-02T00:00:00Z",
    );
    expect(result.admitted).toEqual([]);
  });

  it("reports an unknown kind rather than dropping it, and never admits it", () => {
    const result = ingestComments(
      emptyState(2),
      [comment(40, "CHATGPT_SOMETHING_NEW"), comment(41, "CHATGPT_DECISION")],
      "2026-09-02T00:00:00Z",
    );
    expect(result.admitted.map((e) => entryKind(e))).toEqual(["CHATGPT_DECISION"]);
    expect(result.skipped.map((s) => s.reason).join(" ")).toMatch(/unsupported protocol kind/);
    expect(isKnownProtocolKind("CHATGPT_SOMETHING_NEW")).toBe(false);
    expect(isAuthorityBearing("CHATGPT_SOMETHING_NEW")).toBe(false);
  });

  it("says nothing about ordinary prose, which is not a protocol message", () => {
    const result = ingestComments(
      emptyState(2),
      [
        {
          id: 50,
          body: "just a note between people",
          user: { login: AUTHOR },
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
      "2026-09-02T00:00:00Z",
    );
    expect(result.admitted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("does not re-admit anything on a redelivery", () => {
    // Widening ingestion must not replay history as new work. Every comment comes back on the next
    // poll; the comment-id set is what stops it counting twice.
    const comments = inboundKinds.map((k, i) => comment(1000 + i, k));
    const first = ingestComments(emptyState(2), comments, "2026-09-02T00:00:00Z");
    const second = ingestComments(first.state, comments, "2026-09-02T00:05:00Z");
    expect(second.admitted).toEqual([]);
    expect(unjudgedInbound(second.state)).toHaveLength(9);
  });

  it("reads a row written before the field existed as the decision it was", () => {
    // Not a convenience default: the ingestion that wrote those rows admitted nothing else, so the
    // value is recoverable from the code rather than guessed.
    expect(
      entryKind({
        protocolId: "X",
        githubCommentId: 1,
        receivedAt: "",
        author: "",
        body: "",
        status: "RECEIVED_UNVALIDATED",
      }),
    ).toBe("CHATGPT_DECISION");
  });

  it("routes every execution-facing question through one classifier", () => {
    expect(isAuthorityBearing("CHATGPT_DECISION")).toBe(true);
    for (const kind of [...ADVISORY_INBOUND_KINDS, ...OUTBOUND_KINDS]) {
      expect(isAuthorityBearing(kind), kind).toBe(false);
    }
  });
});
