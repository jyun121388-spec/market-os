import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * IR-133 — what a REFUSED date does to consumers that read the history as contiguous.
 *
 * IR-131 made `getObservationsOneRowPerDate` omit a date whose current value cannot be proven.
 * Omitting is correct: the alternative is serving a superseded number. The open question, raised
 * by adversarial review of IR-131 and left unreproduced there, was whether a consumer then reads
 * the SHORTER array as though the remaining dates were adjacent periods.
 *
 * Measured on 2026-09-08 through the real consumers, on a linear monthly ramp where value =
 * 100 + monthIndex, so a true N-period change is exactly N and any other number is arithmetically
 * wrong rather than a matter of interpretation:
 *
 *     contiguous       2024-02: trailing=1  +1=1  +3=3  +6=6      correct
 *     hole at 2024-07  2024-02: trailing=1  +1=1  +3=3  +6=7      WRONG
 *                      2024-04: trailing=1  +1=1  +3=4  +6=7      WRONG
 *
 * `subsequentChange3` reported 4 and `subsequentChange6` reported 7. Those fields name a period
 * count, and `historicalAnalog` computes them as `points[fromIndex + windowsAhead]` — array index
 * used as period identity. One omitted date shifts every later index by one, so the label and the
 * arithmetic disagree.
 *
 * The calendar behaved differently and is measured here too, because the difference is the point:
 * it computes intervals from real date subtraction, so an omitted interior date inflates ONE
 * interval and the median absorbs it (measured: 31d before and after). A safe omission is not a
 * defect; a consumer inventing period semantics from it is.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_HOLE_COMPRESSION_SOURCE";
const MONTHS = 14;
const monthDate = (i: number) => new Date(Date.UTC(2024, i, 1));

