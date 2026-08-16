import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_ASK_MARKET_SOURCE";
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

    const existingSource = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existingSource) {
      await prisma.financialFact.deleteMany({ where: { sourceId: existingSource.id } });
      await prisma.filing.deleteMany({ where: { sourceId: existingSource.id } });
      await prisma.observation.deleteMany({ where: { sourceId: existingSource.id } });
      await prisma.series.deleteMany({ where: { sourceId: existingSource.id } });
      await prisma.source.delete({ where: { id: existingSource.id } });
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
  });

  afterAll(async () => {
    const source = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (source) {
      await prisma.financialFact.deleteMany({ where: { sourceId: source.id } });
      await prisma.filing.deleteMany({ where: { sourceId: source.id } });
      await prisma.observation.deleteMany({ where: { sourceId: source.id } });
      await prisma.series.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.delete({ where: { id: source.id } });
    }
    await prisma.causalEdge.deleteMany({
      where: { fromVariable: "TEST: Widget demand (ask-market)" },
    });
    await prisma.$disconnect();
  });

  it("returns factors for a matched macro series and causal edges", async () => {
    const result = await askMarket("Widget Price Index");
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.seriesFactors).toHaveLength(1);
    expect(result.seriesFactors[0].seriesName).toBe(SERIES_NAME);
    expect(result.seriesFactors[0].absoluteChange).toBe(2);
    expect(result.causalFactors.length).toBeGreaterThanOrEqual(1);
  });

  it("returns company facts for a matched company name", async () => {
    const result = await askMarket("TEST Widget Corp");
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.matchedTopic).toBe(CORP_NAME);
    expect(result.companyFacts).toHaveLength(1);
    expect(result.companyFacts[0].concept).toBe("Revenues");
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
