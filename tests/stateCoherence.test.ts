import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUTHORITY_BEARING_DOCUMENTS,
  checkCoherence,
  type CoherenceFinding,
} from "../scripts/state-coherence";
import { parseGateRegister } from "../scripts/autonomy-context";

/**
 * The documents must agree with the register.
 *
 * Nothing in this repository was asking that question, and the cost of not asking was a full day
 * in which `docs/HUMAN_GATE_QUEUE.md` described the ECOS and OpenDART credentials as open Human
 * Gates while a ledger entry recorded them closed. Both statements were durable, both were
 * authority-bearing, and the contradiction was invisible because governance claims live in prose
 * and prose was compared to nothing.
 *
 * This is the comparison. It runs against the REAL documents — a control that checks a copy passes
 * while the original drifts, which is that failure's exact shape.
 */

describe("authority-bearing documents against the gate register", () => {
  it("carries no document that says an open gate is closed", () => {
    const findings = checkCoherence();
    expect(
      findings.map((f: CoherenceFinding) => `${f.file}:${f.line} claims ${f.gate} is closed`),
    ).toEqual([]);
  });

  it("checks the documents that actually carry authority", () => {
    // A checker pointed at nothing passes. The list is asserted so that shrinking it to make a
    // failure go away is itself a visible change.
    expect(AUTHORITY_BEARING_DOCUMENTS).toContain("docs/PROJECT_STATE.md");
    expect(AUTHORITY_BEARING_DOCUMENTS).toContain("docs/CURRENT_TASK.md");
    expect(AUTHORITY_BEARING_DOCUMENTS).toContain("docs/RELEASE_READINESS.md");
    for (const path of AUTHORITY_BEARING_DOCUMENTS) {
      expect(() => readFileSync(path, "utf8"), `${path} is listed but missing`).not.toThrow();
    }
  });

  it("would catch the drift it was built for", () => {
    // The discrimination, on a fabricated document rather than by tampering with a real one: a
    // sentence asserting HG-003 closed, while the register says otherwise, must be found.
    const register = parseGateRegister(readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8"));
    expect(register.get("HG-003")).not.toBe("RESOLVED");

    const findings = checkCoherence(["tests/fixtures/driftedState.md"]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].gate).toBe("HG-003");
    expect(findings[0].registerSays).toBe("PENDING_USER");
  });

  it("does not fire on a sentence that is about the correction", () => {
    // The failure mode this project keeps re-learning: a substring scan reporting a denial as the
    // offence. IR-148's own prose says HG-003 was written LIVE_VERIFIED and that it was withdrawn,
    // and a checker that flagged that would be unusable in the repository it exists to protect.
    const findings = checkCoherence(["tests/fixtures/correctedState.md"]);
    expect(findings).toEqual([]);
  });

  it("does not fire when one line names several gates in different states", () => {
    // `FRED_API_KEY (present, HG-002 resolved), ECOS_API_KEY (HG-003 pending)` is a true sentence,
    // and a line-wide match reported it as two contradictions. A checker with false positives is
    // a checker somebody switches off, so the match is scoped to a window after each mention.
    const findings = checkCoherence(["tests/fixtures/mixedGateLine.md"]);
    expect(findings).toEqual([]);
  });
});
