import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("causal graph (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let getEdgesFrom: typeof import("@/server/domain/causalGraph").getEdgesFrom;
  let getEdgesTo: typeof import("@/server/domain/causalGraph").getEdgesTo;
  let getDirectEdge: typeof import("@/server/domain/causalGraph").getDirectEdge;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ getEdgesFrom, getEdgesTo, getDirectEdge } = await import("@/server/domain/causalGraph"));

    const existing = await prisma.causalEdge.findFirst({
      where: { fromVariable: "TEST: Widget demand", toVariable: "TEST: Widget price" },
    });
    if (existing) {
      await prisma.causalEdge.delete({ where: { id: existing.id } });
    }

    await prisma.causalEdge.create({
      data: {
        fromVariable: "TEST: Widget demand",
        toVariable: "TEST: Widget price",
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "Basic supply/demand — a test fixture, not a real economic claim.",
        evidence: "Test fixture.",
        lag: "immediate",
        counterexamples: "Price controls or oversupply can break this relationship.",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("getEdgesFrom finds edges by exact fromVariable match", async () => {
    const edges = await getEdgesFrom("TEST: Widget demand");
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].toVariable).toBe("TEST: Widget price");
    expect(edges[0].counterexamples.length).toBeGreaterThan(0);
  });

  it("getEdgesTo finds edges by exact toVariable match", async () => {
    const edges = await getEdgesTo("TEST: Widget price");
    expect(edges.some((e) => e.fromVariable === "TEST: Widget demand")).toBe(true);
  });

  it("getDirectEdge returns the full edge including its required counterexamples, not a bare boolean", async () => {
    const edge = await getDirectEdge("TEST: Widget demand", "TEST: Widget price");
    expect(edge).not.toBeNull();
    expect(edge!.confidence).toBe("MEDIUM");
    expect(edge!.counterexamples).toContain("Price controls");
  });

  it("getDirectEdge returns null for a nonexistent relationship rather than fabricating one", async () => {
    const edge = await getDirectEdge("TEST: Nonexistent A", "TEST: Nonexistent B");
    expect(edge).toBeNull();
  });

  it("does not fuzzy-match a similar-but-different variable name", async () => {
    const edges = await getEdgesFrom("TEST: Widget Demand"); // different case
    expect(edges).toHaveLength(0);
  });
});
