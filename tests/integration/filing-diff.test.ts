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

  it("computeFilingDiff batches multiple concepts in one call", async () => {
    const diffs = await computeFilingDiff(sourceId, CORP_CODE, [
      { concept: "Revenues", unit: "USD" },
      { concept: "NetIncomeLoss", unit: "USD" },
    ]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].status).toBe("COMPUTED");
    expect(diffs[1].status).toBe("INSUFFICIENT_DATA");
  });
});
