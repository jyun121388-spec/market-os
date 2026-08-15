import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

// Requires a real Postgres reachable at DATABASE_URL (see README "Getting started").
// Skipped automatically when no DATABASE_URL is configured so `npm test` still passes
// in environments without a local database (e.g. some CI runners). The db client module is
// dynamically imported only when DATABASE_URL is set, since it throws at import time otherwise.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

// A dedicated source code for this suite — other integration test files (fred-ingest,
// ecos-ingest, dart-ingest, edgar-ingest) own the real source codes (FRED, ECOS, DART,
// SEC_EDGAR) and run against the same live database, so this suite must never touch rows it
// doesn't own (no global deleteMany on shared tables).
const TEST_SOURCE_CODE = "TEST_SCHEMA_SOURCE";

describeIfDb("prisma schema (integration)", () => {
  let prisma: typeof PrismaClientInstance;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
      await prisma.dataConflict.deleteMany({ where: { observation: { sourceId: existing.id } } });
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a source, series, observation, and a sourced FACT claim", async () => {
    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Schema Source", tier: "TIER_S" },
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
    const source = await prisma.source.findFirstOrThrow({ where: { code: TEST_SOURCE_CODE } });
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
    const source = await prisma.source.findFirstOrThrow({ where: { code: TEST_SOURCE_CODE } });
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

  it("records a DataConflict instead of silently picking a value when sources disagree", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { code: TEST_SOURCE_CODE } });
    const series = await prisma.series.findFirstOrThrow({
      where: { sourceId: source.id, externalId: "DGS10" },
    });
    const observation = await prisma.observation.findFirstOrThrow({
      where: { seriesId: series.id },
    });

    const conflict = await prisma.dataConflict.create({
      data: {
        observationId: observation.id,
        conflictingWith: {
          sourceCode: "US_TREASURY",
          value: "4.27",
          observationDate: "2026-08-14",
          retrievedAt: "2026-08-15T00:00:00.000Z",
        },
        officialSource: null,
        resolved: false,
      },
    });

    expect(conflict.resolved).toBe(false);
    expect((conflict.conflictingWith as { sourceCode: string }).sourceCode).toBe("US_TREASURY");

    const stored = await prisma.observation.findUniqueOrThrow({
      where: { id: observation.id },
      include: { conflicts: true },
    });
    expect(stored.value.toString()).toBe("4.25"); // original value is untouched, not overwritten
    expect(stored.conflicts).toHaveLength(1);
  });
});
