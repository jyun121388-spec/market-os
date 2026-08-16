import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/ecos/__fixtures__/base-rate.json";
import { TRACKED_ECOS_SERIES } from "@/server/adapters/ecos/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const BASE_RATE = TRACKED_ECOS_SERIES[0];
const EXTERNAL_ID = `${BASE_RATE.statCode}:${BASE_RATE.itemCode1}`;
const RANGE = { start: "202603", end: "202606" };

describeIfDb("ECOS adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestEcosSeries: typeof import("@/server/adapters/ecos/ingest").ingestEcosSeries;

  beforeAll(async () => {
    process.env.ECOS_API_KEY = "test-key";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestEcosSeries } = await import("@/server/adapters/ecos/ingest"));

    await prisma.dataConflict.deleteMany({});
    await prisma.claim.deleteMany({});
    await prisma.observation.deleteMany({});
    await prisma.series.deleteMany({ where: { externalId: EXTERNAL_ID } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists observations, skips the missing marker, and never fabricates a 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestEcosSeries(BASE_RATE, RANGE);
    expect(result).toEqual({
      seriesId: EXTERNAL_ID,
      inserted: 3,
      revised: 0,
      unchanged: 0,
      skippedMissing: 1,
      // Request-level window walking is covered in tests/adapters/pagination.test.ts — it is a
      // property of the client, and proving it here meant writing thousands of synthetic rows.
      totalCount: 4,
      requestsMade: 1,
      truncated: false,
    });

    const series = await prisma.series.findFirstOrThrow({ where: { externalId: EXTERNAL_ID } });
    const stored = await prisma.observation.findMany({ where: { seriesId: series.id } });
    expect(stored).toHaveLength(3);

    const missingMonth = stored.find(
      (o) => o.observationDate.toISOString() === "2026-05-01T00:00:00.000Z",
    );
    expect(missingMonth).toBeUndefined();
  });

  it("records a revision when a re-fetch changes a value", async () => {
    const revised = {
      StatisticSearch: {
        ...fixture.StatisticSearch,
        row: fixture.StatisticSearch.row.map((r) =>
          r.TIME === "202603" ? { ...r, DATA_VALUE: "2.50" } : r,
        ),
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(revised), { status: 200 })),
    );

    const result = await ingestEcosSeries(BASE_RATE, RANGE);
    expect(result.revised).toBe(1);
    expect(result.inserted).toBe(0);

    const series = await prisma.series.findFirstOrThrow({ where: { externalId: EXTERNAL_ID } });
    const rows = await prisma.observation.findMany({
      where: { seriesId: series.id, observationDate: new Date("2026-03-01T00:00:00.000Z") },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.isRevision)?.value.toString()).toBe("2.5");
  });

  it("throws EcosApiError (not a silent empty result) when the API returns an error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." },
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(ingestEcosSeries(BASE_RATE, RANGE)).rejects.toThrow(/해당하는 데이터가 없습니다/);
  });
});
