import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Reality Fabric read-only shadow projection (docs/WORLD_DATA_FABRIC.md).
 *
 * Two things need proving, and the second matters more.
 *
 * 1. It detects the disagreements it exists to detect.
 * 2. **It stays quiet when the implementations agree.** A shadow layer that reports a
 *    disagreement for every dataset tells you nothing — the same failure that disqualified the
 *    local review models in `docs/LOCAL_AI_CALIBRATION.md`, where a reviewer that never cleared
 *    clean code carried no information. Negative controls are therefore first-class here.
 *
 * The projection must also never write. Nothing below asserts that directly because the module
 * simply contains no write call; what the last test does check is that running it leaves the row
 * counts untouched.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_FABRIC_SHADOW_SOURCE";
const FRESH_SERIES = "TEST_FABRIC_FRESH";
const STALE_SERIES = "TEST_FABRIC_STALE";
const SPARSE_SERIES = "TEST_FABRIC_SPARSE";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Fixed clock so freshness is deterministic; staleness is entirely a function of elapsed time. */
const NOW = new Date("2026-08-18T00:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);

describeIfDb("Reality Fabric shadow projection (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeFabricProjection: typeof import("@/server/fabric/shadowProjection").computeFabricProjection;
  let sourceId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.ingestRun.deleteMany({ where: { sourceId: existing.id } });
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
    await prisma.filing.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeFabricProjection } = await import("@/server/fabric/shadowProjection"));

    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Fabric shadow test source", tier: "TIER_S" },
    });
    sourceId = source.id;

    // Daily cadence, observed right up to NOW, retrieved today. Everything agrees: FRESH.
    const fresh = await prisma.series.create({
      data: {
        sourceId,
        externalId: FRESH_SERIES,
        name: "Fresh daily",
        unit: "index",
        frequency: "daily",
      },
    });
    for (const d of [4, 3, 2, 1, 0]) {
      await prisma.observation.create({
        data: {
          seriesId: fresh.id,
          sourceId,
          observationDate: daysBefore(d),
          value: `${100 + d}`,
          retrievedAt: NOW,
          raw: {},
        },
      });
    }

    // Daily cadence, but the newest observation is 40 days old while we fetched today. The
    // provider simply has nothing newer. This is the disagreement the projection exists to find.
    const stale = await prisma.series.create({
      data: {
        sourceId,
        externalId: STALE_SERIES,
        name: "Stale daily",
        unit: "index",
        frequency: "daily",
      },
    });
    for (const d of [43, 42, 41, 40]) {
      await prisma.observation.create({
        data: {
          seriesId: stale.id,
          sourceId,
          observationDate: daysBefore(d),
          value: `${200 + d}`,
          retrievedAt: NOW,
          raw: {},
        },
      });
    }

    // One observation: too little history to project a cadence at all.
    const sparse = await prisma.series.create({
      data: {
        sourceId,
        externalId: SPARSE_SERIES,
        name: "Sparse",
        unit: "index",
        frequency: "daily",
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: sparse.id,
        sourceId,
        observationDate: daysBefore(10),
        value: "300",
        retrievedAt: NOW,
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("agrees with staleness.ts on a series that is genuinely fresh", async () => {
    const p = await computeFabricProjection(NOW);
    const row = p.series.find((s) => s.datasetKey === `${SOURCE_CODE}:${FRESH_SERIES}`)!;
    expect(row.stalenessVerdict).toBe("FRESH");
    expect(row.calendarStatus).toBe("PROJECTED");
    expect(row.state).toBe("FRESH");
  });

  it("raises no disagreement for the fresh series — the negative control", async () => {
    // The test that makes the others mean something. If everything disagreed, nothing would.
    const p = await computeFabricProjection(NOW);
    const noise = p.disagreements.filter((d) => d.datasetKey === `${SOURCE_CODE}:${FRESH_SERIES}`);
    expect(noise).toEqual([]);
  });

  it("flags data that is stale despite having just been retrieved", async () => {
    const p = await computeFabricProjection(NOW);
    const key = `${SOURCE_CODE}:${STALE_SERIES}`;

    const row = p.series.find((s) => s.datasetKey === key)!;
    expect(row.stalenessVerdict).toBe("STALE");
    expect(row.daysSinceLastRetrieval).toBe(0);

    // `/admin` reports source health from retrievedAt alone, so an operator looking there sees a
    // healthy source while the data itself is 40 days past its own cadence. The two answers are
    // to different questions and both are individually correct — which is exactly why the
    // projection records both rather than picking a winner.
    const found = p.disagreements.find((d) => d.datasetKey === key && d.kind === "FRESHNESS_BASIS");
    expect(found).toBeDefined();
    expect(found!.answers["staleness.ts (by observationDate)"]).toMatch(/STALE/);
  });

  it("reports UNKNOWN, never FRESH, when no cadence can be projected", async () => {
    // Absence of evidence is not evidence of currency — the rule assessCompleteness already
    // applies to companies, held to here for series.
    const p = await computeFabricProjection(NOW);
    const row = p.series.find((s) => s.datasetKey === `${SOURCE_CODE}:${SPARSE_SERIES}`)!;
    expect(row.stalenessVerdict).toBe("UNKNOWN");
    expect(row.calendarStatus).toBe("INSUFFICIENT_DATA");
    expect(row.state).toBe("UNKNOWN");
  });

  it("separates the three timestamps rather than collapsing them", async () => {
    const p = await computeFabricProjection(NOW);
    const row = p.series.find((s) => s.datasetKey === `${SOURCE_CODE}:${STALE_SERIES}`)!;
    // observedAt is 40 days before retrievedAt. A layer that reported one number could not say so.
    expect(row.temporal.observedAt).toBe(daysBefore(40).toISOString().slice(0, 10));
    expect(row.temporal.retrievedAt).toBe(NOW.toISOString());
  });

  it("writes nothing", async () => {
    const before = await Promise.all([
      prisma.observation.count(),
      prisma.series.count(),
      prisma.ingestRun.count(),
      prisma.financialFact.count(),
    ]);
    await computeFabricProjection(NOW);
    const after = await Promise.all([
      prisma.observation.count(),
      prisma.series.count(),
      prisma.ingestRun.count(),
      prisma.financialFact.count(),
    ]);
    expect(after).toEqual(before);
  });
});
