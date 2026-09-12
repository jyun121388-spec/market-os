import { describe, expect, it } from "vitest";
import type { CompanyXray, ReportedFigure } from "@/server/domain/companyXray";
import { computeBuffettOracleLens, computeOracleBalanceSheet } from "@/server/domain/buffettOracle";
import {
  computeProfitability,
  NET_INCOME_CONCEPT,
  OPERATING_INCOME_CONCEPT,
  PROFITABILITY_LIMITATIONS,
} from "@/server/domain/profitability";

/**
 * `[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`, Company Intelligence half.
 *
 * The decision's constraint is not "compute margins", it is "compute them only where numerator and
 * denominator are source-backed, same-period, same-unit and mechanically identifiable". Every
 * control below is about one of those four words, because the arithmetic itself is a division and
 * nothing about a division is worth testing.
 */

function figure(
  over: Partial<ReportedFigure> & { concept: string; value: number },
): ReportedFigure {
  return {
    unit: "USD",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    periodMonths: 12,
    fiscalPeriod: "FY",
    fiscalYear: 2025,
    form: "10-K",
    accessionNumber: "0000320193-26-000001",
    ...over,
  };
}

const net = (value: number, over: Partial<ReportedFigure> = {}) =>
  figure({ concept: NET_INCOME_CONCEPT, value, ...over });
const operating = (value: number, over: Partial<ReportedFigure> = {}) =>
  figure({ concept: OPERATING_INCOME_CONCEPT, value, ...over });
const revenue = (value: number, over: Partial<ReportedFigure> = {}) =>
  figure({ concept: "RevenueFromContractWithCustomerExcludingAssessedTax", value, ...over });

const named = (figures: ReportedFigure[], name: string) =>
  computeProfitability(figures).find((r) => r.name === name)!;

