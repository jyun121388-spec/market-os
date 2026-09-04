import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_ANALOG_SOURCE";

// Hand-designed so the nearest-3 historical trailing changes to "current" (day 9, change=6)
// are exactly days 1, 3, 5 (each at distance 1), and every other day is farther away —
// see docs/DECISIONS.md for the similarity methodology this exercises.
const VALUES = [0, 5, 3, 8, 2, 9, -1, 12, 0, 6];

describeIfDb("computeHistoricalAnalog (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeHistoricalAnalog: typeof import("@/server/domain/historicalAnalog").computeHistoricalAnalog;
  let seriesId: string;
  let sparseSeriesId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeHistoricalAnalog } = await import("@/server/domain/historicalAnalog"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Analog Source", tier: "TIER_S" },
    });

    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "ANALOG10",
        name: "Test Analog Series",
        unit: "index",
        frequency: "daily",
      },
    });
    seriesId = series.id;

    for (let i = 0; i < VALUES.length; i++) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: new Date(Date.UTC(2026, 0, 1 + i)),
          value: String(VALUES[i]),
          raw: {},
        },
      });
    }

    const sparseSeries = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "SPARSEANALOG",
        name: "Sparse Analog Series",
        unit: "index",
        frequency: "daily",
      },
    });
    sparseSeriesId = sparseSeries.id;
    await prisma.observation.create({
      data: {
        seriesId: sparseSeries.id,
        sourceId: source.id,
        observationDate: new Date("2026-08-01T00:00:00.000Z"),
        value: "1.0",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finds the 3 nearest historical trailing changes by similarity", async () => {
    const result = await computeHistoricalAnalog(seriesId, { windowSize: 1, topK: 3 });

    expect(result.status).toBe("COMPUTED");
    expect(result.currentTrailingChange).toBe(6); // v9 - v8 = 6 - 0
    expect(result.sampleSize).toBe(8); // days 1..8

    const matchedDates = result.matches.map((m) => m.asOfDate).sort();
    expect(matchedDates).toEqual(["2026-01-02", "2026-01-04", "2026-01-06"]); // days 1, 3, 5
  });

  it("computes real subsequent changes from the matched historical points, with null when out of range", async () => {
    const result = await computeHistoricalAnalog(seriesId, { windowSize: 1, topK: 3 });

    const day5Match = result.matches.find((m) => m.asOfDate === "2026-01-06")!; // index 5
    expect(day5Match.subsequentChange1).toBe(-10); // v6 - v5 = -1 - 9
    expect(day5Match.subsequentChange3).toBe(-9); // v8 - v5 = 0 - 9
    expect(day5Match.subsequentChange6).toBeNull(); // index 11 is out of range (only 10 points)

    const day1Match = result.matches.find((m) => m.asOfDate === "2026-01-02")!; // index 1
    expect(day1Match.subsequentChange1).toBe(-2); // v2 - v1 = 3 - 5
    expect(day1Match.subsequentChange6).toBe(7); // v7 - v1 = 12 - 5
  });

  it("always includes a non-empty limitations disclaimer, regardless of result quality", async () => {
    const result = await computeHistoricalAnalog(seriesId, { windowSize: 1 });
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations.toLowerCase()).toContain("not a prediction");
  });

  it("returns INSUFFICIENT_DATA for a series with too little history, never fabricating an analog", async () => {
    const result = await computeHistoricalAnalog(sparseSeriesId, { windowSize: 1 });
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.matches).toHaveLength(0);
    expect(result.limitations.length).toBeGreaterThan(0); // present even when insufficient
  });
});
