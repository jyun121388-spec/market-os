import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("buildMorningBrief (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let buildMorningBrief: typeof import("@/server/domain/morningBrief").buildMorningBrief;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ buildMorningBrief } = await import("@/server/domain/morningBrief"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("composes without throwing and returns well-shaped sections", async () => {
    const brief = await buildMorningBrief();

    expect(typeof brief.generatedAt).toBe("string");
    expect(Array.isArray(brief.recentEvents)).toBe(true);
    expect(Array.isArray(brief.recentFilings)).toBe(true);
    expect(Array.isArray(brief.whatChanged)).toBe(true);
    expect(Array.isArray(brief.regime.axes)).toBe(true);
    expect(brief.regime.axes).toHaveLength(8);
    expect(Array.isArray(brief.calendar)).toBe(true);
  });

  it("does not persist any new Claim rows (read-only, safe to call repeatedly)", async () => {
    const before = await prisma.claim.count();
    await buildMorningBrief();
    await buildMorningBrief();
    const after = await prisma.claim.count();
    expect(after).toBe(before);
  });

  it("only includes PROJECTED calendar entries, never NOT_TRACKED/INSUFFICIENT_DATA noise", async () => {
    const brief = await buildMorningBrief();
    for (const entry of brief.calendar) {
      expect(entry.status).toBe("PROJECTED");
    }
  });

  describe("staleness marking", () => {
    const SOURCE_CODE = "TEST_MORNING_BRIEF_STALENESS_SOURCE";
    const STALE_SERIES_EXTERNAL_ID = "STALE_DAILY_SERIES";
    const FRESH_SERIES_EXTERNAL_ID = "FRESH_DAILY_SERIES";

    beforeAll(async () => {
      const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
      if (existing) {
        await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
        await prisma.series.deleteMany({ where: { sourceId: existing.id } });
        await prisma.source.delete({ where: { id: existing.id } });
      }

      const source = await prisma.source.create({
        data: { code: SOURCE_CODE, name: "Test Staleness Source", tier: "TIER_S" },
      });

      const staleSeries = await prisma.series.create({
        data: {
          sourceId: source.id,
          externalId: STALE_SERIES_EXTERNAL_ID,
          name: "Stale Daily Series",
          unit: "index",
          frequency: "daily",
        },
      });
      // Two observations one day apart, both far in the past — median interval 1 day, last
      // observation ~100 days ago, well past the 3x-median-interval STALE threshold.
      const oldBase = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await prisma.observation.create({
        data: {
          seriesId: staleSeries.id,
          sourceId: source.id,
          observationDate: new Date(oldBase.getTime() - 24 * 60 * 60 * 1000),
          value: "1.0",
          raw: {},
        },
      });
      await prisma.observation.create({
        data: {
          seriesId: staleSeries.id,
          sourceId: source.id,
          observationDate: oldBase,
          value: "1.1",
          raw: {},
        },
      });

      const freshSeries = await prisma.series.create({
        data: {
          sourceId: source.id,
          externalId: FRESH_SERIES_EXTERNAL_ID,
          name: "Fresh Daily Series",
          unit: "index",
          frequency: "daily",
        },
      });
      // Two observations one day apart, the most recent one today — well within cadence.
      const recentBase = new Date();
      await prisma.observation.create({
        data: {
          seriesId: freshSeries.id,
          sourceId: source.id,
          observationDate: new Date(recentBase.getTime() - 24 * 60 * 60 * 1000),
          value: "2.0",
          raw: {},
        },
      });
      await prisma.observation.create({
        data: {
          seriesId: freshSeries.id,
          sourceId: source.id,
          observationDate: recentBase,
          value: "2.1",
          raw: {},
        },
      });
    });

    afterAll(async () => {
      const source = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
      if (source) {
        await prisma.observation.deleteMany({ where: { sourceId: source.id } });
        await prisma.series.deleteMany({ where: { sourceId: source.id } });
        await prisma.source.delete({ where: { id: source.id } });
      }
    });

    it("marks a series with no recent observations as STALE", async () => {
      const brief = await buildMorningBrief();
      const entry = brief.whatChanged.find((c) => c.seriesName === "Stale Daily Series");
      expect(entry?.staleness).toBe("STALE");
    });

    it("marks a series with a recent observation as FRESH", async () => {
      const brief = await buildMorningBrief();
      const entry = brief.whatChanged.find((c) => c.seriesName === "Fresh Daily Series");
      expect(entry?.staleness).toBe("FRESH");
    });
  });
});
