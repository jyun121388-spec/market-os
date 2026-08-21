import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_REAL_ESTATE_SOURCE";
const REGION = "TEST_강남구";
const AS_OF = new Date("2026-08-15T00:00:00.000Z");

describeIfDb("computeRegionalPriceChange (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeRegionalPriceChange: typeof import("@/server/domain/realEstateAnalysis").computeRegionalPriceChange;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeRegionalPriceChange } = await import("@/server/domain/realEstateAnalysis"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.realEstateTransaction.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Real Estate Source", tier: "TIER_S" },
    });
    sourceId = source.id;

    const currentWindowPrices = [10000, 11000, 12000]; // price/sqm: 100, 110, 120 -> median 110
    const currentDates = ["2026-07-20", "2026-07-25", "2026-08-01"];
    const previousWindowPrices = [9000, 9500, 10000]; // price/sqm: 90, 95, 100 -> median 95
    const previousDates = ["2026-06-20", "2026-06-25", "2026-07-01"];

    for (let i = 0; i < 3; i++) {
      await prisma.realEstateTransaction.create({
        data: {
          sourceId,
          region: REGION,
          propertyType: "아파트",
          dealType: "SALE",
          areaSqm: "100.00",
          price: String(currentWindowPrices[i]),
          dealDate: new Date(`${currentDates[i]}T00:00:00.000Z`),
          raw: {},
        },
      });
      await prisma.realEstateTransaction.create({
        data: {
          sourceId,
          region: REGION,
          propertyType: "아파트",
          dealType: "SALE",
          areaSqm: "100.00",
          price: String(previousWindowPrices[i]),
          dealDate: new Date(`${previousDates[i]}T00:00:00.000Z`),
          raw: {},
        },
      });
    }

    // Only 2 JEONSE transactions in the current window — exercises INSUFFICIENT_DATA.
    await prisma.realEstateTransaction.createMany({
      data: [
        {
          sourceId,
          region: REGION,
          propertyType: "아파트",
          dealType: "JEONSE",
          areaSqm: "100.00",
          price: "5000",
          dealDate: new Date("2026-08-01T00:00:00.000Z"),
          raw: {},
        },
        {
          sourceId,
          region: REGION,
          propertyType: "아파트",
          dealType: "JEONSE",
          areaSqm: "100.00",
          price: "5100",
          dealDate: new Date("2026-08-05T00:00:00.000Z"),
          raw: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes the median price-per-sqm change between two windows", async () => {
    const result = await computeRegionalPriceChange(sourceId, REGION, "SALE", { asOf: AS_OF });
    expect(result.status).toBe("COMPUTED");
    expect(result.currentWindow?.medianPricePerSqm).toBe(110);
    expect(result.previousWindow?.medianPricePerSqm).toBe(95);
    expect(result.absoluteChange).toBe(15);
    expect(result.percentChange).toBeCloseTo(15.7895, 3);
  });

  it("returns INSUFFICIENT_DATA when a window has fewer than minSampleSize transactions", async () => {
    const result = await computeRegionalPriceChange(sourceId, REGION, "JEONSE", { asOf: AS_OF });
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA for a region/dealType with no transactions at all", async () => {
    const result = await computeRegionalPriceChange(sourceId, "TEST_존재하지않는구", "SALE", {
      asOf: AS_OF,
    });
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });
});
