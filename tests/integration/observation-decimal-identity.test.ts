import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_DECIMAL_IDENTITY_SOURCE";

/**
 * Decimal identity checked where it actually matters: through the real upsert, against the real
 * column, counting the rows that really exist.
 *
 * `tests/decimalValueIdentity.test.ts` tests the comparison function and
 * `tests/integration/decimal-column-semantics.test.ts` checks that the function agrees with a
 * `numeric(20,6)` cast. Neither proves the thing the product depends on, which is that
 * `upsertRevisionAwareObservation` reaches the right CONCLUSION: no revision row when the column
 * would store the same figure, exactly one when it would not.
 *
 * That gap is not hypothetical. Both defects in this area were invisible at the function boundary
 * and visible only as rows: D1 would have recorded a genuine revision as "unchanged", and the
 * Gate B follow-up would have let a provider replay a superseded value past the rollback guard by
 * spelling it differently. Row counts are the evidence; a status string is a claim about them.
 */
describeIfDb("observation ingest decides revisions by the column's identity (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let upsertRevisionAwareObservation: typeof import("@/server/domain/observationIngest").upsertRevisionAwareObservation;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ upsertRevisionAwareObservation } = await import("@/server/domain/observationIngest"));

    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existing) {
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Test Decimal Identity Source", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  const OBSERVATION_DATE = new Date("2026-08-14T00:00:00.000Z");

  async function freshSeries(externalId: string) {
    return prisma.series.create({
      data: { sourceId, externalId, name: `Test ${externalId}`, unit: "index", frequency: "daily" },
    });
  }

  async function ingest(seriesId: string, value: string) {
    return upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBSERVATION_DATE,
      value,
      raw: { value },
    });
  }

  async function rowCount(seriesId: string) {
    return prisma.observation.count({ where: { seriesId } });
  }

  /**
   * Pairs the column stores IDENTICALLY. Re-ingesting the second must be a no-op: same figure,
   * differently spelled or differently precise. Every one of these was a spurious revision under
   * some version of this code.
   */
  it.each([
    ["1.000000", "1.0000004", "rounds away below the sixth place"],
    ["100000", "1e5", "exponent notation"],
    ["1", "+1", "leading plus"],
    ["0.5", ".5", "leading decimal point"],
    ["10.5", "10.500000", "trailing zeros"],
    ["1.234568", "1.2345678", "more decimals than the column keeps"],
    ["0", "-0.000000", "negative zero"],
    ["42", "  42  ", "surrounding whitespace"],
  ])("stores %s, then %s (%s), and records no revision", async (first, second) => {
    const series = await freshSeries(`SAME_${first}_${second}`.replace(/[^A-Za-z0-9_]/g, "_"));

    expect(await ingest(series.id, first)).toBe("inserted");
    expect(await ingest(series.id, second)).toBe("unchanged");

    // The status is a claim; the row count is the fact.
    expect(await rowCount(series.id)).toBe(1);
    const rows = await prisma.observation.findMany({ where: { seriesId: series.id } });
    expect(rows[0].isRevision).toBe(false);
    expect(rows[0].revisionOf).toBeNull();
  });

  it("records a revision for a one-unit change at the sixth decimal place", async () => {
    // The other direction, and the one that must never be lost: the smallest difference the column
    // can hold is still a revision.
    const series = await freshSeries("DIFFERENT_LAST_PLACE");

    expect(await ingest(series.id, "1.234568")).toBe("inserted");
    expect(await ingest(series.id, "1.234569")).toBe("revised");

    expect(await rowCount(series.id)).toBe(2);
    const revision = await prisma.observation.findFirst({
      where: { seriesId: series.id, isRevision: true },
    });
    expect(revision).not.toBeNull();
    expect(revision?.revisionOf).not.toBeNull();
    expect(revision?.value.toString()).toBe("1.234569");
  });

  it("keeps a difference a double cannot see", async () => {
    // D1 as rows rather than as a function call. `Number()` reads these two as the same value.
    const series = await freshSeries("BEYOND_DOUBLE_PRECISION");

    expect(await ingest(series.id, "10000000000000.000001")).toBe("inserted");
    expect(await ingest(series.id, "10000000000000.000002")).toBe("revised");
    expect(await rowCount(series.id)).toBe(2);
  });

  it("refuses a superseded value replayed in another notation", async () => {
    // The rollback guard, walked at with a different spelling. A provider that replays `1e5` over
    // a chain that has moved on to 110000 must not put 100000 back.
    const series = await freshSeries("STALE_REPLAY_EXPONENT");

    expect(await ingest(series.id, "100000")).toBe("inserted");
    expect(await ingest(series.id, "110000")).toBe("revised");
    expect(await ingest(series.id, "1e5")).toBe("stale_ignored");

    // Two rows, and the tail is still the newer figure.
    expect(await rowCount(series.id)).toBe(2);
    const tail = await prisma.observation.findFirst({
      where: { seriesId: series.id, isRevision: true },
    });
    // Prisma's `Decimal.toString()` drops an all-zero fraction, so this is "110000" and not
    // "110000.000000" — worth pinning, because that is exactly the kind of spelling difference
    // this whole area keeps tripping over.
    expect(tail?.value.toString()).toBe("110000");
  });
});
