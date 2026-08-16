import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_WITH_DATA = "TEST_HEALTH_SOURCE_ACTIVE";
const SOURCE_WITHOUT_DATA = "TEST_HEALTH_SOURCE_IDLE";

describeIfDb("computeSystemHealth (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeSystemHealth: typeof import("@/server/domain/systemHealth").computeSystemHealth;
  let observationId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeSystemHealth } = await import("@/server/domain/systemHealth"));

    for (const code of [SOURCE_WITH_DATA, SOURCE_WITHOUT_DATA]) {
      const existing = await prisma.source.findUnique({ where: { code } });
      if (existing) {
        await prisma.dataConflict.deleteMany({
          where: { observation: { sourceId: existing.id } },
        });
        await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
        await prisma.series.deleteMany({ where: { sourceId: existing.id } });
        await prisma.source.delete({ where: { id: existing.id } });
      }
    }

    const activeSource = await prisma.source.create({
      data: { code: SOURCE_WITH_DATA, name: "Test Active Source", tier: "TIER_S" },
    });
    await prisma.source.create({
      data: { code: SOURCE_WITHOUT_DATA, name: "Test Idle Source", tier: "TIER_S" },
    });

    const series = await prisma.series.create({
      data: {
        sourceId: activeSource.id,
        externalId: "HEALTHTEST",
        name: "Health Test Series",
        unit: "index",
        frequency: "daily",
      },
    });
    const observation = await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: activeSource.id,
        observationDate: new Date("2026-08-01T00:00:00.000Z"),
        value: "1.0",
        raw: {},
      },
    });
    observationId = observation.id;

    await prisma.dataConflict.create({
      data: {
        observationId,
        conflictingWith: { sourceCode: "OTHER", value: "2.0" },
        resolved: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reports the last ingest timestamp for a source with data", async () => {
    const health = await computeSystemHealth();
    const active = health.sources.find((s) => s.sourceCode === SOURCE_WITH_DATA)!;
    expect(active.lastIngestAt).not.toBeNull();
  });

  it("reports null lastIngestAt for a source that has never ingested anything", async () => {
    const health = await computeSystemHealth();
    const idle = health.sources.find((s) => s.sourceCode === SOURCE_WITHOUT_DATA)!;
    expect(idle.lastIngestAt).toBeNull();
  });

  it("counts unresolved DataConflict rows", async () => {
    const health = await computeSystemHealth();
    expect(health.unresolvedDataConflicts).toBeGreaterThanOrEqual(1);
  });
});
