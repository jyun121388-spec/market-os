import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_CONCURRENCY_SOURCE";

/**
 * H3 regressions (see docs/DECISIONS.md): real concurrent writes against a real PostgreSQL
 * instance, not mocked — the old read-then-create race can only be reproduced against a real
 * database with real transaction/statement interleaving, and a partial unique index's
 * conflict-target semantics can only be verified against real Postgres.
 */
describeIfDb("observation ingestion concurrency (integration)", () => {
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
      data: { code: SOURCE_CODE, name: "Test Concurrency Source", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    // Each test uses its own series (created per-test below) so cleanup is scoped per series,
    // never a bare table-wide deleteMany.
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  async function makeSeries(externalId: string) {
    return prisma.series.create({
      data: { sourceId, externalId, name: `Test ${externalId}`, unit: "index", frequency: "daily" },
    });
  }

  it("A: N concurrent ingests of the SAME value for the same series/date produce exactly one original", async () => {
    const series = await makeSeries("TEST_CONCURRENCY_A");
    const observationDate = new Date("2026-08-14T00:00:00.000Z");

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        upsertRevisionAwareObservation({
          seriesId: series.id,
          sourceId,
          observationDate,
          value: "100.00",
          raw: {},
        }),
      ),
    );

    // Exactly one of the 8 concurrent calls should have inserted; the rest must observe
    // "unchanged" (same value) — never a crash, never a second original.
    expect(results.filter((r) => r === "inserted")).toHaveLength(1);
    expect(results.filter((r) => r === "unchanged")).toHaveLength(7);
    expect(results.filter((r) => r === "revised")).toHaveLength(0);

    const rows = await prisma.observation.findMany({
      where: { seriesId: series.id, observationDate },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isRevision).toBe(false);
    expect(rows[0].value.toString()).toBe("100");
  });

  it("B: N concurrent ingests of DIFFERENT values for the same series/date produce exactly one original plus a valid revision chain", async () => {
    const series = await makeSeries("TEST_CONCURRENCY_B");
    const observationDate = new Date("2026-08-14T00:00:00.000Z");

    // 6 concurrent calls, each a distinct value — under the old read-then-create race this could
    // produce multiple "original" rows, or an unhandled unique-constraint crash on the revision
    // path. Neither should happen now.
    const values = ["10", "20", "30", "40", "50", "60"];
    const results = await Promise.all(
      values.map((value) =>
        upsertRevisionAwareObservation({
          seriesId: series.id,
          sourceId,
          observationDate,
          value,
          raw: {},
        }),
      ),
    );

    // No thrown errors reached this point (Promise.all would have rejected). Exactly one insert.
    expect(results.filter((r) => r === "inserted")).toHaveLength(1);
    // Every non-inserted result must be "revised" (all 6 values are distinct, so none can be
    // "unchanged" relative to whatever won the original slot... except the one that WAS the
    // original, which reports "inserted" for itself and isn't re-submitted).
    expect(results.filter((r) => r === "revised")).toHaveLength(values.length - 1);

    const rows = await prisma.observation.findMany({
      where: { seriesId: series.id, observationDate },
      orderBy: { retrievedAt: "asc" },
    });

    // Exactly one original.
    const originals = rows.filter((r) => !r.isRevision);
    expect(originals).toHaveLength(1);
    expect(originals[0].revisionOf).toBeNull();

    // Every non-original row is a revision with a revisionOf pointing at another row that
    // actually exists in this same result set (no orphaned/dangling pointers).
    const idsInSet = new Set(rows.map((r) => r.id));
    const revisions = rows.filter((r) => r.isRevision);
    expect(revisions.length).toBe(values.length - 1);
    for (const revision of revisions) {
      expect(revision.revisionOf).not.toBeNull();
      expect(idsInSet.has(revision.revisionOf!)).toBe(true);
      // A revision never points at itself.
      expect(revision.revisionOf).not.toBe(revision.id);
    }

    // The revision chain has no cycles: walking revisionOf pointers from every row eventually
    // reaches the one original, in a bounded number of steps (<= number of rows).
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of rows) {
      let current = row;
      let steps = 0;
      while (current.isRevision) {
        expect(steps).toBeLessThan(rows.length);
        current = byId.get(current.revisionOf!)!;
        steps++;
      }
      expect(current.isRevision).toBe(false);
    }

    // Every distinct submitted value is actually represented exactly once across the rows.
    const storedValues = rows.map((r) => r.value.toString()).sort();
    expect(storedValues).toEqual([...values].map((v) => Number(v).toString()).sort());
  });

  it("C: a duplicate original inserted directly into the DB is rejected by the partial unique index", async () => {
    const series = await makeSeries("TEST_CONCURRENCY_C");
    const observationDate = new Date("2026-08-14T00:00:00.000Z");

    const first = await upsertRevisionAwareObservation({
      seriesId: series.id,
      sourceId,
      observationDate,
      value: "5.00",
      raw: {},
    });
    expect(first).toBe("inserted");

    // Attempt to insert a second "original" row directly, bypassing the app's own
    // read-then-decide logic entirely, to prove the guarantee is enforced by the database
    // itself and not just by application code being well-behaved.
    await expect(
      prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId,
          observationDate,
          value: "999.00",
          isRevision: false,
          raw: {},
        },
      }),
    ).rejects.toThrow();

    const rows = await prisma.observation.findMany({
      where: { seriesId: series.id, observationDate },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value.toString()).toBe("5");
  });
});
