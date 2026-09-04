import { describe, expect, it } from "vitest";
import { CAUSAL_EDGES } from "../prisma/causalEdges";

describe("initial causal edge seed data", () => {
  it("has at least 5 edges", () => {
    expect(CAUSAL_EDGES.length).toBeGreaterThanOrEqual(5);
  });

  it("requires a non-empty counterexamples field on every edge", () => {
    for (const edge of CAUSAL_EDGES) {
      expect(edge.counterexamples.trim().length).toBeGreaterThan(0);
    }
  });

  it("requires a non-empty evidence and lag field on every edge", () => {
    for (const edge of CAUSAL_EDGES) {
      expect(edge.evidence.trim().length).toBeGreaterThan(0);
      expect(edge.lag.trim().length).toBeGreaterThan(0);
    }
  });

  it("never claims HIGH confidence for a merely-correlational relationship", () => {
    const yieldCurveEdge = CAUSAL_EDGES.find((e) => e.toVariable.includes("recession"));
    expect(yieldCurveEdge).toBeDefined();
    expect(yieldCurveEdge!.confidence).not.toBe("HIGH");
  });
});
