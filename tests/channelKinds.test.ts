import { describe, expect, it } from "vitest";
import { PARSED_KINDS, tally } from "../scripts/channel-kinds";

/**
 * `CLAUDE.md` says the channel has carried five inbound kinds. Measured against the real issue it
 * has carried NINE, and the four it omits include `CHATGPT_TASK` at twenty comments — larger than
 * two of the kinds it does name. A prose inventory of what a channel carries drifts the moment the
 * channel carries something new, and nothing notices; that is what this module exists to replace.
 *
 * These controls bind the counting rule, not the counts. The counts are a fact about a live issue
 * and belong in a run, not in a fixture.
 */
describe("counting what the channel actually carries", () => {
  it("counts only a tag that LEADS the body", () => {
    // A protocol tag is the first thing in a comment. Matching one anywhere would count every
    // report that quotes a tag in its prose — and this session's reports quote several each.
    const rows = tally([
      "[CHATGPT_DECISION][ESC-1]\n\nbody",
      "some prose mentioning [CHATGPT_DECISION] in passing",
      "  \n[CLAUDE_APPLIED][ESC-1]\n\nbody",
    ]);
    expect(rows).toEqual([
      { kind: "CHATGPT_DECISION", count: 1, parsed: true, direction: "inbound" },
      { kind: "CLAUDE_APPLIED", count: 1, parsed: true, direction: "outbound" },
    ]);
  });

  it("marks a kind the parser does not admit as dropped", () => {
    const rows = tally(["[CHATGPT_ARCHITECT_GUIDANCE][X]\n\nbody"]);
    expect(rows[0].parsed).toBe(false);
    expect(PARSED_KINDS).not.toContain("CHATGPT_ARCHITECT_GUIDANCE");
  });

  it("separates what arrives from what this repository writes", () => {
    const rows = tally([
      "[ESCALATION][ESC-1]\n\nq",
      "[CLAUDE_PROGRESS]\n\nnote",
      "[CHATGPT_TASK]\n\ninstruction",
    ]);
    expect(
      rows
        .filter((r) => r.direction === "outbound")
        .map((r) => r.kind)
        .sort(),
    ).toEqual(["CLAUDE_PROGRESS", "ESCALATION"]);
    expect(rows.filter((r) => r.direction === "inbound").map((r) => r.kind)).toEqual([
      "CHATGPT_TASK",
    ]);
  });

  it("orders by count, then by name, so two runs of the same data agree", () => {
    const rows = tally([
      "[CHATGPT_TASK]\na",
      "[CHATGPT_TASK]\nb",
      "[CHATGPT_GUIDANCE]\nc",
      "[CHATGPT_CORRECTION]\nd",
    ]);
    expect(rows.map((r) => r.kind)).toEqual([
      "CHATGPT_TASK",
      "CHATGPT_CORRECTION",
      "CHATGPT_GUIDANCE",
    ]);
  });

  it("ignores a body with no tag at all rather than inventing one", () => {
    expect(tally(["", "just a comment", "\n\n"])).toEqual([]);
  });
});
