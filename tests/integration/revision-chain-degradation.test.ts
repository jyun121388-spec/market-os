import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * A malformed revision chain must cost the SERIES, not the page.
 *
 * `findRevisionChainTail` throws on a malformed chain, and that is right: refusing to guess which
 * value is current beats presenting a superseded one. But until 2026-08-18 nothing caught the
 * throw, so a single corrupt observation aborted Morning Brief, Macro Regime and Ask Market
 * entirely — every other series lost to a defect in one (independent review, `gpt-5.6-terra`).
 *
 * That was a regression introduced by the fix that made the function throw in the first place.
 * Worth naming plainly: hardening one layer moved the failure somewhere with a wider blast radius.
 *
 * `revisionOf` is a plain scalar rather than a foreign key, so a row pointing at a non-existent
 * parent is genuinely insertable — this is not a contrived state.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_CHAIN_DEGRADE_SOURCE";

describeIfDb("malformed revision chain degrades the series, not the request", () => {
  let prisma: typeof PrismaClientInstance;
  let getRecentObservationPair: typeof import("@/server/domain/seriesReadings").getRecentObservationPair;
  let getObservationsOneRowPerDate: typeof import("@/server/domain/seriesReadings").getObservationsOneRowPerDate;
  let sourceId: string;
  let brokenSeriesId: string;
  let healthySeriesId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    const readings = await import("@/server/domain/seriesReadings");
    getRecentObservationPair = readings.getRecentObservationPair;
    getObservationsOneRowPerDate = readings.getObservationsOneRowPerDate;

    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Chain degradation test source", tier: "TIER_S" },
    });
    sourceId = source.id;

    const broken = await prisma.series.create({
      data: { sourceId, externalId: "BROKEN", name: "Broken", unit: "index", frequency: "daily" },
    });
    brokenSeriesId = broken.id;
    const healthy = await prisma.series.create({
      data: { sourceId, externalId: "HEALTHY", name: "Healthy", unit: "index", frequency: "daily" },
    });
    healthySeriesId = healthy.id;

    for (const [seriesId, date, value] of [
      [broken.id, "2026-08-10T00:00:00.000Z", "100"],
      [broken.id, "2026-08-11T00:00:00.000Z", "101"],
      [healthy.id, "2026-08-10T00:00:00.000Z", "200"],
      [healthy.id, "2026-08-11T00:00:00.000Z", "202"],
    ] as const) {
      await prisma.observation.create({
        data: { seriesId, sourceId, observationDate: new Date(date), value, raw: {} },
      });
    }

    // The corruption: a revision whose parent does not exist. Two unreferenced rows share the
    // date, so the chain has two competing tails and resolution throws.
    await prisma.observation.create({
      data: {
        seriesId: broken.id,
        sourceId,
        observationDate: new Date("2026-08-11T00:00:00.000Z"),
        value: "999",
        isRevision: true,
        revisionOf: "an-id-that-does-not-exist",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns no reading for the broken series instead of throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getRecentObservationPair(brokenSeriesId)).resolves.toBeNull();
    spy.mockRestore();
  });

  it("still reports the healthy series in the same process", async () => {
    // The actual point. Before the fix, the broken series took this one down with it.
    const pair = await getRecentObservationPair(healthySeriesId);
    expect(pair).not.toBeNull();
    expect(Number(pair!.current.value.toString())).toBe(202);
  });

  it("logs the corruption rather than swallowing it", async () => {
    // Degrading must not be silent. "Silence where there should be a signal" is the second of
    // the two patterns behind most defects in this project.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await getRecentObservationPair(brokenSeriesId);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/malformed revision chain/i);
    spy.mockRestore();
  });

  it("omits only the affected date from a full history, not the whole series", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const history = await getObservationsOneRowPerDate(brokenSeriesId);
    spy.mockRestore();
    // 2026-08-10 is intact and must survive; 2026-08-11 is the corrupt date.
    expect(history).toHaveLength(1);
    expect(history[0].observationDate.toISOString().slice(0, 10)).toBe("2026-08-10");
  });
});
