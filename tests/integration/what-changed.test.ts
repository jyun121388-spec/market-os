import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_WHATCHANGED_SOURCE";

describeIfDb("computeSeriesChange (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeSeriesChange: typeof import("@/server/domain/whatChanged").computeSeriesChange;
  let verifyClaim: typeof import("@/server/domain/claimVerification").verifyClaim;
  let sourceId: string;
  let seriesId: string;
  let sparseSeriesId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeSeriesChange } = await import("@/server/domain/whatChanged"));
    ({ verifyClaim } = await import("@/server/domain/claimVerification"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test What-Changed Source", tier: "TIER_S" },
    });
    sourceId = source.id;

    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTCHANGE10Y",
        name: "Test 10Y Yield",
        unit: "percent",
        frequency: "daily",
      },
    });
    seriesId = series.id;

    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: new Date("2026-08-13T00:00:00.000Z"),
        value: "4.20",
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "4.25",
        raw: {},
      },
    });

    const sparseSeries = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTSPARSE",
        name: "Test Sparse Series",
        unit: "index",
        frequency: "monthly",
      },
    });
    sparseSeriesId = sparseSeries.id;
    await prisma.observation.create({
      data: {
        seriesId: sparseSeriesId,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "100.0",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes the deterministic change and persists a verifiable CALCULATION claim", async () => {
    const result = await computeSeriesChange(seriesId);
    expect(result.status).toBe("COMPUTED");
    expect(result.absoluteChange).toBe(0.05);
    expect(result.bpsChange).toBe(5);

    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: result.claimId } });
    expect(claim.claimType).toBe("CALCULATION");
    expect(claim.claimText).toContain("4.25");
    expect(claim.claimText).toContain("4.2");

    const verification = await verifyClaim(result.claimId!);
    expect(verification.status).toBe("VERIFIED");
  });

  it("returns INSUFFICIENT_DATA for a series with only one observation date", async () => {
    const result = await computeSeriesChange(sparseSeriesId);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.claimId).toBeUndefined();
  });

  it("uses the latest revision, not the original value, when computing change", async () => {
    // Revise the 2026-08-13 observation from 4.20 to 4.10.
    const original = await prisma.observation.findFirstOrThrow({
      where: { seriesId, observationDate: new Date("2026-08-13T00:00:00.000Z") },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: new Date("2026-08-13T00:00:00.000Z"),
        value: "4.10",
        isRevision: true,
        revisionOf: original.id,
        raw: {},
      },
    });

    const result = await computeSeriesChange(seriesId);
    expect(result.status).toBe("COMPUTED");
    expect(result.absoluteChange).toBeCloseTo(0.15, 6); // 4.25 - 4.10, not 4.25 - 4.20
  });
});
