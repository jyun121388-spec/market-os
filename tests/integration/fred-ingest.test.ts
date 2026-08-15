import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/fred/__fixtures__/dgs10.json";
import { TRACKED_FRED_SERIES } from "@/server/adapters/fred/types";

// Requires a real Postgres reachable at DATABASE_URL — see tests/integration/schema.test.ts.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const DGS10 = TRACKED_FRED_SERIES.find((s) => s.seriesId === "DGS10")!;

describeIfDb("FRED adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestFredSeries: typeof import("@/server/adapters/fred/ingest").ingestFredSeries;

  beforeAll(async () => {
    process.env.FRED_API_KEY = "test-key";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestFredSeries } = await import("@/server/adapters/fred/ingest"));

    await prisma.dataConflict.deleteMany({});
    await prisma.claim.deleteMany({});
    await prisma.observation.deleteMany({});
    await prisma.series.deleteMany({ where: { externalId: "DGS10" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists observations, skips missing values, and never fabricates a 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestFredSeries(DGS10);
    expect(result).toEqual({
      seriesId: "DGS10",
      inserted: 4,
      revised: 0,
      unchanged: 0,
      skippedMissing: 1,
    });

    const series = await prisma.series.findFirstOrThrow({ where: { externalId: "DGS10" } });
    const stored = await prisma.observation.findMany({ where: { seriesId: series.id } });
    expect(stored).toHaveLength(4);
    expect(stored.every((o) => o.value !== null)).toBe(true);

    const missingDay = stored.find(
      (o) => o.observationDate.toISOString() === "2026-08-12T00:00:00.000Z",
    );
    expect(missingDay).toBeUndefined();
  });

  const revisedFixture = {
    ...fixture,
    observations: fixture.observations.map((o) =>
      o.date === "2026-08-14" ? { ...o, value: "4.30" } : o,
    ),
  };

  it("records a revision (not a silent overwrite) when a re-fetch changes a value", async () => {
    const revised = revisedFixture;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(revised), { status: 200 })),
    );

    const result = await ingestFredSeries(DGS10);
    expect(result.revised).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.unchanged).toBe(3);

    const series = await prisma.series.findFirstOrThrow({ where: { externalId: "DGS10" } });
    const rowsForDay = await prisma.observation.findMany({
      where: { seriesId: series.id, observationDate: new Date("2026-08-14T00:00:00.000Z") },
    });
    expect(rowsForDay).toHaveLength(2);
    const original = rowsForDay.find((r) => !r.isRevision)!;
    const revision = rowsForDay.find((r) => r.isRevision)!;
    expect(original.value.toString()).toBe("4.25");
    expect(revision.value.toString()).toBe("4.3");
    expect(revision.revisionOf).toBe(original.id);
  });

  it("is idempotent: re-ingesting identical data does not duplicate rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(revisedFixture), { status: 200 })),
    );

    const series = await prisma.series.findFirstOrThrow({ where: { externalId: "DGS10" } });
    const before = await prisma.observation.count({ where: { seriesId: series.id } });

    const result = await ingestFredSeries(DGS10);
    expect(result.inserted).toBe(0);

    const after = await prisma.observation.count({ where: { seriesId: series.id } });
    expect(after).toBe(before);
  });
});
