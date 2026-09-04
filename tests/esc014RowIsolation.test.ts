import { describe, expect, it } from "vitest";
import {
  emptyState,
  entryKind,
  ingestComments,
  resolveInboxEntry,
  unprocessedDecisions,
  type ControlBusState,
} from "@/server/controlbus/state";

/**
 * `[CHATGPT_DECISION][MKT-ESC014-STAT-260902-0348]` — a status transition must name ONE ROW.
 *
 * ESC-014 deliberately stopped deduplicating advisory rows by protocol id, because one exchange
 * carries many reviews and collapsing them would discard the history. `resolveInboxEntry` still
 * matched on `entry.protocolId === protocolId`, so the moment advisory rows became durable,
 * resolving the decision stamped every comment on the same exchange `APPLIED` beside it.
 *
 * The invariant `INGESTED != AUTHORITATIVE != APPLIED` held at the SCHEDULING boundary and leaked
 * at the STATUS boundary: one side enforced, one side not — arriving this time as a consequence of
 * my own change rather than someone else's.
 *
 * Every control below builds ONE exchange with a decision and two advisory rows sharing an id, so
 * the aliasing is present in the fixture and has to be refused rather than avoided.
 */
describe("resolving a decision does not stamp the evidence beside it", () => {
  const ID = "ESC-778";
  const AUTHOR = "jyun121388-spec";

  const comment = (id: number, tag: string) => ({
    id,
    body: `[${tag}][MARKET-OS][${ID}]\n\nsame body, different tag`,
    user: { login: AUTHOR },
    created_at: "2026-09-02T00:00:00Z",
  });

  /** One decision and two reviews, all on the same exchange. */
  const exchange = (): ControlBusState =>
    ingestComments(
      emptyState(2),
      [
        comment(701, "CHATGPT_DECISION"),
        comment(702, "CHATGPT_VERIFIED"),
        comment(703, "CHATGPT_ARCHITECT_GUIDANCE"),
      ],
      "2026-09-02T00:00:00Z",
    ).state;

  const rowsByComment = (state: ControlBusState) =>
    Object.fromEntries(state.inbox.map((e) => [e.githubCommentId, e]));

  it("builds the aliasing fixture the repair is about", () => {
    // If this stopped holding, every control below would pass by not exercising the hazard.
    const state = exchange();
    expect(state.inbox).toHaveLength(3);
    expect(new Set(state.inbox.map((e) => e.protocolId))).toEqual(new Set([ID]));
    expect(state.inbox.map((e) => entryKind(e))).toEqual([
      "CHATGPT_DECISION",
      "CHATGPT_VERIFIED",
      "CHATGPT_ARCHITECT_GUIDANCE",
    ]);
  });

  it("moves the decision through VALIDATED and APPLIED and touches nothing else", () => {
    let state = exchange();

    for (const status of ["VALIDATED", "APPLIED"] as const) {
      const outcome = resolveInboxEntry(
        state,
        { protocolId: ID, githubCommentId: 701 },
        status,
        `moved to ${status}`,
      );
      expect(outcome.resolved, status).toBe(true);
      if (!outcome.resolved) return;
      state = outcome.state;

      const rows = rowsByComment(state);
      expect(rows[701].status, status).toBe(status);
      // The two rows that merely commented on the same exchange.
      expect(rows[702].status, `VERIFIED after ${status}`).toBe("RECEIVED_UNVALIDATED");
      expect(rows[703].status, `GUIDANCE after ${status}`).toBe("RECEIVED_UNVALIDATED");
      expect(rows[702].note, "evidence must not acquire a decision's note").toBeUndefined();
    }
  });

  it("isolates a rejection exactly as strictly as an application", () => {
    // Rejecting the decision must not mark the review REJECTED. Whether evidence ever gets a state
    // of its own is a later decision; today it stays evidence.
    const outcome = resolveInboxEntry(
      exchange(),
      { protocolId: ID, githubCommentId: 701 },
      "REJECTED",
      "stale against HEAD",
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    const rows = rowsByComment(outcome.state);
    expect(rows[701].status).toBe("REJECTED");
    expect(rows[702].status).toBe("RECEIVED_UNVALIDATED");
    expect(rows[703].status).toBe("RECEIVED_UNVALIDATED");
  });

  it("refuses to resolve an advisory row addressed directly and by exact identity", () => {
    // THE negative control. The caller names the exact comment, so exactness alone is not the
    // guard: the row must also be authority-bearing.
    for (const commentId of [702, 703]) {
      const outcome = resolveInboxEntry(
        exchange(),
        { protocolId: ID, githubCommentId: commentId },
        "APPLIED",
        "should not happen",
      );
      expect(outcome.resolved, String(commentId)).toBe(false);
      if (outcome.resolved) return;
      expect(outcome.reason).toMatch(/durable evidence and cannot carry a decision status/);
      // And nothing moved.
      expect(rowsByComment(outcome.state)[commentId].status).toBe("RECEIVED_UNVALIDATED");
    }
  });

  it("says so rather than quietly doing nothing when the row does not exist", () => {
    const outcome = resolveInboxEntry(
      exchange(),
      { protocolId: ID, githubCommentId: 999 },
      "APPLIED",
      "nothing to apply to",
    );
    expect(outcome.resolved).toBe(false);
    if (outcome.resolved) return;
    expect(outcome.reason).toMatch(/no inbox row for comment 999/);
  });

  it("refuses a right comment id under the wrong protocol id", () => {
    // Both halves of the reference are checked. A comment id that exists is not a licence to
    // resolve it under whatever exchange the caller names.
    const outcome = resolveInboxEntry(
      exchange(),
      { protocolId: "ESC-OTHER", githubCommentId: 701 },
      "APPLIED",
      "wrong exchange",
    );
    expect(outcome.resolved).toBe(false);
  });

  it("stops counting the decision as startable, and never counted the evidence", () => {
    const state = exchange();
    expect(unprocessedDecisions(state).map((e) => e.githubCommentId)).toEqual([701]);

    const outcome = resolveInboxEntry(
      state,
      { protocolId: ID, githubCommentId: 701 },
      "APPLIED",
      "done",
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    expect(unprocessedDecisions(outcome.state)).toEqual([]);
  });
});
