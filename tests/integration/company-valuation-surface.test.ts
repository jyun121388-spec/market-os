import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * The valuation surface against a real database, through the SAME two calls the page makes:
 * `computeCompanyXray` then `computeValuationScenarios`.
 *
 * `tests/valuationScenario.test.ts` proves the boundary's rules. This proves the boundary is
 * actually reachable from stored rows — that `latestFigures` really does hand it annual,
 * currency-denominated, accession-carrying facts, and that the selection the page shows in its
 * figures table is the selection the valuation used. Two modules agreeing in a unit test and
 * disagreeing about real rows is the failure this file exists to rule out; it is the same reason
 * `compareFactCurrency` is shared rather than reimplemented.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_VALUATION_SURFACE";
const CORP_CODE = "0000000901";

describeIfDb("scenario valuation over real stored facts", () => {
  let prisma: typeof PrismaClientInstance;
  let computeCompanyXray: typeof import("@/server/domain/companyXray").computeCompanyXray;
  let computeValuationScenarios: typeof import("@/server/domain/valuationScenario").computeValuationScenarios;
  let sourceId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
    await prisma.filing.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeCompanyXray } = await import("@/server/domain/companyXray"));
    ({ computeValuationScenarios } = await import("@/server/domain/valuationScenario"));
    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Valuation surface", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function filing(receiptNo: string, receiptDate: string) {
    await prisma.filing.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        corpName: "Valuation Fixture Inc.",
        stockCode: "VFX",
        reportName: "10-K",
        receiptNo,
        receiptDate: new Date(`${receiptDate}T00:00:00.000Z`),
        raw: {},
      },
    });
  }

  async function fact(over: {
    concept: string;
    value: string;
    periodStart: string | null;
    periodEnd: string;
    accessionNumber: string;
    filedDate: string;
    unit?: string;
    form?: string;
  }) {
    await prisma.financialFact.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: over.concept,
        unit: over.unit ?? "USD",
        periodStart: over.periodStart ? new Date(`${over.periodStart}T00:00:00.000Z`) : null,
        periodEnd: new Date(`${over.periodEnd}T00:00:00.000Z`),
        fiscalYear: Number(over.periodEnd.slice(0, 4)),
        fiscalPeriod: over.periodStart ? "FY" : null,
        form: over.form ?? "10-K",
        accessionNumber: over.accessionNumber,
        filedDate: new Date(`${over.filedDate}T00:00:00.000Z`),
        value: over.value,
        raw: {},
      },
    });
  }

  /** A full fiscal year plus the fourth quarter of it — the shape SEC actually files. */
  async function seedAnnualAndQuarter() {
    await filing("0000000901-26-000001", "2026-02-01");
    await fact({
      concept: "NetIncomeLoss",
      value: "1000000",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000001",
      filedDate: "2026-02-01",
    });
    await fact({
      concept: "NetIncomeLoss",
      value: "250000",
      periodStart: "2025-10-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000001",
      filedDate: "2026-02-01",
    });
    await fact({
      concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
      value: "8000000",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000001",
      filedDate: "2026-02-01",
    });
  }

  async function scenarios(pe?: [number, number, number], ps?: [number, number, number]) {
    const xray = await computeCompanyXray(CORP_CODE, SOURCE_CODE);
    expect(xray, "the page's own first call must resolve the company").not.toBeNull();
    return {
      xray: xray!,
      set: computeValuationScenarios({
        figures: xray!.latestFigures,
        sourceCode: xray!.company.sourceCode,
        completeness: xray!.completeness,
        peMultiples: pe ? { low: pe[0], base: pe[1], high: pe[2] } : undefined,
        psMultiples: ps ? { low: ps[0], base: ps[1], high: ps[2] } : undefined,
      }),
    };
  }

  it("computes both scenarios from stored rows, and uses the ANNUAL figure the page displays", async () => {
    await seedAnnualAndQuarter();
    const { xray, set } = await scenarios([10, 15, 20], [2, 3, 4]);

    expect(set.pe.status).toBe("COMPUTED");
    // 1,000,000 and not 250,000 — the quarter is stored under the same period end and the same
    // accession, which is exactly the identity collision the FinancialFact migration exists for.
    expect(set.pe.fact?.value).toBe(1_000_000);
    expect(set.pe.fact?.periodMonths).toBe(12);
    expect(set.pe.impliedEquityValue).toMatchObject({
      low: 10_000_000,
      base: 15_000_000,
      high: 20_000_000,
    });

    expect(set.ps.status).toBe("COMPUTED");
    expect(set.ps.fact?.concept).toBe("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(set.ps.impliedEquityValue?.base).toBe(24_000_000);

    // The valuation's fact must be one the figures table actually shows. If these ever diverge the
    // page states one number and calculates from another, which is the defect `compareFactCurrency`
    // was extracted to prevent between the figures and changes tables.
    const displayed = xray.latestFigures.find(
      (f) =>
        f.concept === set.pe.fact!.concept &&
        f.periodEnd === set.pe.fact!.periodEnd &&
        f.periodMonths === set.pe.fact!.periodMonths,
    );
    expect(displayed?.value).toBe(set.pe.fact!.value);
    expect(displayed?.accessionNumber).toBe(set.pe.fact!.accessionNumber);
  });

  it("carries real provenance — the accession is the filing the number was reported in", async () => {
    await seedAnnualAndQuarter();
    const { set } = await scenarios([10, 15, 20]);
    expect(set.pe.fact?.accessionNumber).toBe("0000000901-26-000001");
    expect(set.pe.fact?.sourceCode).toBe(SOURCE_CODE);
    expect(set.pe.fact?.form).toBe("10-K");
    const stored = await prisma.filing.findFirst({
      where: { sourceId, receiptNo: set.pe.fact!.accessionNumber },
    });
    expect(
      stored,
      "the accession must resolve to a stored filing, not a free-text label",
    ).not.toBeNull();
  });

  it("a loss-making year refuses P/E and still computes P/S, from the same stored rows", async () => {
    await filing("0000000901-26-000002", "2026-02-01");
    await fact({
      concept: "NetIncomeLoss",
      value: "-400000",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000002",
      filedDate: "2026-02-01",
    });
    await fact({
      concept: "SalesRevenueNet",
      value: "5000000",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000002",
      filedDate: "2026-02-01",
    });

    const { set } = await scenarios([10, 15, 20], [1, 2, 3]);
    expect(set.pe.status).toBe("UNVERIFIABLE");
    expect(set.pe.unverifiableBecause).toBe("VALUE_NOT_POSITIVE");
    expect(set.pe.impliedEquityValue).toBeUndefined();
    expect(set.ps.status).toBe("COMPUTED");
    // The original tag survives all the way from the database column to the output.
    expect(set.ps.fact?.concept).toBe("SalesRevenueNet");
  });

  it("a company with only quarterly filings gets a refusal, never a quarter scaled as a year", async () => {
    await filing("0000000901-26-000003", "2026-01-15");
    await fact({
      concept: "NetIncomeLoss",
      value: "250000",
      periodStart: "2025-10-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000901-26-000003",
      filedDate: "2026-01-15",
      form: "10-Q",
    });

    const { set } = await scenarios([10, 15, 20]);
    expect(set.pe.status).toBe("UNVERIFIABLE");
    expect(set.pe.unverifiableBecause).toBe("NO_ANNUAL_PERIOD");
    // 250,000 x 15 = 3,750,000 is a plausible-looking number and a quarter of the truth.
    expect(set.pe.impliedEquityValue).toBeUndefined();
  });

  it("an untouched form shows the fact and no calculation", async () => {
    await seedAnnualAndQuarter();
    const { set } = await scenarios();
    expect(set.pe.status).toBe("AWAITING_ASSUMPTIONS");
    expect(set.pe.fact?.value).toBe(1_000_000);
    expect(set.pe.assumptions).toBeUndefined();
    expect(set.pe.impliedEquityValue).toBeUndefined();
  });

  it("a company with no stored facts at all refuses both methods", async () => {
    await filing("0000000901-26-000004", "2026-03-01");
    const { set } = await scenarios([10, 15, 20], [1, 2, 3]);
    expect(set.pe.status).toBe("UNVERIFIABLE");
    expect(set.pe.unverifiableBecause).toBe("NO_FACT_FOR_CONCEPT");
    expect(set.ps.unverifiableBecause).toBe("NO_FACT_FOR_CONCEPT");
  });
});
