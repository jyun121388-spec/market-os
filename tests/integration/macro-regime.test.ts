import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("computeRegimeSnapshot (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeRegimeSnapshot: typeof import("@/server/domain/macroRegime").computeRegimeSnapshot;
  let fredSourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeRegimeSnapshot } = await import("@/server/domain/macroRegime"));

    const source = await prisma.source.upsert({
      where: { code: "FRED" },
      update: {},
      create: { code: "FRED", name: "Federal Reserve Economic Data", tier: "TIER_S" },
    });
    fredSourceId = source.id;

    // Scoped cleanup: only the two GROWTH-axis series this test seeds, never a global wipe.
    for (const externalId of ["UNRATE", "INDPRO"]) {
      const series = await prisma.series.findUnique({
        where: { sourceId_externalId: { sourceId: fredSourceId, externalId } },
      });
      if (series) {
        await prisma.observation.deleteMany({ where: { seriesId: series.id } });
        await prisma.series.delete({ where: { id: series.id } });
      }
    }

    const unrate = await prisma.series.create({
      data: {
        sourceId: fredSourceId,
        externalId: "UNRATE",
        name: "Unemployment Rate",
        unit: "percent",
        frequency: "monthly",
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: unrate.id,
        sourceId: fredSourceId,
        observationDate: new Date("2026-06-01T00:00:00.000Z"),
        value: "4.10",
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: unrate.id,
        sourceId: fredSourceId,
        observationDate: new Date("2026-07-01T00:00:00.000Z"),
        value: "4.20",
        raw: {},
      },
    });

    // INDPRO has only ONE observation on purpose — exercises the INSUFFICIENT_DATA path for a
    // series that *is* tracked, distinct from an axis whose series were never ingested at all.
    const indpro = await prisma.series.create({
      data: {
        sourceId: fredSourceId,
        externalId: "INDPRO",
        name: "Industrial Production Index",
        unit: "index",
        frequency: "monthly",
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: indpro.id,
        sourceId: fredSourceId,
        observationDate: new Date("2026-07-01T00:00:00.000Z"),
        value: "103.5",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes a DATA_AVAILABLE GROWTH axis with a mix of COMPUTED and INSUFFICIENT_DATA readings", async () => {
    const snapshot = await computeRegimeSnapshot();
    const growth = snapshot.axes.find((a) => a.axis === "GROWTH")!;

    expect(growth.status).toBe("DATA_AVAILABLE");

    const unrateReading = growth.readings.find((r) => r.externalId === "UNRATE")!;
    expect(unrateReading.status).toBe("COMPUTED");
    expect(unrateReading.value).toBe(4.2);
    expect(unrateReading.change?.absoluteChange).toBeCloseTo(0.1, 6);
    expect(unrateReading.direction).toBe("UP");

    const indproReading = growth.readings.find((r) => r.externalId === "INDPRO")!;
    expect(indproReading.status).toBe("INSUFFICIENT_DATA");
  });

  it("reports NOT_TRACKED for an axis whose series have never been ingested", async () => {
    const snapshot = await computeRegimeSnapshot();
    const liquidity = snapshot.axes.find((a) => a.axis === "LIQUIDITY")!;

    expect(liquidity.status).toBe("INSUFFICIENT_DATA");
    for (const reading of liquidity.readings) {
      expect(reading.status).toBe("NOT_TRACKED");
    }
  });

  it("never fabricates a single composite score for an axis", async () => {
    const snapshot = await computeRegimeSnapshot();
    for (const axis of snapshot.axes) {
      expect(axis).not.toHaveProperty("score");
    }
  });
});
