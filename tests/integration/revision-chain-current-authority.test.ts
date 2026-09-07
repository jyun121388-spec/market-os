import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * IR-131 — which row of a revision chain is CURRENT, driven through the PRODUCTION read path.
 *
 * The defect was reproduced on a real database on 2026-09-06, not reasoned about. The writer
 * attaches each new row to the chain's current tail, so chain structure encodes ARRIVAL order;
 * `findRevisionChainTail` then faithfully returns the last-arrived row. That is fine while
 * everything arrives in the order it happened, and wrong the moment history arrives after the
 * present. Ingesting FRED's vintage history into a chain that already held the current value put
 * three older vintages after the newest one, and the read path served 300.456 — a 2025-02-12
 * vintage — where the current value is 300.420.
 *
 * These controls go through `getRecentObservationPair` and `getObservationsOneRowPerDate`, which
 * are what Morning Brief, What Changed, Macro Regime, Ask Market, Economic Calendar, Historical
 * Analog and the Verify shadow run actually call. A helper-only control would prove nothing about
 * what a user sees, and the mutation suite for this unit reaches these same two functions.
 *
 * The 43 real CPIAUCSL rows that demonstrate the bug are NOT touched by any of this: the mechanism
 * is rebuilt here from fixtures so the forensic example can stay exactly as measured.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_CURRENT_AUTHORITY_SOURCE";
/** The date under test. */
const D2 = new Date("2026-08-01T00:00:00.000Z");
/** An older date carrying one uncontested row, so `getRecentObservationPair` always has a previous. */
const D1 = new Date("2026-07-01T00:00:00.000Z");

const iso = (d: string) => new Date(`${d}T00:00:00.000Z`);