describeIfDb("IR-133: a refused date must not become an adjacent period", () => {
  let prisma: typeof PrismaClientInstance;
  let upsert: typeof import("@/server/domain/observationIngest").upsertRevisionAwareObservation;
  let getObservationsOneRowPerDate: typeof import("@/server/domain/seriesReadings").getObservationsOneRowPerDate;
  let computeHistoricalAnalog: typeof import("@/server/domain/historicalAnalog").computeHistoricalAnalog;
  let computeCalendarEntry: typeof import("@/server/domain/economicCalendar").computeCalendarEntry;
  let sourceId: string;

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
    ({ getObservationsOneRowPerDate } = await import("@/server/domain/seriesReadings"));
    ({ computeHistoricalAnalog } = await import("@/server/domain/historicalAnalog"));
    ({ computeCalendarEntry } = await import("@/server/domain/economicCalendar"));
    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Hole compression", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /**
   * A monthly ramp. `holes` names the month indexes whose CURRENT VALUE becomes unprovable through
   * the IR-131 path — a chain mixing an undated row with a provider-dated one. Nothing is deleted:
   * the rows stay stored and the date simply stops being answerable, which is the exact shape the
   * real CPIAUCSL chains are in.
   */
  async function rampSeries(
    externalId: string,
    holes: number[] = [],
    opts: { months?: number; frequency?: string; skip?: number[] } = {},
  ): Promise<string> {
    const months = opts.months ?? MONTHS;
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId,
        name: externalId,
        unit: "index",
        frequency: opts.frequency ?? "monthly",
      },
    });
    for (let i = 0; i < months; i++) {
      if (opts.skip?.includes(i)) continue;
      await upsert({
        seriesId: series.id,
        sourceId,
        observationDate: monthDate(i),
        value: String(100 + i),
        releaseDate: null,
        raw: { i },
      });
      if (holes.includes(i)) {
        await upsert({
          seriesId: series.id,
          sourceId,
          observationDate: monthDate(i),
          value: String(100 + i + 0.5),
          releaseDate: new Date(Date.UTC(2026, 0, 1)),
          raw: { i, vintage: true },
        });
      }
    }
    return series.id;
  }

  /**
   * A monthly series with EXPLICIT values and no refusals at all. The ramp helper above cannot
   * express what control L1 needs: on a ramp every trailing change is identical, so a perfect
   * similarity score could always be explained away as the changes genuinely being equal.
   */
  async function valueSeries(externalId: string, values: number[]): Promise<string> {
    const series = await prisma.series.create({
      data: { sourceId, externalId, name: externalId, unit: "index", frequency: "monthly" },
    });
    for (let i = 0; i < values.length; i++) {
      await upsert({
        seriesId: series.id,
        sourceId,
        observationDate: monthDate(i),
        value: String(values[i]),
        releaseDate: null,
        raw: { i },
      });
    }
    return series.id;
  }

  const months = (rows: { observationDate: Date }[]) =>
    rows.map((r) => r.observationDate.toISOString().slice(0, 7));

  /** Every reported lookahead, as `{label -> value}`, for the analog engine on a ramp. */
  async function lookaheads(seriesId: string) {
    const analog = await computeHistoricalAnalog(seriesId, { windowSize: 1, topK: 12 });
    if (analog.status === "INSUFFICIENT_DATA") return null;
    return analog.matches.map((m) => ({
      asOf: m.asOfDate,
      trailing: m.historicalTrailingChange,
      plus1: m.subsequentChange1,
      plus3: m.subsequentChange3,
      plus6: m.subsequentChange6,
    }));
  }

  // ---------------------------------------------------------------- A
  it("A: contiguous monthly history is unchanged — every N-period change is exactly N", async () => {
    const id = await rampSeries("A_CONTIGUOUS");
    expect(months(await getObservationsOneRowPerDate(id))).toHaveLength(MONTHS);
    for (const m of (await lookaheads(id))!) {
      expect(m.trailing, `${m.asOf} trailing`).toBe(1);
      if (m.plus1 !== null) expect(m.plus1, `${m.asOf} +1`).toBe(1);
      if (m.plus3 !== null) expect(m.plus3, `${m.asOf} +3`).toBe(3);
      if (m.plus6 !== null) expect(m.plus6, `${m.asOf} +6`).toBe(6);
    }
  });

  // ---------------------------------------------------------------- B
  it("B: contiguous quarterly history is unchanged — cadence comes from the dates, not the index", async () => {
    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "B_QUARTERLY",
        name: "B_QUARTERLY",
        unit: "index",
        frequency: "quarterly",
      },
    });
    for (let q = 0; q < 12; q++) {
      await upsert({
        seriesId: series.id,
        sourceId,
        observationDate: new Date(Date.UTC(2022, q * 3, 1)),
        value: String(100 + q),
        releaseDate: null,
        raw: { q },
      });
    }
    const cal = await computeCalendarEntry(series.id);
    expect(cal.status).toBe("PROJECTED");
    // A quarter, not a month: the interval is measured, so the shape of the series decides.
    expect(cal.medianIntervalDays).toBeGreaterThan(80);
    expect(cal.medianIntervalDays).toBeLessThan(95);
    for (const m of (await lookaheads(series.id))!) {
      expect(m.trailing).toBe(1);
      if (m.plus3 !== null) expect(m.plus3).toBe(3);
    }
  });

  // ---------------------------------------------------------------- C
  it("C: one interior refused date must not become a one-period adjacency", async () => {
    // THE REPRODUCTION. Before IR-133 this returned +3=4 and +6=7 for windows spanning the hole:
    // a field named for a period count reporting a different period count.
    const id = await rampSeries("C_INTERIOR", [6]);
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned).toHaveLength(MONTHS - 1);
    expect(returned).not.toContain("2024-07");

    for (const m of (await lookaheads(id))!) {
      // Every value still reported must be arithmetically what its name claims. A window that
      // cannot prove its span is expected to be withheld, not adjusted.
      expect(m.trailing, `${m.asOf} trailing`).toBe(1);
      if (m.plus1 !== null) expect(m.plus1, `${m.asOf} +1`).toBe(1);
      if (m.plus3 !== null) expect(m.plus3, `${m.asOf} +3`).toBe(3);
      if (m.plus6 !== null) expect(m.plus6, `${m.asOf} +6`).toBe(6);
    }
  });

  // ---------------------------------------------------------------- D
  it("D: two consecutive interior refusals must not collapse into one period", async () => {
    const id = await rampSeries("D_TWO_GAPS", [6, 7]);
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned).toHaveLength(MONTHS - 2);
    expect(returned).not.toContain("2024-07");
    expect(returned).not.toContain("2024-08");
    for (const m of (await lookaheads(id))!) {
      expect(m.trailing, `${m.asOf} trailing`).toBe(1);
      if (m.plus1 !== null) expect(m.plus1, `${m.asOf} +1`).toBe(1);
      if (m.plus3 !== null) expect(m.plus3, `${m.asOf} +3`).toBe(3);
    }
  });

  // ---------------------------------------------------------------- E / F
  it("E: a first-boundary refusal creates no false interior interval", async () => {
    const id = await rampSeries("E_FIRST", [0]);
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned[0]).toBe("2024-02");
    for (const m of (await lookaheads(id))!) {
      expect(m.trailing).toBe(1);
      if (m.plus3 !== null) expect(m.plus3).toBe(3);
      if (m.plus6 !== null) expect(m.plus6).toBe(6);
    }
  });

  it("F: a last-boundary refusal makes the newest period unanswerable, and the analog says so", async () => {
    // Re-expressed after adversarial review found the hole in the first repair. A refusal NEWER
    // than every answerable point lies outside every span, so the between-two-points check cannot
    // see it — and the engine would have taken the previous month's window as "current" and
    // analysed it under the current-period contract. That is the same substitution as the interior
    // case, arriving from the one direction the check was blind to.
    //
    // The two consumers differ here, and both are right. The analog is ABOUT the current period, so
    // it fails closed. The calendar reports the newest date it could actually answer about and says
    // which one that is, which is honest rather than silent.
    const id = await rampSeries("F_LAST", [MONTHS - 1]);
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned).not.toContain("2025-02");

    const analog = await computeHistoricalAnalog(id, { windowSize: 1, topK: 3 });
    expect(analog.status).toBe("INSUFFICIENT_DATA");
    expect(analog.matches).toEqual([]);

    const cal = await computeCalendarEntry(id);
    expect(cal.status).toBe("PROJECTED");
    expect(cal.lastObservedDate).toBe("2025-01-01");
  });

  it("F2: ZERO provable windows after the drop refuses rather than inventing a distribution", async () => {
    // Also from review. The sample-size guard used to run on the UNFILTERED list, so a history
    // whose windows were nearly all unprovable could reach the statistics with none at all.
    //
    // Holes at every other month leave nothing earlier provable: every surviving pair spans a
    // withheld date except the newest one, so the current window stands alone.
    const id = await rampSeries("F2_SPARSE", [1, 3, 5, 7, 9, 11]);
    const returned = months(await getObservationsOneRowPerDate(id));
    // Pinning the shape, because "INSUFFICIENT_DATA" alone does not say WHICH branch refused.
    // The last two months both survive and nothing is withheld after them, so the CURRENT window
    // is provable — this cannot be control J's branch, and it is the historical count that is 0.
    expect(returned.slice(-2)).toEqual(["2025-01", "2025-02"]);

    const analog = await computeHistoricalAnalog(id, { windowSize: 1, topK: 3 });
    expect(analog.status).toBe("INSUFFICIENT_DATA");
    expect(analog.matches).toEqual([]);
    // The one-survivor case is control L1's, not this one's. It used to be asserted here with
    // `matches.every(m => m.similarityScore < 1)`, which is VACUOUSLY TRUE on an empty array —
    // independent review named that as the reason this control could not close the P1 it claimed.
  });

  // ---------------------------------------------------------------- L1
  it("L1: exactly ONE surviving historical comparator refuses instead of scoring a perfect analog", async () => {
    // [CHATGPT_VERIFIED][MARKET-HISTORY-HOLE-COMPRESSION-20260907] REWORK_REQUIRED. The previous
    // guard was `historical.length < 1`, so exactly one survivor was accepted. With one point the
    // distribution has no spread: `sd` is 0, both z-scores are forced to 0, and the score is
    // round(1 / (1 + 0), 4) = 1 no matter how far apart the two changes actually are.
    //
    // No refusals are involved. Three plainly answerable points are enough, which is the finding:
    // the mechanism lives in the statistics, not in the IR-133 filtering.
    //
    // Measured on the pre-repair tree through this exact path:
    //     values 100, 101, 111   status COMPUTED   sampleSize 1
    //     currentTrailingChange 10, match 2024-02 historicalTrailingChange 1, similarityScore 1
    //
    // +1 against +10 is an order of magnitude apart, so a perfect score cannot be explained away
    // as the changes being genuinely equal — which is why the ramp helper cannot express this.
    const one = await valueSeries("L1_ONE_COMPARATOR", [100, 101, 111]);
    // The precondition, asserted rather than assumed: all three dates are answerable, so the
    // single comparator is a real one and not an artefact of something being withheld.
    expect(months(await getObservationsOneRowPerDate(one))).toHaveLength(3);

    const refused = await computeHistoricalAnalog(one, { windowSize: 1, topK: 3 });
    expect(refused.status).toBe("INSUFFICIENT_DATA");
    expect(refused.matches).toEqual([]);

    // The positive half, so "refuse whenever the history is short" cannot satisfy the assertion
    // above. One more comparator — and a DIFFERENT one, so the spread is real — must compute, and
    // must not hand back a perfect score for a change nothing in the history resembles.
    const two = await valueSeries("L1_TWO_COMPARATORS", [100, 101, 105, 115]);
    const computed = await computeHistoricalAnalog(two, { windowSize: 1, topK: 3 });
    expect(computed.status).toBe("COMPUTED");
    expect(computed.sampleSize).toBe(2);
    expect(computed.currentTrailingChange).toBe(10);
    expect(computed.matches.length).toBeGreaterThan(0);
    for (const m of computed.matches) {
      expect(
        m.historicalTrailingChange,
        "the comparators must differ from the current change",
      ).not.toBe(10);
      expect(m.similarityScore, `${m.asOfDate} must not score a perfect analog`).toBeLessThan(1);
    }
  });

  // ---------------------------------------------------------------- J
  it("J: when the CURRENT window itself spans a refusal, the whole result fails closed", async () => {
    // The window everything else is compared AGAINST. Controls C and D put the hole in the middle,
    // where the current window is unaffected — so neither of them reaches this branch, and without
    // this control the fail-closed path would be reachable only in principle. The hole here is the
    // second-to-last month, so the newest trailing change spans it.
    //
    // Falling back to an older window would be the worst available answer: it would report a real
    // number, correctly computed, under a name that means something else.
    const id = await rampSeries("J_CURRENT_SPANS", [MONTHS - 2]);
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned).not.toContain("2025-01");
    expect(returned[returned.length - 1]).toBe("2025-02");

    const analog = await computeHistoricalAnalog(id, { windowSize: 1, topK: 3 });
    expect(analog.status).toBe("INSUFFICIENT_DATA");
    expect(analog.matches).toEqual([]);
  });

  // ---------------------------------------------------------------- K
  it("K: a refusal outside a window does not withhold that window", async () => {
    // The positive control, so "withhold everything" cannot satisfy C, D and J vacuously. One
    // refusal near the START must leave the later windows fully answerable.
    const id = await rampSeries("K_EARLY_HOLE", [1]);
    const marks = await lookaheads(id);
    expect(marks, "later windows must still be answerable").not.toBeNull();
    const answered = marks!.filter((m) => m.plus3 !== null);
    expect(answered.length, "some window must still report a +3").toBeGreaterThan(0);
    for (const m of answered) expect(m.plus3, `${m.asOf} +3`).toBe(3);
  });

  // ---------------------------------------------------------------- G
  it("G: a legitimately irregular series is not rejected for being irregular", async () => {
    // No refusals at all — months 5 and 9 were simply never published. Nothing here is
    // unprovable, so nothing may be withheld: the engine must behave exactly as it always has.
    const id = await rampSeries("G_IRREGULAR", [], { skip: [5, 9] });
    const returned = months(await getObservationsOneRowPerDate(id));
    expect(returned).toHaveLength(MONTHS - 2);
    const marks = await lookaheads(id);
    expect(marks, "an irregular series must still produce analogs").not.toBeNull();
    expect(marks!.length).toBeGreaterThan(0);
    const cal = await computeCalendarEntry(id);
    expect(cal.status).toBe("PROJECTED");
  });

  // ---------------------------------------------------------------- H
  it("H: an absent observation and a refused one are different things", async () => {
    // Same visible dates, two different causes: G_ABSENT never had month 6; H_REFUSED has it
    // stored but unprovable. The reader returns the same date list for both, and that is exactly
    // why the distinction cannot be recovered downstream from the array alone.
    const absent = await rampSeries("H_ABSENT", [], { skip: [6] });
    const refused = await rampSeries("H_REFUSED", [6]);
    expect(months(await getObservationsOneRowPerDate(absent))).toEqual(
      months(await getObservationsOneRowPerDate(refused)),
    );
    // The rows still exist for the refused one, which is the evidence IR-131 preserved.
    const refusedRows = await prisma.observation.count({
      where: { series: { externalId: "H_REFUSED" }, observationDate: monthDate(6) },
    });
    expect(refusedRows).toBe(2);
    const absentRows = await prisma.observation.count({
      where: { series: { externalId: "H_ABSENT" }, observationDate: monthDate(6) },
    });
    expect(absentRows).toBe(0);
  });

  // ---------------------------------------------------------------- I
  it("I: a consumer that does not infer adjacency is behaviourally pinned", async () => {
    // The calendar reads real dates and subtracts them, so one inflated interval is absorbed by
    // the median rather than turning into a false cadence. Measured before and after the hole.
    const clean = await rampSeries("I_CLEAN");
    const holed = await rampSeries("I_HOLED", [6]);
    const a = await computeCalendarEntry(clean);
    const b = await computeCalendarEntry(holed);
    expect(a.status).toBe("PROJECTED");
    expect(b.status).toBe("PROJECTED");
    expect(b.medianIntervalDays).toBe(a.medianIntervalDays);
    expect(b.lastObservedDate).toBe(a.lastObservedDate);
    expect(b.lastObservedValue).toBe(a.lastObservedValue);
  });
});
