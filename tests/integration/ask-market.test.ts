import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_ASK_MARKET_SOURCE";
/**
 * A SECOND provider that happens to use the same corpCode string as the first. Both unique
 * indexes on financial_facts begin with sourceId, so the schema states plainly that a corpCode
 * identifies a company only WITHIN one source — `corpCode` alone is not a company.
 */
const OTHER_SOURCE_CODE = "TEST_ASK_MARKET_OTHER_SOURCE";
const SERIES_EXTERNAL_ID = "TEST_ASK_MARKET_SERIES";
const SERIES_NAME = "TEST Widget Price Index";
const CORP_NAME = "TEST Widget Corp";
const CORP_CODE = "TEST_WIDGET_CORP_CODE";

/**
 * Observation dates relative to now, not literals.
 *
 * These were fixed strings written on the day the fixture was, and once `askMarket` began checking
 * freshness the whole fixture aged into STALE and the tests failed for having been written ten days
 * earlier. A test of what a current-observation request returns must not also be a test of what
 * today's date is. Two days apart, so the projected cadence is daily and the newest reading is
 * inside it.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * A company needs more than one reported period to have a cadence at all.
 *
 * Every company here reported once, at a date fixed when the fixture was written, so once
 * `askMarket` began asking whether a filing figure is CURRENT there was nothing to answer with:
 * one period projects no interval, and unknown is not fresh. Two quarters, relative to now.
 */
/**
 * 1 January of the current UTC year, so a "this year" request has an opening boundary to stand on.
 *
 * The fixture had two readings a day apart and the change test asserted the difference between
 * them under a "this year" label — the temporal defect written down as an expectation. A period
 * request needs a series that spans the period.
 */
const YEAR_START = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

/** A reading dated ahead of the clock. It exists to prove it is never chosen as a period's end. */
const FUTURE_READING = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

/** A series that opens the year and then stops: the start boundary exists, the data does not. */
const ABANDONED_SERIES_NAME = "TEST Widget Abandoned Index";
/** A series that stopped in January AND carries a row dated in December. */
const FUTURE_CADENCE_SERIES_NAME = "TEST Widget Future Cadence Index";

const CURRENT_PERIOD_END = daysAgo(30);
/** A company that reported twice, years ago -- a derivable cadence, long past it. */
const STALE_CORP_NAME = "TEST Widget Dormant Corp";
const STALE_CORP_CODE = "TEST_WIDGET_DORMANT_CODE";
/** A company that has reported exactly once, so no cadence can be projected from it. */
const SINGLE_CORP_NAME = "TEST Widget Debutant Corp";
const SINGLE_CORP_CODE = "TEST_WIDGET_DEBUTANT_CODE";
const PRIOR_PERIOD_END = daysAgo(120);

/** A series whose newest observation is far past its own cadence. */
const STALE_SOURCE = "TEST_ASK_MARKET_STALE_SOURCE";
const STALE_SERIES_NAME = "TEST Widget Staleness Probe Index";
/** A topic both the fresh and the stale series answer to, for the mixed-result control. */
const SHARED_TOPIC = "TEST Widget Staleness Probe";
/** Two sources, one of whose whole names nests inside the other. */
const NESTED_SHORT_SOURCE = "TEST_ASK_MARKET_NESTED_SHORT";
const NESTED_LONG_SOURCE = "TEST_ASK_MARKET_NESTED_LONG";
const NESTED_LONG_SOURCE_NAME = "Rework Data Research";
const NESTED_SERIES_NAME = "TEST Widget Nested Source Index";
/** A series whose whole name nests inside NESTED_SERIES_NAME. */
const NESTED_SHORT_SERIES_NAME = "TEST Widget Nested Source";
/** A series with a single observation, so no cadence can be projected from it. */
const NO_CADENCE_SERIES_NAME = "TEST Widget Single Reading Index";

