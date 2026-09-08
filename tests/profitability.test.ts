import { describe, expect, it } from "vitest";
import type { ReportedFigure } from "@/server/domain/companyXray";
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