describe("deterministic profitability ratios", () => {
  it("computes both margins when the two sides describe the same period in the same unit", () => {
    const figures = [net(250), operating(400), revenue(1000)];
    expect(named(figures, "NET_MARGIN")).toMatchObject({ status: "COMPUTED", percent: 25 });
    expect(named(figures, "OPERATING_MARGIN")).toMatchObject({ status: "COMPUTED", percent: 40 });
    // Provenance travels with both sides — a ratio a reader cannot check is not a fact.
    const r = named(figures, "NET_MARGIN");
    expect(r.numerator?.accessionNumber).toBe("0000320193-26-000001");
    expect(r.denominator?.concept).toBe("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(r.limitations).toBe(PROFITABILITY_LIMITATIONS);
  });

  it("refuses when the two sides cover different periods, however plausible the number would look", () => {
    // A quarter's profit over a year's revenue. 250/1000 is 25% and it means nothing.
    const figures = [
      net(250, { periodStart: "2025-10-01", periodMonths: 3, periodEnd: "2025-12-31" }),
      revenue(1000),
    ];
    const r = named(figures, "NET_MARGIN");
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unverifiableBecause).toBe("NO_SHARED_PERIOD");
    expect(r.percent).toBeUndefined();
  });

  it("refuses when the two sides are in different units", () => {
    const r = named([net(250, { unit: "USD" }), revenue(1000, { unit: "KRW" })], "NET_MARGIN");
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unverifiableBecause).toBe("NO_SHARED_PERIOD");
  });

  it("prefers the most recent period for which BOTH sides exist", () => {
    const figures = [
      // Newest, but revenue is missing for it — so it must not be chosen.
      net(999, { periodEnd: "2026-12-31", periodStart: "2026-01-01", fiscalYear: 2026 }),
      net(250),
      revenue(1000),
    ];
    const r = named(figures, "NET_MARGIN");
    expect(r.status).toBe("COMPUTED");
    expect(r.numerator?.periodEnd).toBe("2025-12-31");
    expect(r.percent).toBe(25);
  });

  it("refuses when two revenue tags disagree about the same period", () => {
    const figures = [
      net(250),
      figure({ concept: "Revenues", value: 1000 }),
      figure({ concept: "SalesRevenueNet", value: 900 }),
    ];
    const r = named(figures, "NET_MARGIN");
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unverifiableBecause).toBe("DENOMINATOR_AMBIGUOUS");
  });

  it("does not refuse when two revenue tags agree — the ratio is the same either way", () => {
    const figures = [
      net(250),
      figure({ concept: "Revenues", value: 1000 }),
      figure({ concept: "SalesRevenueNet", value: 1000 }),
    ];
    expect(named(figures, "NET_MARGIN")).toMatchObject({ status: "COMPUTED", percent: 25 });
  });

  it("reports a negative margin rather than refusing it — a loss is a fact", () => {
    const r = named([net(-300), revenue(1000)], "NET_MARGIN");
    expect(r.status).toBe("COMPUTED");
    expect(r.percent).toBe(-30);
  });

  it("refuses zero or negative revenue, where the ratio is undefined or meaningless", () => {
    for (const bad of [0, -50]) {
      const r = named([net(250), revenue(bad)], "NET_MARGIN");
      expect(r.status, String(bad)).toBe("UNVERIFIABLE");
      expect(r.unverifiableBecause, String(bad)).toBe("DENOMINATOR_NOT_POSITIVE");
      expect(r.percent, String(bad)).toBeUndefined();
    }
  });

  it("refuses a side with no filing identity", () => {
    const r = named([net(250, { accessionNumber: "" }), revenue(1000)], "NET_MARGIN");
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unverifiableBecause).toBe("PROVENANCE_INCOMPLETE");
  });

  it("names which side is missing rather than reporting a single vague failure", () => {
    expect(named([revenue(1000)], "NET_MARGIN").unverifiableBecause).toBe("NUMERATOR_MISSING");
    expect(named([net(250)], "NET_MARGIN").unverifiableBecause).toBe("DENOMINATOR_MISSING");
    expect(named([net(250), revenue(1000)], "OPERATING_MARGIN").unverifiableBecause).toBe(
      "NUMERATOR_MISSING",
    );
  });

  it("each ratio stands alone — one missing concept does not withhold the other", () => {
    const figures = [net(250), revenue(1000)];
    expect(named(figures, "NET_MARGIN").status).toBe("COMPUTED");
    expect(named(figures, "OPERATING_MARGIN").status).toBe("UNVERIFIABLE");
  });

  it("expands no vocabulary — only the four literal tags the ingest already stores are read", () => {
    // A near neighbour a synonym-expanding implementation would happily have used.
    const figures = [
      figure({ concept: "ProfitLoss", value: 250 }),
      figure({ concept: "RevenueFromContractWithCustomerIncludingAssessedTax", value: 1000 }),
    ];
    const r = named(figures, "NET_MARGIN");
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unverifiableBecause).toBe("NUMERATOR_MISSING");
  });
});

const oracleAnnual = (
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

const oracleInstant = (
  concept: string,
  value: number,
  periodEnd = "2025-12-31",
): ReportedFigure => ({
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

function oracleXray(): CompanyXray {
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
      oracleAnnual("RevenueFromContractWithCustomerExcludingAssessedTax", 100),
      oracleAnnual("NetIncomeLoss", 20),
      oracleAnnual("OperatingIncomeLoss", 25),
      oracleInstant("Assets", 200),
      oracleInstant("Liabilities", 80),
      oracleInstant("CashAndCashEquivalentsAtCarryingValue", 20),
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
    const lens = computeBuffettOracleLens(oracleXray());

    const operatingMargin = lens.profitability.find((r) => r.name === "OPERATING_MARGIN");
    const netMargin = lens.profitability.find((r) => r.name === "NET_MARGIN");
    expect(operatingMargin).toMatchObject({ status: "COMPUTED", percent: 25 });
    expect(netMargin).toMatchObject({ status: "COMPUTED", percent: 20 });

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
      oracleInstant("Assets", 200, "2025-12-31"),
      oracleInstant("Liabilities", 80, "2025-09-30"),
    ]);
    expect(result).toEqual({
      status: "UNVERIFIABLE",
      reason: "NO_MATCHED_PERIOD",
      limitation: expect.any(String),
    });
  });

  it("keeps unsupported dimensions explicit instead of filling them with prototype defaults", () => {
    const sparse: CompanyXray = {
      ...oracleXray(),
      company: {
        ...oracleXray().company,
        filingCount: 1,
        earliestFilingDate: "2025-12-31",
        latestFilingDate: "2025-12-31",
      },
      latestFigures: [oracleInstant("Assets", 200)],
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
