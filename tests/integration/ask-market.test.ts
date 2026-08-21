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

describeIfDb("askMarket (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let askMarket: typeof import("@/server/domain/askMarket").askMarket;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ askMarket } = await import("@/server/domain/askMarket"));

    for (const code of [SOURCE_CODE, OTHER_SOURCE_CODE]) {
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
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "100.0",
        raw: {},
      },
    });
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: new Date("2026-08-15T00:00:00.000Z"),
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
        name: `${SERIES_NAME} (other provider)`,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [date, value] of [
      ["2026-08-14T00:00:00.000Z", "500.0"],
      ["2026-08-15T00:00:00.000Z", "530.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: otherSeries.id,
          sourceId: otherSource.id,
          observationDate: new Date(date),
          value,
          raw: {},
        },
      });
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
    for (const code of [SOURCE_CODE, OTHER_SOURCE_CODE]) {
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

  it("returns factors for a matched macro series and causal edges", async () => {
    const result = await askMarket("Widget Price Index");
    expect(result.status).toBe("FACTORS_FOUND");
    const own = result.seriesFactors.find((f) => f.seriesName === SERIES_NAME)!;
    expect(own.absoluteChange).toBe(2);
    expect(result.causalFactors.length).toBeGreaterThanOrEqual(1);
  });

  it("attributes every figure to the source it came from", async () => {
    // CLAUDE.md: every FACT shown to a user must trace to a stored source. Two providers match
    // this topic and the answer lists both, so without an attribution the reader sees 102 and
    // 530 for what reads as the same indicator and has no way to tell which is which — or that
    // two different organisations are being quoted at all.
    const result = await askMarket("Widget Price Index");

    expect(result.seriesFactors.length).toBeGreaterThanOrEqual(2);
    for (const factor of result.seriesFactors) {
      expect(factor.sourceCode, `no source on "${factor.seriesName}"`).toBeTruthy();
    }
    const bySource = new Map(result.seriesFactors.map((f) => [f.sourceCode, f.value]));
    expect(bySource.get(SOURCE_CODE)).toBe(102);
    expect(bySource.get(OTHER_SOURCE_CODE)).toBe(530);

    // Company facts carry the same obligation.
    const company = await askMarket("TEST Widget Corp");
    expect(company.companyFacts.length).toBeGreaterThan(0);
    for (const fact of company.companyFacts) {
      expect(fact.sourceCode, `no source on ${fact.concept}`).toBe(SOURCE_CODE);
    }
  });

  it("returns company facts for a matched company name", async () => {
    const result = await askMarket("TEST Widget Corp");
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
    const result = await askMarket("TEST Widget Corp");

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
    const result = await askMarket("TEST Widget Corp");

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
    const result = await askMarket("Totally Unknown Nonexistent Topic XYZ123");
    expect(result.status).toBe("NOT_FOUND");
    expect(result.seriesFactors).toHaveLength(0);
    expect(result.companyFacts).toHaveLength(0);
  });
});
