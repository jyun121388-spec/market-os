import { describe, expect, it } from "vitest";
import { checkTreeBinding, compareStartToSource, formatBinding } from "../scripts/e2e-tree-binding";

/**
 * SR-02's binding check, held to what it is allowed to claim.
 *
 * The incident was an E2E pass reported from a server started before the fix under test. The
 * existing mitigation is an overridable port, which avoids the collision without checking anything.
 * These tests pin the three verdicts and, just as importantly, pin the module's refusal to call a
 * run evidence when it cannot establish the binding.
 */

const at = (iso: string) => new Date(iso);

describe("comparing server start time against the newest source write", () => {
  /**
   * The discriminating pair, reproduced by hand before this test existed: a stub listener on 3000
   * read BOUND, then `touch`ing one file under `src/` flipped the SAME process to STALE with
   * nothing else changed. That is SR-02's incident shape exactly, and it is the case the whole
   * module exists for.
   */
  it("calls a process STALE when it started before a source file was written", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:29.990Z"), {
      file: "src/server/fabric/providerCapability.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("STALE");
    expect(decided.reason).toContain("BEFORE");
    expect(decided.reason).toContain("providerCapability.ts");
  });

  it("calls it BOUND when it started after every source write", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:54.038Z"), {
      file: "src/server/fabric/providerCapability.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("BOUND");
  });

  /**
   * A millisecond apart in the other direction is still STALE. The comparison is an ordering, not
   * a tolerance: a window inside which "close enough" counts as fresh would be the same guess the
   * overridable port already was.
   */
  it("has no grace window", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:54.036Z"), {
      file: "src/x.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("STALE");
  });

  it("is UNPROVEN, never BOUND, when either side is missing", () => {
    expect(
      compareStartToSource(null, { file: "src/x.ts", mtime: at("2026-01-01T00:00:00Z") }).verdict,
    ).toBe("UNPROVEN");
    expect(compareStartToSource(at("2026-01-01T00:00:00Z"), null).verdict).toBe("UNPROVEN");
  });
});

describe("what the report is allowed to imply", () => {
  /**
   * Port 1 is a privileged port nothing in this project listens on, so there is no process to
   * identify and the verdict must be UNPROVEN rather than a pass by absence. "Nobody answered" is
   * the least informative possible state, and it is exactly where a checker is most tempted to
   * shrug and continue.
   */
  const binding = checkTreeBinding("http://localhost:1");

  it("treats an unidentifiable listener as UNPROVEN rather than fine", () => {
    expect(binding.verdict).toBe("UNPROVEN");
  });

  it("records what it observed even when nothing was decided by it", () => {
    // The observations are the point of the report: a reader who disagrees with the verdict can
    // still see the inputs. `headSha` and the newest source file come from the real repository.
    expect(binding.observed.url).toBe("http://localhost:1");
    expect(binding.observed.port).toBe(1);
    expect(binding.observed.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(binding.observed.newestSourceFile).toBeTruthy();
    expect(binding.observed.listenerPid).toBeNull();
  });

  /**
   * The limitations are load-bearing prose, not decoration. Each names a thing that was MEASURED
   * to be unavailable on this machine, and dropping one would let the report read as a stronger
   * claim than the code can support.
   */
  it("states the limits of the binding, including the shared node_modules finding", () => {
    expect(binding.limitations.length).toBeGreaterThanOrEqual(3);
    expect(binding.limitations.join(" ")).toContain("node_modules");
    expect(binding.limitations.join(" ")).toContain("recompiles");
  });

  it("says outright that a non-BOUND run is not evidence about the tree", () => {
    const text = formatBinding(binding);
    expect(text).toContain("NOT evidence about the current tree");
    expect(text).toContain("UNPROVEN");
  });

  it("does not print that disclaimer when the binding actually holds", () => {
    // Guards against the disclaimer becoming boilerplate that appears on every run and therefore
    // stops being read.
    const bound = formatBinding({
      verdict: "BOUND",
      reason: "test",
      observed: { ...binding.observed },
      limitations: binding.limitations,
    });
    expect(bound).not.toContain("NOT evidence about the current tree");
  });
});
