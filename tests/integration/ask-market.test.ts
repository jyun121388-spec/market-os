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
      where: { fromVariable: "TEST: Widget demand (ask-market)" },
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
        periodEnd: new Date("2026-03-31T00:00:00.000Z"),
        fiscalYear: 2026,
        fiscalPeriod: "Q1",
        form: "10-Q",
        accessionNumber: "TEST_ACCN",
        filedDate: new Date("2026-05-01T00:00:00.000Z"),
        value: "1000000",
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
        periodStart: new Date("2026-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-03-31T00:00:00.000Z"),
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
      where: { fromVariable: "TEST: Widget demand (ask-market)" },
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
  });

  it("serves a change as a change, carrying the period it was measured over", async () => {
    const result = await askMarket(`How much has ${SERIES_NAME} changed this year?`);
    expect(result.status).toBe("FACTORS_FOUND");
    const own = result.seriesFactors.find((f) => f.seriesName === SERIES_NAME)!;
    expect(own.kind).toBe("COMPUTED_CHANGE");
    if (own.kind === "COMPUTED_CHANGE") {
      expect(own.absoluteChange).toBe(2);
      expect(own.interval).toBe("this year");
    }
  });

  it("serves a mechanism as an edge, with no numbers attached", async () => {
    const result = await askMarket(
      `Explain how TEST: Widget demand (ask-market) affects ${SERIES_NAME}.`,
    );
    expect(result.causalFactors.length).toBeGreaterThanOrEqual(1);
    expect(result.seriesFactors).toHaveLength(0);
    expect(result.companyFacts).toHaveLength(0);
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
    expect(quarterly.periodStart).toBe("2026-01-01");
    expect(quarterly.periodEnd).toBe("2026-03-31");

    // Instant concepts genuinely have no start; null must survive rather than being invented.
    const noStart = result.companyFacts.find((f) => f.value === 1000000)!;
    expect(noStart.periodStart).toBeNull();
    expect(noStart.periodEnd).toBe("2026-03-31");

    // The fiscal label alone cannot separate them, which is the whole point.
    expect(quarterly.fiscalPeriod).toBe(noStart.fiscalPeriod);
    expect(quarterly.fiscalYear).toBe(noStart.fiscalYear);
  });

  it("redirects a personalized buy request even when a real match exists, but still shows factors", async () => {
    const result = await askMarket("Should I buy TEST Widget Corp now?");
    expect(result.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(result.redirectMessage).toBeTruthy();
    expect(result.companyFacts.length).toBeGreaterThanOrEqual(1);
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

  it("redirects a request whose subject is the reader, which the advice vocabulary does not match", async () => {
    // "my pension fund" carries no advice phrase -- `detectPersonalizedAdviceRequest` returns false
    // for it. What makes this personalized is structural: the subject of the question is the person
    // asking. Without authority's verdict reaching the redirect, this is answered as a lookup.
    const result = await askMarket("What is the current level of my pension fund?");
    expect(result.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(result.redirectMessage).toBeTruthy();
  });
});
