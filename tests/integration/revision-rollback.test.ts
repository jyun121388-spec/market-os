import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Hypothesis under test (proposed by `gpt-5.6-sol`, final RC audit):
 *
 *   "A delayed older ingest may become the newest revision and roll a correct value backward."
 *
 * `upsertRevisionAwareObservation` compares an incoming value against the CURRENT CHAIN TAIL and
 * appends a revision whenever they differ. It has no notion of which value is more recent AT THE
 * SOURCE — only of which arrived at us last.
 *
 * That matters because "retrieved later" is not "truer". A provider CDN serving a stale cached
 * response, a lagging read replica, or a retried job from an earlier queue all deliver an OLD
 * value at a NEW time. If such a response lands after a legitimate revision, the question is
 * whether the stale figure becomes the authoritative one.
 *
 * OUTCOME: REPRODUCED. The replay became the chain tail and the read path served it. The guard
 * in `observationIngest.ts` now refuses a value that already appears earlier in the same chain.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_REVISION_ROLLBACK_SOURCE";
const OBS_DATE = new Date("2026-08-01T00:00:00.000Z");

describeIfDb("delayed older ingest vs a legitimate newer revision", () => {
  let prisma: typeof PrismaClientInstance;
  let upsertRevisionAwareObservation: typeof import("@/server/domain/observationIngest").upsertRevisionAwareObservation;
  let getRecentObservationPair: typeof import("@/server/domain/seriesReadings").getRecentObservationPair;
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
    ({ getRecentObservationPair } = await import("@/server/domain/seriesReadings"));

    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Revision rollback test source", tier: "TIER_S" },
    });
    sourceId = source.id;
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "ROLLBACK",
        name: "Rollback",
        unit: "percent",
        frequency: "monthly",
      },
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function currentValue(): Promise<number | null> {
    const rows = await prisma.observation.findMany({
      where: { seriesId, observationDate: OBS_DATE },
      orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
    });
    const { findRevisionChainTail } = await import("@/server/domain/revisionChain");
    const tail = findRevisionChainTail(rows);
    return tail ? Number(tail.value.toString()) : null;
  }

  it("stores the original, then a legitimate revision", async () => {
    const ingest = (value: string) =>
      upsertRevisionAwareObservation({
        seriesId,
        sourceId,
        observationDate: OBS_DATE,
        value,
        raw: {},
      });

    expect(await ingest("100")).toBe("inserted");
    expect(await ingest("110")).toBe("revised");
    expect(await currentValue()).toBe(110);
  });

  it("refuses a delayed response that replays an already-superseded value", async () => {
    // The reproduction, now inverted. Before the rollback guard this returned "revised" and the
    // authoritative value became 100 again — a figure the provider had already superseded, served
    // to users by the read path.
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      value: "100",
      raw: { note: "stale cached response replaying a superseded value" },
    });

    expect(status).toBe("stale_ignored");
    expect(await currentValue()).toBe(110);
  });

  it("writes no row for the ignored replay", async () => {
    // Ignoring must actually mean ignoring. A row appended "for the audit trail" would become
    // the chain tail, which is the whole defect.
    const rows = await prisma.observation.count({ where: { seriesId, observationDate: OBS_DATE } });
    expect(rows).toBe(2); // the original and the one legitimate revision
  });

  it("still accepts a genuinely new value after the ignored replay", async () => {
    // The negative control that matters most: the guard must not wedge the chain. A provider
    // moving on to a value it has never published before is a real revision and must apply.
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      value: "115",
      raw: {},
    });
    expect(status).toBe("revised");
    expect(await currentValue()).toBe(115);
  });

  it("still treats a repeat of the CURRENT value as unchanged, not as a replay", async () => {
    // Idempotency. Re-ingesting the same data must stay a no-op rather than being mistaken for
    // a stale replay — otherwise every ordinary re-run would start reporting stale_ignored.
    const status = await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: OBS_DATE,
      value: "115",
      raw: {},
    });
    expect(status).toBe("unchanged");
    expect(await currentValue()).toBe(115);
  });

  it("the read path serves the value the provider currently publishes", async () => {
    await upsertRevisionAwareObservation({
      seriesId,
      sourceId,
      observationDate: new Date("2026-07-01T00:00:00.000Z"),
      value: "90",
      raw: {},
    });
    const pair = await getRecentObservationPair(seriesId);
    expect(pair).not.toBeNull();
    expect(Number(pair!.current.value.toString())).toBe(115);
  });
});
