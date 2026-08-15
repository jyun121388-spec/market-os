import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

// Requires a real Postgres reachable at DATABASE_URL (see README "Getting started").
// Skipped automatically when no DATABASE_URL is configured so `npm test` still passes
// in environments without a local database (e.g. some CI runners). The db client module is
// dynamically imported only when DATABASE_URL is set, since it throws at import time otherwise.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("prisma schema (integration)", () => {
  let prisma: typeof PrismaClientInstance;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    // Clean slate for the tables this test touches.
    await prisma.claim.deleteMany();
    await prisma.dataConflict.deleteMany();
    await prisma.observation.deleteMany();
    await prisma.series.deleteMany();
    await prisma.source.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a source, series, observation, and a sourced FACT claim", async () => {
    const source = await prisma.source.create({
      data: { code: "FRED", name: "Federal Reserve Economic Data", tier: "TIER_S" },
    });

    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "DGS10",
        name: "10-Year Treasury Constant Maturity Rate",
        unit: "percent",
        frequency: "daily",
      },
    });

    const observation = await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: new Date("2026-08-14"),
        value: "4.25",
        raw: { series_id: "DGS10", value: "4.25" },
      },
    });
    expect(observation.value.toString()).toBe("4.25");

    const claim = await prisma.claim.create({
      data: {
        claimText: "US 10Y Treasury yield was 4.25% on 2026-08-14",
        claimType: "FACT",
        sourceId: source.id,
        evidence: { observationId: observation.id },
      },
    });
    expect(claim.sourceId).toBe(source.id);
  });

  it("rejects an observation referencing a nonexistent series (FK integrity)", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { code: "FRED" } });
    await expect(
      prisma.observation.create({
        data: {
          seriesId: "nonexistent-series-id",
          sourceId: source.id,
          observationDate: new Date("2026-08-14"),
          value: "1.00",
          raw: {},
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces uniqueness on (source, external series id)", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { code: "FRED" } });
    await expect(
      prisma.series.create({
        data: {
          sourceId: source.id,
          externalId: "DGS10", // duplicate of the series created above
          name: "duplicate",
          unit: "percent",
          frequency: "daily",
        },
      }),
    ).rejects.toThrow();
  });
});