describeIfDb("IR-131: current-value authority through the production read path", () => {
  let prisma: typeof PrismaClientInstance;
  let upsert: typeof import("@/server/domain/observationIngest").upsertRevisionAwareObservation;
  let getRecentObservationPair: typeof import("@/server/domain/seriesReadings").getRecentObservationPair;
  let getObservationsOneRowPerDate: typeof import("@/server/domain/seriesReadings").getObservationsOneRowPerDate;
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
    ({ upsertRevisionAwareObservation: upsert } =
      await import("@/server/domain/observationIngest"));
    ({ getRecentObservationPair, getObservationsOneRowPerDate } =
      await import("@/server/domain/seriesReadings"));
    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Current authority test source", tier: "TIER_S" },
    });
    sourceId = source.id;
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "AUTHORITY",
        name: "Authority",
        unit: "index",
        frequency: "monthly",
      },
    });
    seriesId = series.id;
  });

  afterEach(async () => {
    await prisma.observation.deleteMany({ where: { seriesId } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /** Writes through the real ingest path, so the chain is linked exactly as production links it. */
  const write = (
    observationDate: Date,
    value: string,
    releaseDate: Date | null,
    raw: Prisma.InputJsonValue = {},
  ) => upsert({ seriesId, sourceId, observationDate, value, releaseDate, raw });

  /** One uncontested older date, so the pair reader always has a `previous` to return. */
  const givenAPreviousDate = () => write(D1, "50", iso("2026-07-10"));

  const currentValueOnD2 = async (): Promise<string | null> => {
    const pair = await getRecentObservationPair(seriesId);
    return pair ? pair.current.value.toString() : null;
  };

  // ---------------------------------------------------------------- A
  it("A: the current row arrives first and older vintages arrive after — current stays current", async () => {
    // The exact shape that produced the defect. Newest vintage written FIRST, so it is the chain
    // ORIGINAL and every later row is linked after it; arrival order says the last one wins, and
    // the provider says otherwise.
    await givenAPreviousDate();
    await write(D2, "300.420", iso("2026-02-13"), { vintage: "current" });
    await write(D2, "300.536", iso("2023-02-14"), { vintage: "oldest" });
    await write(D2, "300.456", iso("2025-02-12"), { vintage: "middle" });

    expect(await currentValueOnD2()).toBe("300.42");

    // And the arrival-ordered answer, asserted explicitly so this control cannot pass by
    // coincidence: the structural tail is the LAST row written, which is not the current value.
    const rows = await prisma.observation.findMany({ where: { seriesId, observationDate: D2 } });
    const referenced = new Set(rows.map((r) => r.revisionOf).filter(Boolean));
    const structuralTail = rows.find((r) => !referenced.has(r.id))!;
    expect(structuralTail.value.toString()).toBe("300.456");
  });

  // ---------------------------------------------------------------- B
  it("B: vintages arrive oldest to newest — the newest authoritative vintage wins", async () => {
    await givenAPreviousDate();
    await write(D2, "300.536", iso("2023-02-14"));
    await write(D2, "300.356", iso("2024-02-09"));
    await write(D2, "300.420", iso("2026-02-13"));

    expect(await currentValueOnD2()).toBe("300.42");
  });

  // ---------------------------------------------------------------- C
  it("C: identical retrievedAt and random ids cannot change the answer", async () => {
    // `retrievedAt` is timestamp(3) and rows written in the same millisecond are indistinguishable;
    // ids are random UUIDs. Both are forced to the SAME value here, so if either were deciding, the
    // answer would be arbitrary. Run repeatedly because an arbitrary answer can be right by luck.
    await givenAPreviousDate();
    await write(D2, "300.420", iso("2026-02-13"));
    await write(D2, "300.536", iso("2023-02-14"));
    await write(D2, "300.456", iso("2025-02-12"));
    await prisma.observation.updateMany({
      where: { seriesId, observationDate: D2 },
      data: { retrievedAt: new Date("2026-09-06T00:00:00.000Z") },
    });

    for (let i = 0; i < 5; i++) expect(await currentValueOnD2()).toBe("300.42");
  });

  // ---------------------------------------------------------------- D
  it("D: a chain mixing provider-dated and undated rows refuses to guess", async () => {
    // The real CPIAUCSL shape: an ordinary ingest wrote the current value with no vintage, then a
    // vintage history was appended. The undated row cannot be placed against the dated ones, and
    // arrival order is the thing that is not trustworthy — so there is nothing to fall back to.
    await givenAPreviousDate();
    await write(D2, "300.420", null, { from: "ordinary ingest" });
    await write(D2, "300.536", iso("2023-02-14"));
    await write(D2, "300.456", iso("2025-02-12"));

    // The series becomes unreadable rather than serving 300.456, which is what it served before.
    expect(await getRecentObservationPair(seriesId)).toBeNull();
    // The history reader omits that date and keeps the rest, which is its own existing containment.
    const history = await getObservationsOneRowPerDate(seriesId);
    expect(history.map((r) => r.observationDate.getTime())).toEqual([D1.getTime()]);
  });

  it("D2: two rows claiming the same provider vintage also refuse", async () => {
    await givenAPreviousDate();
    await write(D2, "300.420", iso("2026-02-13"));
    await write(D2, "300.456", iso("2026-02-13"));
    expect(await getRecentObservationPair(seriesId)).toBeNull();
  });

  // ---------------------------------------------------------------- E
  it("E: a chain with no vintages anywhere behaves exactly as it always did", async () => {
    // Every chain this repository held before IR-130 is in this case. The structural tail is the
    // answer, and the answer must not move.
    await givenAPreviousDate();
    await write(D2, "100", null);
    await write(D2, "110", null);
    await write(D2, "120", null);

    expect(await currentValueOnD2()).toBe("120");
    const history = await getObservationsOneRowPerDate(seriesId);
    expect(history.map((r) => r.value.toString())).toEqual(["50", "120"]);
  });

  it("E2: a single uncontested row is unaffected, dated or not", async () => {
    await givenAPreviousDate();
    await write(D2, "7.5", null);
    expect(await currentValueOnD2()).toBe("7.5");
    await prisma.observation.deleteMany({ where: { seriesId, observationDate: D2 } });
    await write(D2, "8.5", iso("2026-03-01"));
    expect(await currentValueOnD2()).toBe("8.5");
  });

  // ---------------------------------------------------------------- F
  it("F: a replayed equal value cannot corrupt current authority", async () => {
    // IR-021's rollback guard is a WRITE-side mechanism and stays exactly as it was: a value that
    // already appears earlier in the chain is refused, whatever vintage it claims. This control
    // exists to prove the read-side change did not weaken it — if the replay were ever admitted, it
    // would be appended after the current row and arrival order would be back in charge.
    await givenAPreviousDate();
    await write(D2, "300.420", iso("2026-02-13"));
    await write(D2, "300.536", iso("2023-02-14"));

    const replay = await write(D2, "300.420", iso("2027-01-01"), { replay: true });
    expect(replay).toBe("stale_ignored");
    expect(await prisma.observation.count({ where: { seriesId, observationDate: D2 } })).toBe(2);
    expect(await currentValueOnD2()).toBe("300.42");
  });
});
