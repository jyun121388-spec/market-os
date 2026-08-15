import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_CALENDAR_SOURCE";

describeIfDb("computeCalendarEntry (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeCalendarEntry: typeof import("@/server/domain/economicCalendar").computeCalendarEntry;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeCalendarEntry } = await import("@/server/domain/economicCalendar"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Calendar Source", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns INSUFFICIENT_DATA for a series with fewer than 2 observation dates", async () => {
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "SPARSE",
        name: "Sparse Series",
        unit: "index",
        frequency: "monthly",
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId,
        observationDate: new Date("2026-06-01T00:00:00.000Z"),
        value: "1.0",
        raw: {},
      },
    });

    const entry = await computeCalendarEntry(series.id);
    expect(entry.status).toBe("INSUFFICIENT_DATA");
  });

  it("projects the next expected date from a regular monthly cadence", async () => {
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "MONTHLY",
        name: "Monthly Series",
        unit: "index",
        frequency: "monthly",
      },
    });
    for (const date of ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"]) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId,
          observationDate: new Date(`${date}T00:00:00.000Z`),
          value: "100.0",
          raw: {},
        },
      });
    }

    const entry = await computeCalendarEntry(series.id);
    expect(entry.status).toBe("PROJECTED");
    expect(entry.lastObservedDate).toBe("2026-07-01");
    expect(entry.medianIntervalDays).toBeGreaterThanOrEqual(28);
    expect(entry.medianIntervalDays).toBeLessThanOrEqual(31);
    // 2026-07-01 + ~30 days ≈ 2026-07-31 or 2026-08-01, depending on the exact median.
    expect(entry.expectedNextDate! >= "2026-07-29").toBe(true);
    expect(entry.expectedNextDate! <= "2026-08-02").toBe(true);
  });

  it("uses the median interval, not skewed by one irregular gap", async () => {
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "IRREGULAR",
        name: "Irregular Series",
        unit: "index",
        frequency: "daily",
      },
    });
    // Regular ~1-day gaps except one 30-day gap — median should ignore the outlier.
    for (const date of ["2026-07-01", "2026-07-02", "2026-07-03", "2026-08-02"]) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId,
          observationDate: new Date(`${date}T00:00:00.000Z`),
          value: "1.0",
          raw: {},
        },
      });
    }

    const entry = await computeCalendarEntry(series.id);
    expect(entry.medianIntervalDays).toBe(1); // median of [1, 1, 30] is 1, not skewed by the outlier
  });
});
