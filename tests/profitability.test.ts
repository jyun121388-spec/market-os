import { describe, expect, it } from "vitest";
import type { CompanyXray, ReportedFigure } from "@/server/domain/companyXray";
import { computeBuffettOracleProfile } from "@/server/domain/buffettOracle";
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

function oracleXray(status: CompanyXray["completeness"]["status"] = "COMPLETE"): CompanyXray {
  const flow = (concept: string, value: number, accessionNumber: string): ReportedFigure => ({
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
  const instant = (concept: string, value: number): ReportedFigure => ({
    ...flow(concept, value, "bs-current"),
    periodStart: null,
    periodMonths: null,
  });

  return {
    company: {
      corpCode: "0000320193",
      corpName: "Example Corp",
      stockCode: "EXM",
      sourceCode: "SEC_EDGAR",
      filingCount: 2,
      earliestFilingDate: "2025-01-01",
      latestFilingDate: "2026-01-01",
    },
    latestFigures: [
      flow("Revenues", 1000, "rev-current"),
      flow("NetIncomeLoss", 100, "ni-current"),
      flow("OperatingIncomeLoss", 150, "op-current"),
      instant("Liabilities", 500),
      instant("StockholdersEquity", 250),
    ],
    changes: [
      {
        status: "COMPUTED",
        corpCode: "0000320193",
        concept: "Revenues",
        unit: "USD",
        currentAccession: "rev-current",
        previousAccession: "rev-prior",
        currentValue: 1000,
        previousValue: 900,
        absoluteChange: 100,
        percentChange: 11.1111,
        sourceCode: "SEC_EDGAR",
        currentPeriodEnd: "2025-12-31",
        previousPeriodEnd: "2024-12-31",
        periodMonths: 12,
      },
      {
        status: "COMPUTED",
        corpCode: "0000320193",
        concept: "NetIncomeLoss",
        unit: "USD",
        currentAccession: "ni-current",
        previousAccession: "ni-prior",
        currentValue: 100,
        previousValue: 80,
        absoluteChange: 20,
        percentChange: 25,
        sourceCode: "SEC_EDGAR",
        currentPeriodEnd: "2025-12-31",
        previousPeriodEnd: "2024-12-31",
        periodMonths: 12,
      },
    ],
    recentFilings: [],
    completeness: { status, detail: `fixture ${status}` },
  };
}

describe("Buffett Oracle evidence lens", () => {
  it("uses source-backed company changes and keeps their provenance", () => {
    const profile = computeBuffettOracleProfile(oracleXray());
    const earnings = profile.lenses.find((l) => l.id === "EARNINGS");
    const revenueLens = profile.lenses.find((l) => l.id === "REVENUE");
    expect(earnings?.headline).toContain("+25.0%");
    expect(earnings?.provenance).toEqual(["ni-current", "ni-prior"]);
    expect(revenueLens?.headline).toContain("+11.1%");
    expect(revenueLens?.provenance).toEqual(["rev-current", "rev-prior"]);
  });

  it("refuses competing latest revenue identities rather than choosing a convenient tag", () => {
    const fixture = oracleXray();
    fixture.changes.push({
      status: "COMPUTED",
      corpCode: "0000320193",
      concept: "SalesRevenueNet",
      unit: "USD",
      currentAccession: "sales-current",
      previousAccession: "sales-prior",
      currentValue: 850,
      previousValue: 800,
      absoluteChange: 50,
      percentChange: 6.25,
      sourceCode: "SEC_EDGAR",
      currentPeriodEnd: "2025-12-31",
      previousPeriodEnd: "2024-12-31",
      periodMonths: 12,
    });
    const revenueLens = computeBuffettOracleProfile(fixture).lenses.find((l) => l.id === "REVENUE");
    expect(revenueLens).toMatchObject({ tone: "UNVERIFIABLE", provenance: [] });
    expect(revenueLens?.headline).toMatch(/ambiguous/i);
  });

  it("keeps the prototype moat library explicitly outside evidence authority", () => {
    const profile = computeBuffettOracleProfile(oracleXray());
    const moat = profile.lenses.find((l) => l.id === "MOAT");
    expect(moat).toMatchObject({ tone: "UNVERIFIABLE", provenance: [] });
    expect(profile.readiness).toBe("EVIDENCE_GAPS");
  });

  it("computes balance-sheet arithmetic only from same-date same-unit instant facts", () => {
    const profile = computeBuffettOracleProfile(oracleXray());
    const balance = profile.lenses.find((l) => l.id === "BALANCE_SHEET");
    expect(balance?.headline).toBe("Liabilities / equity = 2.00×");
    expect(balance?.tone).toBe("NEUTRAL");
  });

  it("propagates Market OS completeness risk instead of hiding it behind a score", () => {
    const profile = computeBuffettOracleProfile(oracleXray("KNOWN_INCOMPLETE"));
    expect(profile.readiness).toBe("DATA_UNSAFE");
    expect(profile.lenses.find((l) => l.id === "EVIDENCE")?.tone).toBe("CAUTION");
  });

  it("keeps prohibited investment authority out of research output while naming it in limitations", () => {
    const profile = computeBuffettOracleProfile(oracleXray());
    const researchOutput = JSON.stringify(profile.lenses).toLowerCase();
    const limitations = profile.limitations.join(" ").toLowerCase();
    expect(researchOutput).not.toContain("buy_now");
    expect(researchOutput).not.toContain("target price");
    expect(researchOutput).not.toContain("fair value");
    expect(researchOutput).not.toContain("sell recommendation");
    expect(limitations).toContain("no buy/sell/hold recommendation");
    expect(limitations).toContain("no target price");
  });
});
