import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * A revision that was RETRIEVED BEFORE the row it revises.
 *
 * Found in the real database, not invented. The shadow Fabric projection flagged
 * `ECOS:722Y001:0101000` (한국은행 기준금리) as revised without provider vintage evidence; reading the
 * rows behind that flag shows the revision to 2.5 carries a `retrievedAt` about nine hours EARLIER
 * than the original 3.0 it points at.
 *
 * The existing revision tests cover the case where an original and its revision share an identical
 * `retrievedAt` — the `timestamp(3)` collision that caused the original defect. Inversion is a
 * strictly stronger hazard and nothing covered it. A tiebreak that merely broke ties deterministically
 * would pass the equal-timestamps tests and still answer this wrongly, and the difference between
 * those two fixtures is the difference between "the ordering is ambiguous" and "the ordering is
 * actively misleading".
 *
 * It is also not exotic. A backfill that ingests recent data first, a retried job from an earlier
 * queue, or a provider CDN serving a stale page all produce it. What makes it worth pinning is that
 * every value here is correct and every timestamp is correct — only the RELATIONSHIP between the
 * timestamps and the chain contradicts itself, which is invisible to any check on a single row.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_RETRIEVAL_INVERSION";

describeIfDb("a revision retrieved before its own parent (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let seriesId: string;
  let sourceId: string;

  const DAY_1 = new Date("2026-03-01T00:00:00.000Z");
  const DAY_2 = new Date("2026-04-01T00:00:00.000Z");

  // The real shape: the revision was fetched nine hours before the original it supersedes.
  const REVISION_FETCHED = new Date("2026-08-16T17:42:48.056Z");
  const ORIGINAL_FETCHED = new Date("2026-08-17T02:42:48.031Z");

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));

    const source = await prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: {},
      create: { code: SOURCE_CODE, name: "Retrieval inversion test", tier: "TIER_S" },
    });
    sourceId = source.id;

    const series = await prisma.series.upsert({
      where: { sourceId_externalId: { sourceId, externalId: "INVERTED" } },
      update: {},
      create: {
        sourceId,
        externalId: "INVERTED",
        name: "Retrieval inversion series",
        unit: "percent",
        frequency: "monthly",
      },
    });
    seriesId = series.id;
    await prisma.observation.deleteMany({ where: { seriesId } });

    // DAY_1 reproduces the real ECOS rows: original 3.0 fetched LAST, revision 2.5 fetched FIRST.
    const original = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_1,
        value: "3.00",
        retrievedAt: ORIGINAL_FETCHED,
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_1,
        value: "2.50",
        isRevision: true,
        revisionOf: original.id,
        retrievedAt: REVISION_FETCHED,
        raw: {},
      },
    });

    // DAY_2 pushes it further: a three-row chain whose retrieval order is the exact REVERSE of its
    // semantic order. Any reader that sorts on retrievedAt lands on the original; any reader that
    // takes "the most recently retrieved revision" lands on the middle one. Only walking the chain
    // gives 6.00.
    const day2Original = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "4.00",
        retrievedAt: new Date("2026-08-17T03:00:00.000Z"),
        raw: {},
      },
    });
    const day2Middle = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "5.00",
        isRevision: true,
        revisionOf: day2Original.id,
        retrievedAt: new Date("2026-08-17T02:00:00.000Z"),
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: DAY_2,
        value: "6.00",
        isRevision: true,
        revisionOf: day2Middle.id,
        retrievedAt: new Date("2026-08-17T01:00:00.000Z"),
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

  it("shows the revision, although it was fetched before the value it replaced", async () => {
    const { getRecentObservationPair } = await import("@/server/domain/seriesReadings");
    const pair = await getRecentObservationPair(seriesId);
    expect(pair).not.toBeNull();

    // 6.00, the tail of a chain retrieved in reverse — not 4.00 (newest retrievedAt, the original)
    // and not 5.00 (the middle row a "latest revision" heuristic would reach).
    expect(pair!.current.value.toString()).toBe("6");
    expect(pair!.previous.value.toString()).toBe("2.5");
  });

  it("answers the same way every time", async () => {
    // The failure this guards against was never a wrong constant; it was a wrong answer that
    // depended on row order, so a single passing read proves very little.
    const { getRecentObservationPair } = await import("@/server/domain/seriesReadings");
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const pair = await getRecentObservationPair(seriesId);
      seen.add(`${pair!.current.value.toString()}|${pair!.previous.value.toString()}`);
    }
    expect([...seen]).toEqual(["6|2.5"]);
  });

  it("gives every reader of the series the same revised values", async () => {
    const { getObservationsOneRowPerDate } = await import("@/server/domain/seriesReadings");
    const rows = await getObservationsOneRowPerDate(seriesId);
    expect(rows.map((r) => r.value.toString())).toEqual(["2.5", "6"]);
  });

  it("renders the revised value on the calendar, not the last-retrieved one", async () => {
    const { computeCalendarEntry } = await import("@/server/domain/economicCalendar");
    const entry = await computeCalendarEntry(seriesId);
    // 6, not 4. lastObservedValue reaches a user.
    expect(entry.lastObservedValue).toBe(6);
  });

  it("extends the chain from its tail when a further revision arrives", async () => {
    // The write path has to agree with the read path about which row is current, or the next
    // revision attaches to the wrong parent and the chain forks.
    const { upsertRevisionAwareObservation } = await import("@/server/domain/observationIngest");
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: DAY_1,
      value: "2.25",
      raw: {},
    });
    expect(status).toBe("revised");

    const { getRecentObservationPair } = await import("@/server/domain/seriesReadings");
    const pair = await getRecentObservationPair(seriesId);
    expect(pair!.previous.value.toString()).toBe("2.25");

    const chain = await prisma.observation.findMany({
      where: { seriesId, observationDate: DAY_1 },
      select: { value: true, revisionOf: true },
    });
    // Three rows in one line, not two rows and a fork: exactly one has no parent.
    expect(chain.length).toBe(3);
    expect(chain.filter((r) => r.revisionOf === null).length).toBe(1);
  });
});
