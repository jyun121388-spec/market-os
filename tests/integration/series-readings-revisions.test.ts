import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * The read path must return the CURRENT value for an observation date, not a superseded one.
 *
 * `getRecentObservationPair` feeds What Changed, Macro Regime, Ask Market and Today — it decides
 * which number a user is shown. It used to resolve "which row wins for this date" with
 * `orderBy: retrievedAt desc` plus `distinct`, on a `timestamp(3)` column. An original and its
 * revision written in the same millisecond are byte-identical on that column, so Postgres could
 * return either first and `distinct` kept whichever it was. Ingesting a revision right after its
 * original is the normal path, so this was not a rare edge case, and the failure was
 * non-deterministic rather than consistently wrong.
 *
 * These fixtures write the original and its revision with IDENTICAL `retrievedAt` values, which
 * is precisely the state the old code could not resolve — and which no amount of re-running
 * would reliably surface, since it depended on Postgres's row order.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_SERIES_READINGS_REV";

describeIfDb("getRecentObservationPair with revisions (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let getRecentObservationPair: typeof import("@/server/domain/seriesReadings").getRecentObservationPair;
  let sourceId: string;
  let seriesId: string;

  const DAY_1 = new Date("2026-08-10T00:00:00.000Z");
  const DAY_2 = new Date("2026-08-11T00:00:00.000Z");
  // One instant for every row, so `retrievedAt` carries no usable information at all.
  const SAME_INSTANT = new Date("2026-08-12T09:00:00.000Z");

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ getRecentObservationPair } = await import("@/server/domain/seriesReadings"));

    const source = await prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: {},
      create: { code: SOURCE_CODE, name: "Series readings revision test", tier: "TIER_S" },
    });
    sourceId = source.id;

    const series = await prisma.series.upsert({
      where: { sourceId_externalId: { sourceId, externalId: "REV_TEST" } },
      update: {},
      create: {
        sourceId,
        externalId: "REV_TEST",
        name: "Revision test series",
        unit: "percent",
        frequency: "daily",
      },
    });
    seriesId = series.id;
    await prisma.observation.deleteMany({ where: { seriesId } });

    // DAY_1: original 1.00, later revised to 1.50.
    const day1Original = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_1,
        value: "1.00",
        retrievedAt: SAME_INSTANT,
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_1,
        value: "1.50",
        isRevision: true,
        revisionOf: day1Original.id,
        retrievedAt: SAME_INSTANT,
        raw: {},
      },
    });

    // DAY_2: original 2.00, revised to 3.00, then revised again to 4.00 — a chain of length 3,
    // so picking "a revision" rather than "the tail" is also wrong.
    const day2Original = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "2.00",
        retrievedAt: SAME_INSTANT,
        raw: {},
      },
    });
    const day2FirstRevision = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "3.00",
        isRevision: true,
        revisionOf: day2Original.id,
        retrievedAt: SAME_INSTANT,
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "4.00",
        isRevision: true,
        revisionOf: day2FirstRevision.id,
        retrievedAt: SAME_INSTANT,
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { seriesId } });
    await prisma.series.delete({ where: { id: seriesId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  it("returns the tail of each date's revision chain, not the original", async () => {
    const pair = await getRecentObservationPair(seriesId);
    expect(pair).not.toBeNull();

    // 4.00, the end of a three-row chain — not 2.00 (the original) and not 3.00 (a middle
    // revision that a "most recent revision" heuristic might land on).
    expect(pair!.current.value.toString()).toBe("4");
    expect(pair!.current.observationDate.toISOString()).toBe(DAY_2.toISOString());

    expect(pair!.previous.value.toString()).toBe("1.5");
    expect(pair!.previous.observationDate.toISOString()).toBe(DAY_1.toISOString());
  });

  it("is stable across repeated reads", async () => {
    // The old failure was non-deterministic: identical timestamps left row order up to Postgres,
    // so the same query could answer differently on different calls.
    const values = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const pair = await getRecentObservationPair(seriesId);
      values.add(`${pair!.current.value.toString()}|${pair!.previous.value.toString()}`);
    }
    expect([...values]).toEqual(["4|1.5"]);
  });

  it("getObservationsOneRowPerDate returns one revised row per date, oldest first", async () => {
    // economicCalendar and historicalAnalog had each written the broken retrievedAt+distinct
    // query independently, and both use the VALUE — the calendar displays `lastObservedValue`,
    // the analog engine z-scores every point. One shared reader now answers for all of them.
    const { getObservationsOneRowPerDate } = await import("@/server/domain/seriesReadings");
    const rows = await getObservationsOneRowPerDate(seriesId);

    expect(rows.map((r) => r.value.toString())).toEqual(["1.5", "4"]);
    expect(rows.map((r) => r.observationDate.toISOString())).toEqual([
      DAY_1.toISOString(),
      DAY_2.toISOString(),
    ]);
  });

  it("the economic calendar reports the revised value, not the original", async () => {
    const { computeCalendarEntry } = await import("@/server/domain/economicCalendar");
    const entry = await computeCalendarEntry(seriesId);

    expect(entry.status).toBe("PROJECTED");
    // 4.00, not 2.00 — `lastObservedValue` is rendered to users.
    expect(entry.lastObservedValue).toBe(4);
    expect(entry.lastObservedDate).toBe("2026-08-11");
  });

  it("computes the change from the revised values, not the superseded ones", async () => {
    const { computeChange } = await import("@/server/domain/seriesReadings");
    const pair = await getRecentObservationPair(seriesId);

    // 4.00 - 1.50 = 2.50. Using the originals would have given 2.00 - 1.00 = 1.00, a plausible
    // number with nothing to mark it as wrong.
    const change = computeChange(pair!, "percent");
    expect(change.absoluteChange).toBe(2.5);
    expect(change.bpsChange).toBe(250);
  });
});
