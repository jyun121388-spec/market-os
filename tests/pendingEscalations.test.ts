import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countPendingEscalations, readQueue } from "@/server/release/pendingEscalations";

/**
 * The counter that told the release preflight a false blocker.
 *
 * It lived as a regex inside a script nothing imported, and it was wrong in two directions that
 * cancelled into a plausible number: backticks were required around the tag, so it saw one of three
 * headings, and it read a STAGED packet as an untransmitted one, so the heading it did see
 * described a comment posted days earlier. "1 escalation queued and not transmitted" was an
 * under-count of an over-count.
 *
 * The tests below are organised around the thing that actually went wrong. Formatting must not
 * change meaning, prose must not become a record, and an unreadable document must not read as an
 * empty one.
 */

const QUEUED = ["## `[ESCALATION][ESC-100]`", "", "- state: QUEUED_NOT_TRANSMITTED", ""].join("\n");

const TRANSMITTED = [
  "## `[ESCALATION][ESC-101]`",
  "",
  "- state: TRANSMITTED",
  "- remoteCommentId: 5349422884",
  "",
].join("\n");

describe("reading the escalation queue", () => {
  describe("records that are genuinely owed", () => {
    it("counts one queued packet", () => {
      expect(countPendingEscalations(QUEUED)).toBe(1);
    });

    it("counts three queued packets written three different ways", () => {
      // Backticks, no backticks, and a dash before the field. The original parser saw one of these
      // three; whether a heading is formatted as code is not evidence about anything.
      const doc = [
        "## `[ESCALATION][ESC-200]`",
        "",
        "- state: QUEUED_NOT_TRANSMITTED",
        "",
        "## [CLAUDE_APPLIED][ESC-201]",
        "",
        "state: QUEUED_NOT_TRANSMITTED",
        "",
        "##   `[ESCALATION][ESC-202]`  — with trailing prose in the heading",
        "",
        "  - state:  queued_not_transmitted  ",
        "",
      ].join("\n");
      const reading = readQueue(doc);
      expect(reading.readable).toBe(true);
      if (!reading.readable) return;
      expect(reading.packets.map((p) => p.id)).toEqual(["ESC-200", "ESC-201", "ESC-202"]);
      expect(reading.pending).toBe(3);
    });
  });

  describe("records that are not owed", () => {
    it.each([
      ["TRANSMITTED", TRANSMITTED],
      ["ARCHIVED", ["## `[ESCALATION][ESC-102]`", "", "- state: ARCHIVED", ""].join("\n")],
      ["SUPERSEDED", ["## `[ESCALATION][ESC-103]`", "", "- state: SUPERSEDED", ""].join("\n")],
      [
        "HISTORICAL_EXAMPLE",
        ["## `[ESCALATION][ESC-104]`", "", "- state: HISTORICAL_EXAMPLE", ""].join("\n"),
      ],
      [
        "WAITING_FOR_REMOTE_DECISION",
        ["## `[ESCALATION][ESC-105]`", "", "- state: WAITING_FOR_REMOTE_DECISION", ""].join("\n"),
      ],
    ])("does not count a %s record", (_state, doc) => {
      expect(countPendingEscalations(doc)).toBe(0);
    });

    it("does not treat WAITING_FOR_REMOTE_DECISION as an outbound debt", () => {
      // It has left. What remains is somebody else's turn, and counting it would report a blocker
      // that no amount of work here could clear.
      const doc = [
        "## `[ESCALATION][ESC-106]`",
        "",
        "- state: WAITING_FOR_REMOTE_DECISION",
        "",
      ].join("\n");
      const reading = readQueue(doc);
      expect(reading.readable).toBe(true);
      if (!reading.readable) return;
      expect(reading.packets[0].state).toBe("WAITING_FOR_REMOTE_DECISION");
      expect(reading.packets[0].pending).toBe(false);
    });
  });

  describe("text that is not a record", () => {
    it("ignores prose that merely mentions a state", () => {
      const doc = [
        "Some packets are QUEUED_NOT_TRANSMITTED until a credential exists.",
        "",
        "A record in state QUEUED_NOT_TRANSMITTED is still owed.",
        "",
      ].join("\n");
      expect(countPendingEscalations(doc)).toBe(0);
    });

    it("ignores a fenced block demonstrating the syntax", () => {
      // This file stages verbatim packet text inside fences. Without stripping them, a document
      // explaining the queue format would populate the queue.
      const doc = [
        "How to stage a packet:",
        "",
        "```markdown",
        "## `[ESCALATION][ESC-999]`",
        "",
        "- state: QUEUED_NOT_TRANSMITTED",
        "```",
        "",
      ].join("\n");
      expect(countPendingEscalations(doc)).toBe(0);
    });

    it("ignores a tilde-fenced block too", () => {
      const doc = [
        "~~~",
        "## `[ESCALATION][ESC-998]`",
        "- state: QUEUED_NOT_TRANSMITTED",
        "~~~",
      ].join("\n");
      expect(countPendingEscalations(doc)).toBe(0);
    });

    it("ignores headings that carry no protocol tag", () => {
      const doc = ["## Notes on the channel", "", "- state: QUEUED_NOT_TRANSMITTED", ""].join("\n");
      expect(readQueue(doc)).toEqual({ readable: true, packets: [], pending: 0 });
    });
  });

  describe("mixed states", () => {
    it("counts one pending among eight records", () => {
      const doc = [
        QUEUED,
        TRANSMITTED,
        ["## `[ESCALATION][ESC-300]`", "", "- state: TRANSMITTED", ""].join("\n"),
        ["## `[ESCALATION][ESC-301]`", "", "- state: TRANSMITTED", ""].join("\n"),
        ["## `[ESCALATION][ESC-302]`", "", "- state: ARCHIVED", ""].join("\n"),
        ["## `[ESCALATION][ESC-303]`", "", "- state: ARCHIVED", ""].join("\n"),
        ["## `[ESCALATION][ESC-304]`", "", "- state: ARCHIVED", ""].join("\n"),
        ["## `[ESCALATION][ESC-305]`", "", "- state: ARCHIVED", ""].join("\n"),
      ].join("\n");
      const reading = readQueue(doc);
      expect(reading.readable).toBe(true);
      if (!reading.readable) return;
      expect(reading.packets).toHaveLength(8);
      expect(reading.pending).toBe(1);
    });

    it("does not let a record inherit the next record's state", () => {
      const doc = [
        "## `[ESCALATION][ESC-400]`",
        "",
        "## `[ESCALATION][ESC-401]`",
        "",
        "- state: TRANSMITTED",
        "",
      ].join("\n");
      // ESC-400 has no state of its own, so the reading fails rather than borrowing one.
      const reading = readQueue(doc);
      expect(reading.readable).toBe(false);
      if (reading.readable) return;
      expect(reading.unreadable.map((r) => r.id)).toEqual(["ESC-400"]);
    });
  });

  describe("unreadable is not empty", () => {
    it("fails closed when a record declares no state", () => {
      const doc = "## `[ESCALATION][ESC-500]` — staged 2026-08-19, not yet posted\n\nsome body\n";
      const reading = readQueue(doc);
      expect(reading.readable).toBe(false);
      if (reading.readable) return;
      expect(reading.unreadable).toEqual([
        { protocolId: "ESCALATION", id: "ESC-500", found: null },
      ]);
      expect(countPendingEscalations(doc)).toBeNull();
    });

    it("fails closed on a state nobody has defined", () => {
      const doc = ["## `[ESCALATION][ESC-501]`", "", "- state: PROBABLY_FINE", ""].join("\n");
      const reading = readQueue(doc);
      expect(reading.readable).toBe(false);
      if (reading.readable) return;
      expect(reading.unreadable[0].found).toBe("PROBABLY_FINE");
      expect(countPendingEscalations(doc)).toBeNull();
    });

    it("names every unreadable record, not just the first", () => {
      const doc = [
        "## `[ESCALATION][ESC-502]`",
        "",
        "## `[ESCALATION][ESC-503]`",
        "",
        "- state: NOPE",
        "",
      ].join("\n");
      const reading = readQueue(doc);
      expect(reading.readable).toBe(false);
      if (reading.readable) return;
      expect(reading.unreadable.map((r) => r.id)).toEqual(["ESC-502", "ESC-503"]);
      expect(reading.reason).toMatch(/Unreadable is not empty/);
    });

    it("returns null rather than zero, so a caller cannot confuse them", () => {
      // Every earlier version of this returned a number in both cases, which is exactly how an
      // unreadable register became a clean one.
      expect(countPendingEscalations("## `[ESCALATION][ESC-504]`\n\nno state\n")).toBeNull();
      expect(countPendingEscalations(TRANSMITTED)).toBe(0);
    });
  });

  /**
   * The real document. The preflight reads THIS file, and every packet in it has been posted and
   * read back. If someone stages a new packet without a state field, this fails — which is the
   * behaviour that was missing when the count was wrong.
   */
  it("reports nothing owed in the repository's own staging archive", () => {
    const markdown = readFileSync(
      join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"),
      "utf8",
    );
    const reading = readQueue(markdown);
    expect(reading.readable, reading.readable ? "" : reading.reason).toBe(true);
    if (!reading.readable) return;
    expect(reading.packets.map((p) => p.id)).toEqual([
      "TEST-001",
      "TEST-002",
      "ESC-009",
      "ESC-012",
      "ESC-012",
      "ESC-012",
    ]);
    expect(reading.packets.map((p) => p.state)).toEqual([
      "TRANSMITTED",
      "TRANSMITTED",
      "TRANSMITTED",
      // The question, archived once its answer arrived. It briefly sat at
      // WAITING_FOR_REMOTE_DECISION, which was never an outbound debt either — the packet had
      // left and what remained was somebody else's turn.
      "ARCHIVED",
      // The first acknowledgement, superseded: independent verification returned REWORK_REQUIRED
      // and the record says so rather than being edited into correctness.
      "SUPERSEDED",
      // The corrected one.
      "TRANSMITTED",
    ]);
    expect(reading.packets.map((p) => p.remoteCommentId)).toEqual([
      5349296642, 5349417717, 5349422884, 5364659562, 5378536620, 5379907275,
    ]);
    expect(reading.pending).toBe(0);
  });
});
