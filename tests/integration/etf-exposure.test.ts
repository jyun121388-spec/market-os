import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_ETF_SOURCE";

describeIfDb("ETF exposure aggregation (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeSectorExposure: typeof import("@/server/domain/etfExposure").computeSectorExposure;
  let computeCountryExposure: typeof import("@/server/domain/etfExposure").computeCountryExposure;
  let etfId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeSectorExposure, computeCountryExposure } =
      await import("@/server/domain/etfExposure"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      const etfs = await prisma.etf.findMany({ where: { sourceId: existing.id } });
      for (const etf of etfs) {
        await prisma.etfHolding.deleteMany({ where: { etfId: etf.id } });
      }
      await prisma.etf.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test ETF Data Source", tier: "TIER_S" },
    });

    const etf = await prisma.etf.create({
      data: {
        sourceId: source.id,
        ticker: "TESTETF",
        name: "Test Broad Market ETF",
        issuer: "Test Issuer",
        trackedIndex: "Test 500",
        expenseRatio: "0.0300",
        asOfDate: new Date("2026-08-01T00:00:00.000Z"),
        raw: {},
      },
    });
    etfId = etf.id;

    await prisma.etfHolding.createMany({
      data: [
        { etfId, holdingName: "Company A", weightPct: "7.5", sector: "Technology", country: "US" },
        { etfId, holdingName: "Company B", weightPct: "5.0", sector: "Technology", country: "US" },
        { etfId, holdingName: "Company C", weightPct: "3.0", sector: "Healthcare", country: "US" },
        {
          etfId,
          holdingName: "Company D",
          weightPct: "2.0",
          sector: "Technology",
          country: "Japan",
        },
        { etfId, holdingName: "Company E", weightPct: "1.5", country: "US" }, // no sector recorded
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sums weights correctly per sector, sorted descending", () => {
    return computeSectorExposure(etfId).then((buckets) => {
      expect(buckets[0]).toEqual({ key: "Technology", totalWeightPct: 14.5, holdingCount: 3 });
      expect(buckets[1]).toEqual({ key: "Healthcare", totalWeightPct: 3, holdingCount: 1 });
      expect(buckets[2]).toEqual({ key: "Unclassified", totalWeightPct: 1.5, holdingCount: 1 });
    });
  });

  it("sums weights correctly per country", () => {
    return computeCountryExposure(etfId).then((buckets) => {
      const us = buckets.find((b) => b.key === "US")!;
      const japan = buckets.find((b) => b.key === "Japan")!;
      expect(us.totalWeightPct).toBe(17); // 7.5 + 5.0 + 3.0 + 1.5
      expect(japan.totalWeightPct).toBe(2);
    });
  });

  it("never includes a score/rating/recommendation field in its output", async () => {
    const buckets = await computeSectorExposure(etfId);
    for (const bucket of buckets) {
      expect(bucket).not.toHaveProperty("score");
      expect(bucket).not.toHaveProperty("rating");
      expect(bucket).not.toHaveProperty("recommendation");
      expect(Object.keys(bucket).sort()).toEqual(["holdingCount", "key", "totalWeightPct"]);
    }
  });
});
