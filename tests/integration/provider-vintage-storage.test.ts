import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * IR-130: `Observation.releaseDate` has existed since M08 and nothing could ever write to it.
 *
 * The column was added for the provider's own statement of when a value became current — the
 * evidence the provider-vintage contract in `src/server/fabric/vintage.ts` was designed around and
 * has never once been given. `ObservationIngestInput` had no field to carry one, so the only path
 * that creates observation rows could not reach the column. `observationIngest.ts` says so in its
 * rollback-guard comment, and names the two things that were missing: an adapter that populates it
 * and a key that would let anyone verify what the provider means by it. HG-002 supplied both on
 * 2026-09-06.
 *
 * These controls bind the STORAGE half only, which is the whole of this unit. Nothing here orders
 * two readings by release date; the rollback guard is untouched and still refuses a value that
 * reappears in a chain. Using the provider's vintage to decide which reading is newer changes V1
 * revision semantics and is escalated rather than taken.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_PROVIDER_VINTAGE_SOURCE";
const OBS_DATE = new Date("2026-08-01T00:00:00.000Z");

describeIfDb("a provider's own release date reaches the column that was built for it", () => {
  let prisma: typeof PrismaClientInstance;
  let upsertRevisionAwareObservation: typeof import("@/server/domain/observationIngest").upsertRevisionAwareObservation;
  let sourceId: string;
  let seriesId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ upsertRevisionAwareObservation } = await import("@/server/domain/observationIngest"));

    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Provider vintage test source", tier: "TIER_S" },
    });
    sourceId = source.id;
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "VINTAGE",
        name: "Vintage",
        unit: "index",
        frequency: "monthly",
      },
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /**
   * Deliberately UNORDERED, and the first version of this file got that wrong.
   *
   * It ordered by `retrievedAt` then `id`, and the two rows tied: `retrievedAt` is
   * `timestamp(3)` and both inserts land inside the same millisecond, after which `id` is a random
   * UUID. So the ordering was arbitrary and the assertion failed against correct data. That is the
   * exact defect `revisionChain.ts` exists for — "the clock cannot answer this question" — and
   * reproducing it inside a test written about revision chains is a good demonstration that the
   * module is needed. Every assertion below identifies rows by what they ARE.
   */
  const rows = () =>
    prisma.observation.findMany({ where: { seriesId, observationDate: OBS_DATE } });

  it("stores it on the original, where before there was no way to send one", async () => {
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      releaseDate: new Date("2026-09-15T00:00:00.000Z"),
      value: "100.5",
      raw: { vintage: 1 },
    });
    expect(status).toBe("inserted");
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].releaseDate?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(all[0].isRevision).toBe(false);
  });

  it("stores it on a revision too, so a chain carries one per vintage", async () => {
    // The shape a realtime-range ingest produces: the same observation date, several values, each
    // with the date IT became current. Without a release date per row the chain records only the
    // order they reached us, which is the ordering IR-021 proved untrustworthy.
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      releaseDate: new Date("2026-10-15T00:00:00.000Z"),
      value: "101.25",
      raw: { vintage: 2 },
    });
    expect(status).toBe("revised");

    const all = await rows();
    expect(all).toHaveLength(2);
    const original = all.find((r) => !r.isRevision)!;
    const revision = all.find((r) => r.isRevision)!;
    // Each row carries ITS OWN vintage, which is the property: one release date per value, not one
    // per observation date.
    expect(original.releaseDate?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(revision.releaseDate?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(original.value.toString()).toBe("100.5");
    expect(revision.value.toString()).toBe("101.25");
    // The chain itself is unchanged: the revision still attaches to the original by `revisionOf`,
    // and the release date rides along rather than replacing that structure.
    expect(revision.revisionOf).toBe(original.id);
  });

  it("leaves the column NULL when the caller sends none, so every existing path is unchanged", async () => {
    // The additive guarantee, asserted rather than assumed. Every caller in the repository except
    // the vintage-aware FRED ingest omits this field, and their rows must look exactly as before.
    const other = new Date("2026-08-02T00:00:00.000Z");
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: other,
      value: "12.5",
      raw: { noVintage: true },
    });
    expect(status).toBe("inserted");
    const [row] = await prisma.observation.findMany({
      where: { seriesId, observationDate: other },
    });
    expect(row.releaseDate).toBeNull();
  });

  it("does not let a release date override the rollback guard", async () => {
    // The boundary of this unit, stated as a control. A replayed value is still refused even when
    // the provider stamps it with the newest release date of the three — because ORDERING on the
    // provider's vintage is a V1 revision-semantics change that has not been decided. If this ever
    // returns "revised", that decision was taken by accident.
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      releaseDate: new Date("2026-11-15T00:00:00.000Z"),
      value: "100.5",
      raw: { vintage: 3, replayOfVintage: 1 },
    });
    expect(status).toBe("stale_ignored");
    expect(await rows()).toHaveLength(2);
  });
});