describeIfDb("askMarket (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let askMarket: typeof import("@/server/domain/askMarket").askMarket;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ askMarket } = await import("@/server/domain/askMarket"));

    for (const code of [
      SOURCE_CODE,
      OTHER_SOURCE_CODE,
      STALE_SOURCE,
      NESTED_SHORT_SOURCE,
      NESTED_LONG_SOURCE,
    ]) {
      const existingSource = await prisma.source.findUnique({ where: { code } });
      if (existingSource) {
        await prisma.financialFact.deleteMany({ where: { sourceId: existingSource.id } });
        await prisma.filing.deleteMany({ where: { sourceId: existingSource.id } });
        await prisma.observation.deleteMany({ where: { sourceId: existingSource.id } });
        await prisma.series.deleteMany({ where: { sourceId: existingSource.id } });
        await prisma.source.delete({ where: { id: existingSource.id } });
      }
    }
    await prisma.causalEdge.deleteMany({
      where: { fromVariable: { in: ["TEST: Widget demand (ask-market)", "TEST: Widget"] } },
    });

    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Test Ask Market Source", tier: "TIER_S" },
    });

    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: SERIES_EXTERNAL_ID,
        name: SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    // Dated ahead of the clock. A period that is still running ends at the clock, not at the
    // newest row, and this is the row that tells those two apart.
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: FUTURE_READING,
        value: "9999.0",
        raw: {},
      },
    });

    // The year's opening reading, deliberately far from the recent pair so that a year-to-date
    // change (102 - 90 = 12) cannot be confused with the latest-pair delta (102 - 100 = 2).
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: YEAR_START,
        value: "90.0",
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: daysAgo(2),
        value: "100.0",
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: daysAgo(1),
        value: "102.0",
        raw: {},
      },
    });

    await prisma.causalEdge.create({
      data: {
        fromVariable: "TEST: Widget demand (ask-market)",
        toVariable: SERIES_NAME,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "Test fixture, not a real economic claim.",
        evidence: "Test fixture.",
        lag: "immediate",
        counterexamples: "Test fixture limitation.",
      },
    });

    // A third edge whose CAUSE name nests inside the cause the request names. Without maximality
    // on the cause side, "TEST: Widget demand (ask-market)" also matches the stored "TEST: Widget"
    // and a second relation answers a question about the first.
    await prisma.causalEdge.create({
      data: {
        fromVariable: "TEST: Widget",
        toVariable: SERIES_NAME,
        direction: "POSITIVE",
        confidence: "LOW",
        mechanism: "Test fixture, not a real economic claim.",
        evidence: "Test fixture.",
        lag: "immediate",
        counterexamples: "Test fixture limitation.",
      },
    });

    // A second authentic edge sharing ONLY the cause with the one above. Without it, requiring
    // both endpoints and requiring either endpoint give the same answer for every query in this
    // file -- the mutation that relaxes the mechanism filter survived precisely because nothing
    // here could tell the two apart. IR-104 candidate Y4 in fixture form.
    await prisma.causalEdge.create({
      data: {
        fromVariable: "TEST: Widget demand (ask-market)",
        toVariable: "TEST: Widget warehouse rent (ask-market)",
        direction: "POSITIVE",
        confidence: "LOW",
        mechanism: "Test fixture, not a real economic claim.",
        evidence: "Test fixture.",
        lag: "immediate",
        counterexamples: "Test fixture limitation.",
      },
    });

    const filing = await prisma.filing.create({
      data: {
        sourceId: source.id,
        corpCode: CORP_CODE,
        corpName: CORP_NAME,
        reportName: "10-K",
        receiptNo: "TEST_ASK_MARKET_RCPT",
        receiptDate: new Date("2026-06-01T00:00:00.000Z"),
        raw: {},
      },
    });
    await prisma.financialFact.create({
      data: {
        sourceId: source.id,
        corpCode: filing.corpCode,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodEnd: CURRENT_PERIOD_END,
        fiscalYear: 2026,
        fiscalPeriod: "Q1",
        form: "10-Q",
        accessionNumber: "TEST_ACCN",
        filedDate: new Date("2026-05-01T00:00:00.000Z"),
        value: "1000000",
        raw: {},
      },
    });

    // The quarter before, so the company has a derivable reporting cadence. It is also the control
    // for the mixed case: an older period must not ride along with the current one.
    await prisma.financialFact.create({
      data: {
        sourceId: source.id,
        corpCode: filing.corpCode,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodEnd: PRIOR_PERIOD_END,
        fiscalYear: 2025,
        fiscalPeriod: "Q4",
        form: "10-Q",
        accessionNumber: "TEST_ACCN_PRIOR",
        filedDate: new Date("2026-02-01T00:00:00.000Z"),
        value: "900000",
        raw: {},
      },
    });

    // A second figure for the SAME fiscal label, differing only in how much time it covers —
    // the shape SEC actually produces (a year-to-date figure alongside a quarterly one). Both
    // must survive storage, and both must be distinguishable once displayed.
    await prisma.financialFact.create({
      data: {
        sourceId: source.id,
        corpCode: filing.corpCode,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodStart: daysAgo(120),
        periodEnd: CURRENT_PERIOD_END,
        fiscalYear: 2026,
        fiscalPeriod: "Q1",
        form: "10-Q",
        accessionNumber: "TEST_ACCN",
        filedDate: new Date("2026-05-01T00:00:00.000Z"),
        value: "250000",
        raw: {},
      },
    });

    // A different provider reporting a figure under the SAME corpCode. Nothing about this is
    // exotic: corpCode namespaces belong to their provider, and this project already stores SEC
    // CIKs and DART corp codes in one column. The value is deliberately absurd so that if it
    // ever appears in an answer about TEST Widget Corp, it is unmistakable.
    const otherSource = await prisma.source.create({
      data: { code: OTHER_SOURCE_CODE, name: "Test Ask Market Other Source", tier: "TIER_S" },
    });

    // A second provider tracking a series whose name also matches the topic. `Series` is unique
    // on (sourceId, externalId) — never on name — so this is a shape the schema explicitly
    // permits, and two providers publishing their own CPI or policy rate is the norm rather
    // than the exception.
    const otherSeries = await prisma.series.create({
      data: {
        sourceId: otherSource.id,
        externalId: "TEST_ASK_MARKET_SERIES_OTHER",
        name: SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      [daysAgo(2), "500.0"],
      [daysAgo(1), "530.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: otherSeries.id,
          sourceId: otherSource.id,
          observationDate: date,
          value,
          raw: {},
        },
      });
    }
    // IR-107 Unit 2 Phase B. A Korean-named series whose name is one COMPONENT of what a request
    // might ask about, so that "answered about half of what was asked" is reachable if the subject
    // identity rule is wrong. `KRW` alone is stored; nothing named `USD-KRW` exists.
    const koreanSeries = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TEST_ASK_MARKET_KRW",
        name: "KRW",
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      [daysAgo(2), "1300.0"],
      [daysAgo(1), "1320.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: koreanSeries.id,
          sourceId: source.id,
          observationDate: date,
          value,
          raw: {},
        },
      });
    }

    // A stale series: two observations a day apart, both long ago. Its own projected cadence is
    // daily, so being years old is unambiguously past it.
    const staleSource = await prisma.source.create({
      data: { code: STALE_SOURCE, name: "Test Ask Market Stale Source", tier: "TIER_S" },
    });
    const staleSeries = await prisma.series.create({
      data: {
        sourceId: staleSource.id,
        externalId: "TEST_ASK_MARKET_STALE_SERIES",
        name: STALE_SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      [daysAgo(400), "900.0"],
      [daysAgo(399), "999.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: staleSeries.id,
          sourceId: staleSource.id,
          observationDate: date,
          value,
          raw: {},
        },
      });
    }

    // A series with exactly one observation. Nothing can be projected from a single point, and
    // unknown freshness is not freshness.
    const singleSeries = await prisma.series.create({
      data: {
        sourceId: staleSource.id,
        externalId: "TEST_ASK_MARKET_SINGLE_SERIES",
        name: NO_CADENCE_SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: singleSeries.id,
        sourceId: staleSource.id,
        observationDate: daysAgo(1),
        value: "77.0",
        raw: {},
      },
    });

    // A company that stopped reporting. Two periods a quarter apart, both years old: the cadence
    // is derivable and the newest period is far past it.
    const dormantFiling = await prisma.filing.create({
      data: {
        sourceId: staleSource.id,
        corpCode: STALE_CORP_CODE,
        corpName: STALE_CORP_NAME,
        reportName: "10-K",
        receiptNo: "TEST_ASK_MARKET_DORMANT_RCPT",
        receiptDate: daysAgo(800),
        raw: {},
      },
    });
    for (const [periodEnd, value] of [
      [daysAgo(800), "500000"],
      [daysAgo(890), "480000"],
    ] as const) {
      await prisma.financialFact.create({
        data: {
          sourceId: staleSource.id,
          corpCode: dormantFiling.corpCode,
          taxonomy: "us-gaap",
          concept: "Revenues",
          unit: "USD",
          periodEnd,
          fiscalYear: 2024,
          fiscalPeriod: "Q1",
          form: "10-Q",
          accessionNumber: `TEST_DORMANT_ACCN_${value}`,
          filedDate: daysAgo(795),
          value,
          raw: {},
        },
      });
    }

    // Opens the current year and then stops. Its start boundary exists, so only freshness can
    // refuse it -- which makes it the case that tells the freshness check apart from the boundary
    // rules around it.
    const abandoned = await prisma.series.create({
      data: {
        sourceId: staleSource.id,
        externalId: "TEST_ASK_MARKET_ABANDONED",
        name: ABANDONED_SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      [YEAR_START, "10.0"],
      [new Date(YEAR_START.getTime() + 24 * 60 * 60 * 1000), "11.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: abandoned.id,
          sourceId: staleSource.id,
          observationDate: date,
          value,
          raw: {},
        },
      });
    }

    // Four daily readings in early January, plus a row dated at the end of the year. The two
    // properties have to be composed to catch anything: endpoint selection already excluded the
    // future row, but freshness was measured against it, so a change ending weeks stale was
    // certified current by a NEGATIVE age.
    const futureCadence = await prisma.series.create({
      data: {
        sourceId: staleSource.id,
        externalId: "TEST_ASK_MARKET_FUTURE_CADENCE",
        name: FUTURE_CADENCE_SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      ["2026-01-01", "10"],
      ["2026-01-02", "11"],
      ["2026-01-03", "12"],
      ["2026-01-04", "13"],
      ["2026-12-31", "9999"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: futureCadence.id,
          sourceId: staleSource.id,
          observationDate: new Date(`${date}T00:00:00.000Z`),
          value,
          raw: {},
        },
      });
    }

    // A company with exactly one reported period. One point projects no interval, so whether the
    // figure is current is unknown -- and unknown is not current.
    const debutantFiling = await prisma.filing.create({
      data: {
        sourceId: staleSource.id,
        corpCode: SINGLE_CORP_CODE,
        corpName: SINGLE_CORP_NAME,
        reportName: "10-K",
        receiptNo: "TEST_ASK_MARKET_DEBUTANT_RCPT",
        receiptDate: daysAgo(20),
        raw: {},
      },
    });
    await prisma.financialFact.create({
      data: {
        sourceId: staleSource.id,
        corpCode: debutantFiling.corpCode,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodEnd: CURRENT_PERIOD_END,
        fiscalYear: 2026,
        fiscalPeriod: "Q1",
        form: "10-Q",
        accessionNumber: "TEST_DEBUTANT_ACCN",
        filedDate: daysAgo(19),
        value: "42000",
        raw: {},
      },
    });

    // Two sources, one name nested inside the other, both publishing the same subject.
    const nestedShort = await prisma.source.create({
      data: { code: NESTED_SHORT_SOURCE, name: "Rework Data", tier: "TIER_S" },
    });
    const nestedLong = await prisma.source.create({
      data: { code: NESTED_LONG_SOURCE, name: NESTED_LONG_SOURCE_NAME, tier: "TIER_S" },
    });
    for (const owner of [nestedShort, nestedLong]) {
      // Both the long subject name and a shorter one that nests inside it, so that requiring
      // MAXIMAL names is separable from requiring occurrence at all.
      for (const [seriesName, suffix, base] of [
        [NESTED_SERIES_NAME, "LONG", 10],
        [NESTED_SHORT_SERIES_NAME, "SHORT", 20],
      ] as const) {
        const nestedSeries = await prisma.series.create({
          data: {
            sourceId: owner.id,
            externalId: `TEST_ASK_MARKET_NESTED_${suffix}_${owner.code}`,
            name: seriesName,
            unit: "index",
            frequency: "daily",
          },
        });
        for (const [date, value] of [
          [daysAgo(2), `${base}.0`],
          [daysAgo(1), `${base + 1}.0`],
        ] as const) {
          await prisma.observation.create({
            data: {
              seriesId: nestedSeries.id,
              sourceId: owner.id,
              observationDate: date,
              value,
              raw: {},
            },
          });
        }
      }
    }

    await prisma.financialFact.create({
      data: {
        sourceId: otherSource.id,
        corpCode: CORP_CODE,
        taxonomy: "ifrs-full",
        concept: "Revenues",
        unit: "KRW",
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        periodEnd: new Date("2026-06-30T00:00:00.000Z"),
        fiscalYear: 2026,
        fiscalPeriod: "Q2",
        form: "OTHER_PROVIDER_FORM",
        accessionNumber: "OTHER_SOURCE_ACCN",
        filedDate: new Date("2026-07-01T00:00:00.000Z"),
        value: "999999999",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    for (const code of [
      SOURCE_CODE,
      OTHER_SOURCE_CODE,
      STALE_SOURCE,
      NESTED_SHORT_SOURCE,
      NESTED_LONG_SOURCE,
    ]) {
      const source = await prisma.source.findUnique({ where: { code } });
      if (source) {
        await prisma.financialFact.deleteMany({ where: { sourceId: source.id } });
        await prisma.filing.deleteMany({ where: { sourceId: source.id } });
        await prisma.observation.deleteMany({ where: { sourceId: source.id } });
        await prisma.series.deleteMany({ where: { sourceId: source.id } });
        await prisma.source.delete({ where: { id: source.id } });
      }
    }
    await prisma.causalEdge.deleteMany({
      where: { fromVariable: { in: ["TEST: Widget demand (ask-market)", "TEST: Widget"] } },
    });
    await prisma.$disconnect();
  });

  it("serves a current level as a level, with no change and no mechanism attached", async () => {
    // This test used to assert the opposite: that a CURRENT_OBSERVATION request came back with
    // `absoluteChange` and at least one causal edge. That was the production-binding defect
    // written down as an expectation -- the operation was authorized and then ignored, so every
    // operation returned the same payload. A level request is answered with a level.
    const result = await askMarket(`What is the current ${SERIES_NAME}?`);
    expect(result.status).toBe("FACTORS_FOUND");
    const own = result.seriesFactors.find((f) => f.seriesName === SERIES_NAME)!;
    expect(own.kind).toBe("OBSERVATION");
    expect(own.value).toBe(102);
    expect(result.causalFactors).toHaveLength(0);
    // EVERY factor, not just the one located. Checking only the found factor let an implementation
    // append an unrelated ChangeFactor and still pass.
    for (const factor of result.seriesFactors) {
      expect(factor.kind).toBe("OBSERVATION");
    }
  });

  it("serves a change as a change, carrying the period it was measured over", async () => {
    const result = await askMarket(`How much has ${SERIES_NAME} changed this year?`);
    expect(result.status).toBe("FACTORS_FOUND");
    const own = result.seriesFactors.find((f) => f.sourceCode === SOURCE_CODE)!;
    expect(own.kind).toBe("COMPUTED_CHANGE");
    if (own.kind === "COMPUTED_CHANGE") {
      // 12, not 2. The period chooses the observations: 1 January's 90 against the latest 102.
      // The latest-pair delta is 2, and a mutation restoring it must fail here.
      expect(own.absoluteChange).toBe(12);
      expect(own.interval).toBe("this year");
      // The dates are disclosed, because a period NAME and the dates it resolved to are two
      // different claims and only one of them the reader can check.
      expect(own.startDate).toBe(YEAR_START.toISOString().slice(0, 10));
      expect(own.endDate).toBe(daysAgo(1).toISOString().slice(0, 10));
      expect(own.asOfDate).toBe(own.endDate);
    }
    for (const factor of result.seriesFactors) {
      expect(factor.kind).toBe("COMPUTED_CHANGE");
    }
    expect(result.causalFactors).toHaveLength(0);
    expect(result.companyFacts).toHaveLength(0);
  });

  it("serves a mechanism as an edge, with no numbers attached", async () => {
    const result = await askMarket(
      `Explain how TEST: Widget demand (ask-market) affects ${SERIES_NAME}.`,
    );
    expect(result.causalFactors.length).toBeGreaterThanOrEqual(1);
    expect(result.seriesFactors).toHaveLength(0);
    expect(result.companyFacts).toHaveLength(0);
  });

  it("serves the edge whose cause was named, not one whose cause nests inside it", async () => {
    // "TEST: Widget" is stored and occurs inside "TEST: Widget demand (ask-market)". It was never
    // separately named -- it was read out of the longer name -- so its edge is not an answer here.
    const result = await askMarket(
      `Explain how TEST: Widget demand (ask-market) affects ${SERIES_NAME}.`,
    );
    expect(result.causalFactors.map((c) => c.fromVariable)).toEqual([
      "TEST: Widget demand (ask-market)",
    ]);
  });

  it("serves the edge that was asked about, not one that shares an endpoint with it", async () => {
    // Two stored edges leave the same cause. Only one of them is the relation this request names,
    // and an authentic edge with something else at the far end answers a question nobody asked.
    //
    // Asserted as an exclusion rather than an equality, and the reason is a finding rather than a
    // convenience: writing `toEqual([SERIES_NAME])` failed, because a stored variable named
    // "TEST: Widget price" also matched -- its name NESTS inside "TEST Widget Price Index", and
    // `nameOccursIn` is containment. That is a real cross-subject leak on the serving path, of
    // exactly the shape IR-105 settled for the inference path, and it is recorded as open rather
    // than absorbed here. This assertion proves the endpoint rule without depending on it.
    const result = await askMarket(
      `Explain how TEST: Widget demand (ask-market) affects ${SERIES_NAME}.`,
    );
    const targets = result.causalFactors.map((c) => c.toVariable);
    expect(targets).toContain(SERIES_NAME);
    expect(targets).not.toContain("TEST: Widget warehouse rent (ask-market)");
  });

  it("serves an attributed request from the source it named, and no other", async () => {
    // RA-PB-02. Two providers publish this subject with different values -- ordinary, since Series
    // is unique on (sourceId, externalId) and never on name. The grammar bound WHICH source was
    // named and then recorded only THAT one was, so an attributed request was answered with both
    // providers' figures. Naming one source and being shown another's number is a false
    // attribution, not a near miss.
    const result = await askMarket(`What did Test Ask Market Source publish about ${SERIES_NAME}?`);
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.seriesFactors.length).toBeGreaterThanOrEqual(1);
    for (const factor of result.seriesFactors) {
      expect(factor.sourceCode, "another provider's figure answered an attributed request").toBe(
        SOURCE_CODE,
      );
    }
  });

  it("refuses an attributed request naming a source this repository does not hold", async () => {
    // Syntax proves a source was named. Only the repository can prove which one, and an
    // unresolvable name is not a licence to answer from whoever else happens to publish.
    const result = await askMarket(
      `What did the Bureau of Nonexistent Statistics publish about ${SERIES_NAME}?`,
    );
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("does not serve a stale row as a current observation", async () => {
    // "The newest row we hold" and "the current value" are different claims. This series was last
    // observed long past three times its own cadence, and answering with its figure would present
    // a 2024 number as today's. The cadence rule is the repository's existing one, already used by
    // claim verification.
    const result = await askMarket(`What is the current ${STALE_SERIES_NAME}?`);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("does not let a fresh series make a stale one publishable", async () => {
    // Freshness is decided per factor, never in aggregate. Both series match this topic; only one
    // of them is current, and "some of these are fresh" is not a property anyone asked about.
    const result = await askMarket(`What is the current ${SHARED_TOPIC}?`);
    for (const factor of result.seriesFactors) {
      expect(factor.seriesName, "a stale series was carried by a fresh one").not.toBe(
        STALE_SERIES_NAME,
      );
    }
  });

  it("resolves the source that was named, not the shorter one nested inside it", async () => {
    // With both "Rework Data" and "Rework Data Research" stored, naming the longer one makes BOTH
    // whole names occur. Refusing that as ambiguous refuses a request that named exactly one
    // source -- the shorter hit was never separately named, it was read out of the longer one.
    const result = await askMarket(
      `What did ${NESTED_LONG_SOURCE_NAME} publish about ${NESTED_SERIES_NAME}?`,
    );
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.seriesFactors.map((f) => f.sourceCode)).toEqual([NESTED_LONG_SOURCE]);
  });

  it("does not serve a series whose cadence cannot be projected", async () => {
    // One observation is a point, not a series. Nothing says whether it is still current, and
    // unknown is not fresh -- the rule claim verification already applies to evidence.
    const result = await askMarket(`What is the current ${NO_CADENCE_SERIES_NAME}?`);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("serves the subject that was named, not the shorter one nested inside it", async () => {
    // Both names occur in this request, because one is a prefix of the other. The shorter was
    // never separately named; it was read out of the longer. IR-105 settled this for subjects and
    // the serving path is where it has to hold.
    const result = await askMarket(`What is the current ${NESTED_SERIES_NAME}?`);
    expect(result.status).toBe("FACTORS_FOUND");
    for (const factor of result.seriesFactors) {
      expect(factor.seriesName).toBe(NESTED_SERIES_NAME);
    }
  });

  it("serves a company reading as an observation, and nothing else with it", async () => {
    // OBSERVATION spans two tables on purpose: a series reading and a company filing fact are the
    // same KIND of record -- one subject, one source, one date. What must not come with it is a
    // change, a mechanism or a definition, and the test says so rather than leaving it implied.
    const result = await askMarket(`What is the current ${CORP_NAME}?`);
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.companyFacts.length).toBeGreaterThanOrEqual(1);
    expect(result.causalFactors).toHaveLength(0);
    for (const factor of result.seriesFactors) {
      expect(factor.kind).toBe("OBSERVATION");
    }
  });

  it("refuses when the request names two stored subjects and the operation answers about one", async () => {
    // The parser cannot catch this -- it never reads inventory, so one subject region naming two
    // stored subjects looks like one subject to it. Serving both answers two questions; serving
    // one chooses. Before this, the shorter name was silently dropped for being nestable and the
    // longer was answered alone.
    const result = await askMarket(
      `What is the current ${NESTED_SHORT_SERIES_NAME}, ${NESTED_SERIES_NAME}?`,
    );
    expect(result.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("refuses when the request names two providers, rather than picking the longer name", async () => {
    // Same mistake in the source slot, where getting it wrong is a false attribution: the shorter
    // provider was deleted for being contained in the longer one's name, and the longer one
    // answered alone.
    const result = await askMarket(
      `What did Rework Data, ${NESTED_LONG_SOURCE_NAME} publish about ${NESTED_SERIES_NAME}?`,
    );
    expect(result.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("serves only the current reporting period for a company", async () => {
    // The prior quarter is in the fixture and must not ride along. One filing carrying a current
    // period and an old one served both, and an older period is a different question.
    const result = await askMarket(`What is the current ${CORP_NAME}?`);
    expect(result.companyFacts.length).toBeGreaterThanOrEqual(1);
    for (const fact of result.companyFacts) {
      expect(fact.periodEnd).toBe(CURRENT_PERIOD_END.toISOString().slice(0, 10));
    }
  });

  it("does not serve a dormant company's last filing as a current figure", async () => {
    // Two reported periods a quarter apart, both years old. The cadence is derivable and the
    // newest period is long past it, so "the newest filing we hold" is not "the current figure" --
    // the same distinction series observations already make.
    const result = await askMarket(`What is the current ${STALE_CORP_NAME}?`);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.companyFacts).toHaveLength(0);
  });

  it("does not serve a company that has reported only once as current", async () => {
    // Its single period is recent, so nothing about the DATE refuses this. What refuses it is that
    // one point projects no cadence, and without a cadence "still current" is not a claim this
    // repository can make. Same rule as a series with one observation.
    const result = await askMarket(`What is the current ${SINGLE_CORP_NAME}?`);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.companyFacts).toHaveLength(0);
  });

  it("never ends a running period on a reading dated after the clock", async () => {
    // A reading 30 days ahead of now is in the series. "This year" is still running, so it ends at
    // the clock; taking the newest row instead would answer today's question with next month's
    // number.
    const result = await askMarket(`How much has ${SERIES_NAME} changed this year?`);
    const own = result.seriesFactors.find((f) => f.sourceCode === SOURCE_CODE)!;
    expect(own.kind).toBe("COMPUTED_CHANGE");
    if (own.kind === "COMPUTED_CHANGE") {
      expect(own.endDate).toBe(daysAgo(1).toISOString().slice(0, 10));
      expect(own.value).toBe(102);
    }
  });

  it("refuses a running period on a series that stopped reporting", async () => {
    // The opening boundary is there and the arithmetic would work. What refuses it is that a
    // running period ends at "the latest reading", and that is only a stand-in for the present
    // while the series is current -- the same rule the level path applies, which this path did not
    // run at all before.
    const result = await askMarket(`How much has ${ABANDONED_SERIES_NAME} changed this year?`);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("measures a running period's freshness against the reading it actually served", async () => {
    // The clock is injected, so this is a statement about periods rather than about today. On 1
    // February the series' newest usable reading is 4 January -- four weeks stale on a daily
    // cadence -- and the December row must not rescue it. Reported fresh, the answer would be a
    // month-old change presented as year-to-date.
    const stale = await askMarket(`How much has ${FUTURE_CADENCE_SERIES_NAME} changed this year?`, {
      now: new Date("2026-02-01T12:00:00.000Z"),
    });
    expect(stale.status).toBe("NOT_FOUND");

    // The control: the same series, the same future row, a clock where 4 January IS current.
    const fresh = await askMarket(`How much has ${FUTURE_CADENCE_SERIES_NAME} changed this year?`, {
      now: new Date("2026-01-05T12:00:00.000Z"),
    });
    expect(fresh.status).toBe("FACTORS_FOUND");
    const own = fresh.seriesFactors[0];
    expect(own.kind).toBe("COMPUTED_CHANGE");
    if (own.kind === "COMPUTED_CHANGE") {
      expect(own.startDate).toBe("2026-01-01");
      // Not 2026-12-31, and not 9999.
      expect(own.endDate).toBe("2026-01-04");
      expect(own.absoluteChange).toBe(3);
    }
  });

  it("refuses a definition rather than answering it with a number", async () => {
    // The repository holds no glossary record class, and the term names a stored series. It was
    // answered with that series' value -- a figure in place of a meaning. Failing closed is the
    // honest answer, and building a glossary to preserve the old success status would be
    // answering a different question.
    const result = await askMarket("What is a Widget Price Index?");
    expect(result.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("attributes every figure to the source it came from", async () => {
    // CLAUDE.md: every FACT shown to a user must trace to a stored source. Two providers match
    // this topic and the answer lists both, so without an attribution the reader sees 102 and
    // 530 for what reads as the same indicator and has no way to tell which is which — or that
    // two different organisations are being quoted at all.
    const result = await askMarket(`What is the current ${SERIES_NAME}?`);

    expect(result.seriesFactors.length).toBeGreaterThanOrEqual(2);
    for (const factor of result.seriesFactors) {
      expect(factor.sourceCode, `no source on "${factor.seriesName}"`).toBeTruthy();
    }
    const bySource = new Map(result.seriesFactors.map((f) => [f.sourceCode, f.value]));
    expect(bySource.get(SOURCE_CODE)).toBe(102);
    expect(bySource.get(OTHER_SOURCE_CODE)).toBe(530);

    // Company facts carry the same obligation.
    const company = await askMarket("What is the current TEST Widget Corp?");
    expect(company.companyFacts.length).toBeGreaterThan(0);
    for (const fact of company.companyFacts) {
      expect(fact.sourceCode, `no source on ${fact.concept}`).toBe(SOURCE_CODE);
    }
  });

  it("returns company facts for a matched company name", async () => {
    const result = await askMarket("What is the current TEST Widget Corp?");
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.matchedTopic).toBe(CORP_NAME);
    expect(result.companyFacts).toHaveLength(2);
    expect(result.companyFacts.every((f) => f.concept === "Revenues")).toBe(true);
  });

  it("does not blend facts from another provider that reuses the same corpCode", async () => {
    // The company was matched via a FILING, and a filing belongs to exactly one source. The
    // facts shown alongside it must come from that same source, or the answer silently mixes
    // providers while presenting a single sourced-looking figure — a provenance failure, and
    // the kind that reads as perfectly plausible (`docs/DATA_POLICY.md`).
    const result = await askMarket("What is the current TEST Widget Corp?");

    expect(result.companyFacts.map((f) => f.value)).not.toContain(999999999);
    expect(result.companyFacts.every((f) => f.unit === "USD")).toBe(true);
    expect(result.companyFacts).toHaveLength(2);
  });

  it("carries the covered period, so two figures sharing a fiscal label stay distinguishable", async () => {
    // Both fixtures are "Q1 2026 Revenues" with different values — one covering the quarter,
    // one with no start at all. Rendered on `/ask` with only the fiscal label, a reader sees
    // two contradictory revenue numbers and no way to tell which is which. Against real Apple
    // data this is not hypothetical: OperatingIncomeLoss for Q3 2026 is $122.4B over nine
    // months and $35.7B over one quarter, both under the same label.
    const result = await askMarket("What is the current TEST Widget Corp?");

    const quarterly = result.companyFacts.find((f) => f.value === 250000)!;
    // Against the fixture's own constants, not literals: the periods are relative now, because a
    // company with one fixed reported period has no cadence and cannot be current.
    expect(quarterly.periodStart).toBe(daysAgo(120).toISOString().slice(0, 10));
    expect(quarterly.periodEnd).toBe(CURRENT_PERIOD_END.toISOString().slice(0, 10));

    // Instant concepts genuinely have no start; null must survive rather than being invented.
    const noStart = result.companyFacts.find((f) => f.value === 1000000)!;
    expect(noStart.periodStart).toBeNull();
    expect(noStart.periodEnd).toBe(CURRENT_PERIOD_END.toISOString().slice(0, 10));

    // The fiscal label alone cannot separate them, which is the whole point.
    expect(quarterly.fiscalPeriod).toBe(noStart.fiscalPeriod);
    expect(quarterly.fiscalYear).toBe(noStart.fiscalYear);
  });

  /**
   * AMENDED 2026-08-26. This asserted the redirect "still shows factors" for a BARE buy request.
   * That behaviour is gone deliberately: those factors came from a wide search over the raw string,
   * and the same width let a refusal publish what the repository refuses when asked plainly --
   * `Should I buy X? What is the definition of X?` returned X's figures while the neutral form
   * returns none. A redirect is now answered through the operation the request named, and a bare
   * directive named none.
   *
   * The half that still matters -- a real match EXISTS, so an empty redirect is a decision rather
   * than an empty repository -- is kept by asserting both forms here.
   */
  it("redirects a personalized buy request, showing factors only if it asked for some", async () => {
    const bare = await askMarket("Should I buy TEST Widget Corp now?");
    expect(bare.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(bare.redirectMessage).toBeTruthy();
    expect(bare.companyFacts).toHaveLength(0);

    // Same company, same directive, plus a clause that names an operation. This control is what
    // stops the assertion above from being satisfied by an absent fixture.
    const withOperation = await askMarket(
      "Should I buy TEST Widget Corp now? What is the current TEST Widget Corp?",
    );
    expect(withOperation.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(withOperation.companyFacts.length).toBeGreaterThanOrEqual(1);
  });

  it("returns NOT_FOUND for a topic with no matching data, never fabricating a match", async () => {
    const result = await askMarket("What is the current Totally Unknown Nonexistent Topic XYZ123?");
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
    expect(result.companyFacts).toHaveLength(0);
  });

  /**
   * IR-107. The two tests below exist because mutations survived: `askMarket` could ignore request
   * authority entirely, or ignore its PROHIBITED verdict, and every other test still passed. Both
   * need a seeded database to mean anything -- a query refused by an empty repository proves
   * nothing about a gate, which is why they live here and not beside the unit tests.
   */

  it("refuses a bare subject as unsupported even though the record exists and would match", async () => {
    // The strongest available form of "inventory does not decide what a sentence meant": this exact
    // subject answers FACTORS_FOUND one line above when the request names an operation. Naming no
    // operation is refused with data present, and REQUEST_NOT_SUPPORTED is a status an empty
    // database cannot produce.
    const result = await askMarket("Widget Price Index");
    expect(result.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(result.seriesFactors).toHaveLength(0);
  });

  /**
   * IR-107 Unit 2 Phase B, adversarial round four. A Korean subject region is ONE morpheme, and the
   * repository must not find a smaller stored subject inside it.
   *
   * These need a seeded database to mean anything: the whole finding is that the answer depended on
   * what happened to be stored, so a unit test asserting the parser's verdict cannot reach it. The
   * unit test that tried was vacuous and was replaced by these.
   */
  it("does not answer a hyphenated pair with one of its legs", async () => {
    // `USD-KRW는` parses to the single stem `USD-KRW`. Normalization turns the hyphen into a space,
    // so `KRW` — which IS stored — occurred as a whole token and the question about the currency
    // PAIR came back answered with one leg of it: a real value, a real series, the wrong subject.
    for (const query of ["USD-KRW는 얼마인가요?", "USD/KRW는 얼마인가요?"]) {
      const result = await askMarket(query);
      expect(result.status, query).toBe("NOT_FOUND");
      expect(result.seriesFactors, query).toHaveLength(0);
    }
  });

  it("still answers when the Korean subject IS the stored name", async () => {
    // The control that stops the test above being vacuous. Without it, "always NOT_FOUND" would be
    // equally consistent with the Korean serving path being dead.
    const result = await askMarket("KRW는 얼마인가요?");
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.seriesFactors.map((f) => f.seriesName)).toEqual(["KRW"]);
  });

  /**
   * Deterministic mechanism serving applies the SAME qualifier rule as inference candidate
   * authority, or one path publishes a relation the other refuses.
   *
   * Reproduced against this database before the repair: with the edge stored,
   * `Explain how it is false that <cause> affects <effect>.` and
   * `... affects <effect> only if something else.` BOTH returned FACTORS_FOUND with the stored
   * edge — the first answering the OPPOSITE of what was asked, the second answering an
   * unconditional question nobody asked — while the inference candidate path refused both. Two
   * answer-bearing paths, one request, opposite verdicts, and this is the one a user reaches.
   */
  const MECH_CAUSE = "TEST: Widget demand (ask-market)";

  it("serves the affirmative mechanism, which is what makes the refusals below mean something", async () => {
    const result = await askMarket(`Explain how ${MECH_CAUSE} affects ${SERIES_NAME}.`);
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`)).toContain(
      `${MECH_CAUSE} -> ${SERIES_NAME}`,
    );
  });

  it("does not serve a stored edge in answer to a denial of that relation", async () => {
    const result = await askMarket(
      `Explain how it is false that ${MECH_CAUSE} affects ${SERIES_NAME}.`,
    );
    expect(result.causalFactors).toHaveLength(0);
  });

  it("does not serve an unconditional edge in answer to a conditional question", async () => {
    for (const suffix of ["only if something else", "unless rates fall"]) {
      const result = await askMarket(`Explain how ${MECH_CAUSE} affects ${SERIES_NAME} ${suffix}.`);
      expect(result.causalFactors, suffix).toHaveLength(0);
    }
  });

  it.fails(
    "PENDING: punctuation-only difference between stored names is not identity",
    async () => {
      // Found by round-five review, NOT introduced by the subject-identity change: `normalizeSubject`
      // erases punctuation, so a stored series named `KRW` and a request naming `KRW` are the same
      // string as a stored `KRW.` or `KRW-`. The reproduction script shows the sharper English form —
      // stored `C++` answers a request about `C` — and it behaves identically on the OCCURRENCE path,
      // which is what proves this is older than the WHOLE_REGION rule rather than caused by it.
      //
      // Repairing it means changing `normalizeSubject`, which every subject-identity caller shares,
      // so it is not folded into a Korean recognition unit. Recorded as a PENDING invariant so it is
      // executable and visible rather than a sentence in a document: it throws today, and it starts
      // failing the day a lossless canonical key replaces display-name normalization.
      const collision = await askMarket("KRW.는 얼마인가요?");
      expect(collision.status).toBe("NOT_FOUND");
    },
  );

  it("does not answer a fused coordination about one of its halves", async () => {
    // The parser cannot see a conjunction compressed inside one eojeol, so `KRW와USD는` authorizes
    // with cardinality one unproven. What must never follow is an answer about one half. Fused
    // Hangul has no token boundary for occurrence matching to exploit; whole-region identity is
    // what makes that true rather than lucky.
    const result = await askMarket("KRW와USD는 얼마인가요?");
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
  });

  it("redirects a request whose subject is the reader, which the advice vocabulary does not match", async () => {
    // "my pension fund" carries no advice phrase -- `detectPersonalizedAdviceRequest` returns false
    // for it. What makes this personalized is structural: the subject of the question is the person
    // asking. Without authority's verdict reaching the redirect, this is answered as a lookup.
    const result = await askMarket("What is the current level of my pension fund?");
    expect(result.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(result.redirectMessage).toBeTruthy();
  });
});
