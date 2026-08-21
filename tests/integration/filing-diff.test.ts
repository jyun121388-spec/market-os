import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_FILING_DIFF_SOURCE";
const CORP_CODE = "TESTCIK";

describeIfDb("computeFinancialFactDiff (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeFinancialFactDiff: typeof import("@/server/domain/filingDiff").computeFinancialFactDiff;
  let computeFilingDiff: typeof import("@/server/domain/filingDiff").computeFilingDiff;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeFinancialFactDiff, computeFilingDiff } = await import("@/server/domain/filingDiff"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Filing Diff Source", tier: "TIER_S" },
    });
    sourceId = source.id;

    await prisma.financialFact.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodStart: new Date("2024-07-01T00:00:00.000Z"),
        periodEnd: new Date("2025-06-30T00:00:00.000Z"),
        fiscalYear: 2025,
        fiscalPeriod: "FY",
        form: "10-K",
        accessionNumber: "0000000000-25-000001",
        filedDate: new Date("2025-08-01T00:00:00.000Z"),
        value: "300000000000",
        raw: {},
      },
    });
    await prisma.financialFact.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        periodStart: new Date("2025-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-06-30T00:00:00.000Z"),
        fiscalYear: 2026,
        fiscalPeriod: "FY",
        form: "10-K",
        accessionNumber: "0000000000-26-000001",
        filedDate: new Date("2026-08-01T00:00:00.000Z"),
        value: "330000000000",
        raw: {},
      },
    });

    // Only a single period for NetIncomeLoss — exercises INSUFFICIENT_DATA.
    await prisma.financialFact.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: "NetIncomeLoss",
        unit: "USD",
        periodEnd: new Date("2026-06-30T00:00:00.000Z"),
        fiscalYear: 2026,
        fiscalPeriod: "FY",
        form: "10-K",
        accessionNumber: "0000000000-26-000001",
        filedDate: new Date("2026-08-01T00:00:00.000Z"),
        value: "80000000000",
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes the deterministic change between the two most recent filings' values", async () => {
    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, "Revenues", "USD");
    expect(diff.status).toBe("COMPUTED");
    expect(diff.currentAccession).toBe("0000000000-26-000001");
    expect(diff.previousAccession).toBe("0000000000-25-000001");
    expect(diff.absoluteChange).toBe(30000000000);
    expect(diff.percentChange).toBe(10);
  });

  it("returns INSUFFICIENT_DATA when only one filing has reported the concept", async () => {
    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, "NetIncomeLoss", "USD");
    expect(diff.status).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA for a concept never reported at all, never fabricating a diff", async () => {
    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, "Liabilities", "USD");
    expect(diff.status).toBe("INSUFFICIENT_DATA");
  });

  it("never compares a year-to-date figure against a quarter from the same filing", async () => {
    // The exact shape that produced a fabricated +232.9985% revenue "increase" against real
    // Apple data. One 10-Q reports revenue twice: nine months ending 2026-06-27 ($364.357B) and
    // three months ending the SAME date ($109.417B), under the same accession number. Taking
    // "the two most recent rows" picked exactly those two and subtracted them.
    const concept = "PeriodMismatchTest";
    const accn = "0000000000-26-000020";
    const periodEnd = new Date("2026-06-27T00:00:00.000Z");

    await prisma.financialFact.createMany({
      data: [
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodStart: new Date("2025-09-28T00:00:00.000Z"), // nine months
          periodEnd,
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          accessionNumber: accn,
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "364357000000",
          raw: {},
        },
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodStart: new Date("2026-03-29T00:00:00.000Z"), // three months, same end
          periodEnd,
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          accessionNumber: accn,
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "109417000000",
          raw: {},
        },
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodStart: new Date("2025-12-29T00:00:00.000Z"), // the PREVIOUS quarter
          periodEnd: new Date("2026-03-28T00:00:00.000Z"),
          fiscalYear: 2026,
          fiscalPeriod: "Q2",
          form: "10-Q",
          accessionNumber: "0000000000-26-000013",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "111184000000",
          raw: {},
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");

    expect(diff.status).toBe("COMPUTED");
    // Quarter against the previous quarter, not against the year-to-date figure beside it.
    expect(diff.currentValue).toBe(109417000000);
    expect(diff.previousValue).toBe(111184000000);
    expect(diff.percentChange).toBe(-1.5893);
    expect(diff.periodMonths).toBe(3);
    // Different period ends, and therefore genuinely a period-over-period comparison.
    expect(diff.currentPeriodEnd).toBe("2026-06-27");
    expect(diff.previousPeriodEnd).toBe("2026-03-28");
    expect(diff.currentAccession).not.toBe(diff.previousAccession);

    await prisma.financialFact.deleteMany({ where: { sourceId, concept } });
  });

  it("reports INSUFFICIENT_DATA rather than comparing across period lengths", async () => {
    // Only one figure of each length exists, so there is no valid comparison. Saying so is the
    // point — the alternative is a confident number built from incomparable inputs.
    const concept = "OnlyMismatchedLengths";
    await prisma.financialFact.createMany({
      data: [
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodStart: new Date("2025-09-28T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          accessionNumber: "0000000000-26-000020",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "364357000000",
          raw: {},
        },
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          accessionNumber: "0000000000-26-000020",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "109417000000",
          raw: {},
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");
    expect(diff.status).toBe("INSUFFICIENT_DATA");
    expect(diff.percentChange).toBeUndefined();

    await prisma.financialFact.deleteMany({ where: { sourceId, concept } });
  });

  it("compares instant concepts, which have no period length, across two dates", async () => {
    const concept = "InstantConceptTest";
    await prisma.financialFact.createMany({
      data: [
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          accessionNumber: "0000000000-26-000020",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "383266000000",
          raw: {},
        },
        {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept,
          unit: "USD",
          periodEnd: new Date("2026-03-28T00:00:00.000Z"),
          fiscalYear: 2026,
          fiscalPeriod: "Q2",
          form: "10-Q",
          accessionNumber: "0000000000-26-000013",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "371082000000",
          raw: {},
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");
    expect(diff.status).toBe("COMPUTED");
    expect(diff.periodMonths).toBeNull();
    expect(diff.percentChange).toBe(3.2834);

    await prisma.financialFact.deleteMany({ where: { sourceId, concept } });
  });

  it("computeFilingDiff batches multiple concepts in one call", async () => {
    const diffs = await computeFilingDiff(sourceId, CORP_CODE, [
      { concept: "Revenues", unit: "USD" },
      { concept: "NetIncomeLoss", unit: "USD" },
    ]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].status).toBe("COMPUTED");
    expect(diffs[1].status).toBe("INSUFFICIENT_DATA");
  });

  it("discloses a 14-week quarter compared against a 13-week one", async () => {
    // Not hypothetical. Apple's fiscal Q1 is periodically 14 weeks rather than 13, and the real
    // data in this repo holds 492 quarters of 90 days alongside 28 of 97 — plus 147 years of 363
    // days against 33 of 370. `Math.round(days / 30.436875)` buckets 90 and 97 both to 3, so two
    // periods differing by a full week are compared and labelled `periodMonths: 3`.
    //
    // Real example, Apple NetIncomeLoss: the 90-day quarter ending 2022-06-25 against the 97-day
    // quarter ending 2022-12-31 reports +54.2948%. Roughly 7.8% of that is simply the extra week.
    // Refusing the comparison would be wrong — companies report these quarters as consecutive and
    // so should we — but presenting it as like-for-like without saying so is the same fabrication
    // the nine-month-vs-quarter defect produced, in a quieter register.
    const concept = "WeekCountRevenue";
    const common = {
      sourceId,
      corpCode: CORP_CODE,
      taxonomy: "us-gaap",
      concept,
      unit: "USD",
      form: "10-Q",
      raw: {},
    };
    await prisma.financialFact.createMany({
      data: [
        {
          ...common,
          periodStart: new Date("2022-03-27T00:00:00.000Z"),
          periodEnd: new Date("2022-06-25T00:00:00.000Z"), // 90 days — 13 weeks
          accessionNumber: "WK-13",
          filedDate: new Date("2022-07-28T00:00:00.000Z"),
          value: "19442000000",
        },
        {
          ...common,
          periodStart: new Date("2022-09-25T00:00:00.000Z"),
          periodEnd: new Date("2022-12-31T00:00:00.000Z"), // 97 days — 14 weeks
          accessionNumber: "WK-14",
          filedDate: new Date("2023-02-02T00:00:00.000Z"),
          value: "29998000000",
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");

    // The comparison still happens — these genuinely are consecutive reported quarters.
    expect(diff.status).toBe("COMPUTED");
    expect(diff.periodMonths).toBe(3);

    // But the actual spans are carried, and the inequality is flagged rather than implied away.
    expect(diff.currentPeriodDays).toBe(97);
    expect(diff.previousPeriodDays).toBe(90);
    expect(diff.periodLengthMismatch).toBe(true);
  });

  it("does not flag a mismatch when the two periods really are the same length", async () => {
    // The negative control. A flag that is always set discloses nothing.
    const concept = "EvenQuarterRevenue";
    const common = {
      sourceId,
      corpCode: CORP_CODE,
      taxonomy: "us-gaap",
      concept,
      unit: "USD",
      form: "10-Q",
      raw: {},
    };
    await prisma.financialFact.createMany({
      data: [
        {
          ...common,
          periodStart: new Date("2025-12-29T00:00:00.000Z"),
          periodEnd: new Date("2026-03-28T00:00:00.000Z"), // 89 days
          accessionNumber: "EVEN-1",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "111184000000",
        },
        {
          ...common,
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-25T00:00:00.000Z"), // 88 days
          accessionNumber: "EVEN-2",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "109417000000",
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");
    expect(diff.status).toBe("COMPUTED");
    // 88 vs 89 days is ordinary calendar drift within a 13-week quarter, not a week-count change.
    expect(diff.periodLengthMismatch).toBe(false);
  });

  it("carries the source, so a diff cannot be attributed to the wrong provider", async () => {
    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, "Revenues", "USD");
    expect(diff.sourceCode).toBe(TEST_SOURCE_CODE);
  });
  it("discloses that a figure was restated by a later filing", async () => {
    // A 10-K/A restates a number already reported in the 10-K: same concept, unit, periodStart
    // and periodEnd, different accession, later filedDate. Taking the amended value is right -
    // it is the company's own correction - but showing it identically to a first-time report
    // withholds something a reader would want (independent review, ``gpt-5.6-terra``).
    const concept = "RestatedRevenue";
    const common = {
      sourceId,
      corpCode: CORP_CODE,
      taxonomy: "us-gaap",
      concept,
      unit: "USD",
      form: "10-Q",
      raw: {},
    };
    await prisma.financialFact.createMany({
      data: [
        {
          ...common,
          periodStart: new Date("2025-12-29T00:00:00.000Z"),
          periodEnd: new Date("2026-03-28T00:00:00.000Z"),
          accessionNumber: "RS-PRIOR",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "90000",
        },
        {
          ...common,
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          accessionNumber: "RS-ORIGINAL",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "100000",
        },
        {
          // The amendment: same period, filed later, different value.
          ...common,
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          accessionNumber: "RS-AMENDED",
          filedDate: new Date("2026-08-15T00:00:00.000Z"),
          value: "110000",
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");

    expect(diff.status).toBe("COMPUTED");
    // The amended value is the one used.
    expect(diff.currentValue).toBe(110000);
    expect(diff.currentAccession).toBe("RS-AMENDED");
    expect(diff.currentIsRestatement).toBe(true);
    // The prior period was reported once, so it is not a restatement.
    expect(diff.previousIsRestatement).toBe(false);
  });

  it("does not label an ordinary first-time figure as restated", async () => {
    // The negative control. A flag set on everything discloses nothing.
    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, "Revenues", "USD");
    expect(diff.status).toBe("COMPUTED");
    expect(diff.currentIsRestatement).toBe(false);
    expect(diff.previousIsRestatement).toBe(false);
  });
  it("does not claim the amended value is shown when it picked the original", async () => {
    // Interaction between two of my own fixes, found by a final adversarial pass (``gpt-5.6-sol``).
    //
    // The same-filedDate tiebreak orders by id ASCENDING so the figures table and the changes
    // table agree. cuids are roughly monotonic, so ascending id means the EARLIER row - the
    // original. Meanwhile currentIsRestatement is true whenever two rows cover the period, and
    // the page says "the amended value is shown". On a same-day amendment those two facts
    // contradict: we show the original and claim it is the amendment.
    //
    // Each fix is correct alone. Together they produce a false statement about a financial figure.
    const concept = "SameDayAmendment";
    const common = {
      sourceId,
      corpCode: CORP_CODE,
      taxonomy: "us-gaap",
      concept,
      unit: "USD",
      raw: {},
    };
    const filedSameDay = new Date("2026-11-02T00:00:00.000Z");
    await prisma.financialFact.createMany({
      data: [
        {
          ...common,
          periodStart: new Date("2024-09-29T00:00:00.000Z"),
          periodEnd: new Date("2025-09-27T00:00:00.000Z"),
          accessionNumber: "SD-PRIOR",
          filedDate: new Date("2025-11-02T00:00:00.000Z"),
          form: "10-K",
          value: "90000000000",
        },
        {
          ...common,
          periodStart: new Date("2025-09-28T00:00:00.000Z"),
          periodEnd: new Date("2026-09-26T00:00:00.000Z"),
          accessionNumber: "SD-ORIGINAL",
          filedDate: filedSameDay,
          form: "10-K",
          value: "100000000000",
        },
        {
          ...common,
          periodStart: new Date("2025-09-28T00:00:00.000Z"),
          periodEnd: new Date("2026-09-26T00:00:00.000Z"),
          accessionNumber: "SD-AMENDED",
          filedDate: filedSameDay,
          form: "10-K/A",
          value: "97000000000",
        },
      ],
    });

    const diff = await computeFinancialFactDiff(sourceId, CORP_CODE, concept, "USD");
    expect(diff.status).toBe("COMPUTED");
    expect(diff.currentIsRestatement).toBe(true);

    // Whichever row the tiebreak picks, the claim and the figure must agree: if we report a
    // restatement, the value shown has to be the amendment.
    expect(diff.currentAccession).toBe("SD-AMENDED");
    expect(diff.currentValue).toBe(97000000000);

    await prisma.financialFact.deleteMany({ where: { sourceId, concept } });
  });
});
