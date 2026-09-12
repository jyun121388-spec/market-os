import { describe, expect, it } from "vitest";
import type { CompanyXray, ReportedFigure } from "@/server/domain/companyXray";
import { computeBuffettOracleLens, computeOracleBalanceSheet } from "@/server/domain/buffettOracle";

const annual = (
  concept: string,
  value: number,
  accessionNumber = "0000320193-26-000001",
): ReportedFigure => ({
  concept,
  unit: "USD",
  value,
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  periodMonths: 12,
  fiscalPeriod: "FY",
  fiscalYear: 2025,
  form: "10-K",
  accessionNumber,
});

const instant = (concept: string, value: number, periodEnd = "2025-12-31"): ReportedFigure => ({
  concept,
  unit: "USD",
  value,
  periodStart: null,
  periodEnd,
  periodMonths: null,
  fiscalPeriod: "FY",
  fiscalYear: 2025,
  form: "10-K",
  accessionNumber: "0000320193-26-000001",
});

function xray(): CompanyXray {
  return {
    company: {
      corpCode: "0000320193",
      corpName: "Example Corp",
      stockCode: "EXM",
      sourceCode: "SEC_EDGAR",
      filingCount: 42,
      earliestFilingDate: "2015-01-01",
      latestFilingDate: "2025-12-31",
    },
    latestFigures: [
      annual("RevenueFromContractWithCustomerExcludingAssessedTax", 100),
      annual("NetIncomeLoss", 20),
      annual("OperatingIncomeLoss", 25),
      instant("Assets", 200),
      instant("Liabilities", 80),
      instant("CashAndCashEquivalentsAtCarryingValue", 20),
    ],
    changes: [
      {
        status: "COMPUTED",
        corpCode: "0000320193",
        concept: "NetIncomeLoss",
        unit: "USD",
        currentAccession: "0000320193-26-000001",
        previousAccession: "0000320193-25-000001",
        currentValue: 20,
        previousValue: 17.7777777778,
        absoluteChange: 2.2222,
        percentChange: 12.5,
        sourceCode: "SEC_EDGAR",
        currentPeriodEnd: "2025-12-31",
        previousPeriodEnd: "2024-12-31",
        periodMonths: 12,
        currentPeriodDays: 364,
        previousPeriodDays: 365,
        periodLengthMismatch: false,
      },
      {
        status: "COMPUTED",
        corpCode: "0000320193",
        concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
        unit: "USD",
        currentAccession: "0000320193-26-000001",
        previousAccession: "0000320193-25-000001",
        currentValue: 100,
        previousValue: 92.5925925926,
        absoluteChange: 7.4074,
        percentChange: 8,
        sourceCode: "SEC_EDGAR",
        currentPeriodEnd: "2025-12-31",
        previousPeriodEnd: "2024-12-31",
        periodMonths: 12,
        currentPeriodDays: 364,
        previousPeriodDays: 365,
        periodLengthMismatch: false,
      },
    ],
    recentFilings: [
      { reportName: "10-K", receiptNo: "0000320193-26-000001", receiptDate: "2026-02-01" },
    ],
    completeness: { status: "COMPLETE", detail: "full tracked history fetched" },
  };
}

describe("Buffett Oracle evidence lens", () => {
  it("reuses sourced facts without producing an investment-action object", () => {
    const lens = computeBuffettOracleLens(xray());

    const operating = lens.profitability.find((r) => r.name === "OPERATING_MARGIN");
    const net = lens.profitability.find((r) => r.name === "NET_MARGIN");
    expect(operating).toMatchObject({ status: "COMPUTED", percent: 25 });
    expect(net).toMatchObject({ status: "COMPUTED", percent: 20 });

    expect(lens.balanceSheet).toMatchObject({
      status: "AVAILABLE",
      liabilitiesToAssetsPct: 40,
      cashToLiabilitiesPct: 25,
      periodEnd: "2025-12-31",
      unit: "USD",
    });
    expect(lens.earningsChange).toMatchObject({ status: "COMPUTED", percentChange: 12.5 });
    expect(lens.revenueChange).toMatchObject({ status: "COMPUTED", percentChange: 8 });
    expect(lens.valuationReadiness).toMatchObject({ pe: "FACT_READY", ps: "FACT_READY" });
    expect(lens.evidenceCoverage).toEqual({ supportedDimensions: 5, totalDimensions: 5 });

    const topLevelKeys = Object.keys(lens);
    for (const forbidden of [
      "buySignal",
      "recommendedShares",
      "targetPrice",
      "targetPrice10Y",
      "expectedReturn",
      "portfolioWeight",
    ]) {
      expect(topLevelKeys).not.toContain(forbidden);
    }
  });

  it("refuses a balance-sheet ratio when assets and liabilities are not the same instant", () => {
    const result = computeOracleBalanceSheet([
      instant("Assets", 200, "2025-12-31"),
      instant("Liabilities", 80, "2025-09-30"),
    ]);
    expect(result).toEqual({
      status: "UNVERIFIABLE",
      reason: "NO_MATCHED_PERIOD",
      limitation: expect.any(String),
    });
  });

  it("keeps unsupported dimensions explicit instead of filling them with prototype defaults", () => {
    const sparse: CompanyXray = {
      ...xray(),
      company: {
        ...xray().company,
        filingCount: 1,
        earliestFilingDate: "2025-12-31",
        latestFilingDate: "2025-12-31",
      },
      latestFigures: [instant("Assets", 200)],
      changes: [],
      completeness: { status: "UNKNOWN", detail: "no ingest run recorded" },
    };

    const lens = computeBuffettOracleLens(sparse);
    expect(lens.balanceSheet).toMatchObject({
      status: "UNVERIFIABLE",
      reason: "LIABILITIES_MISSING",
    });
    expect(lens.valuationReadiness.pe).toBe("UNVERIFIABLE");
    expect(lens.valuationReadiness.ps).toBe("UNVERIFIABLE");
    expect(lens.earningsChange.status).toBe("INSUFFICIENT_DATA");
    expect(lens.revenueChange.status).toBe("INSUFFICIENT_DATA");
    expect(lens.evidenceCoverage.supportedDimensions).toBe(1);
  });
});
