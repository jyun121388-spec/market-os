import { describe, expect, it } from "vitest";
import type { CompanyXray, ReportedFigure } from "@/server/domain/companyXray";
import { computeBuffettOracleProfile } from "@/server/domain/buffettOracle";

function figure(
  concept: string,
  value: number,
  periodStart: string | null,
  periodEnd: string,
  periodMonths: number | null,
  accessionNumber: string,
): ReportedFigure {
  return {
    concept,
    unit: "USD",
    value,
    periodStart,
    periodEnd,
    periodMonths,
    fiscalPeriod: periodMonths === 12 ? "FY" : null,
    fiscalYear: 2025,
    form: "10-K",
    accessionNumber,
  };
}

function xray(status: CompanyXray["completeness"]["status"] = "COMPLETE"): CompanyXray {
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
      figure("Revenues", 1000, "2025-01-01", "2025-12-31", 12, "rev-current"),
      figure("NetIncomeLoss", 100, "2025-01-01", "2025-12-31", 12, "ni-current"),
      figure("OperatingIncomeLoss", 150, "2025-01-01", "2025-12-31", 12, "op-current"),
      figure("Liabilities", 500, null, "2025-12-31", null, "bs-current"),
      figure("StockholdersEquity", 250, null, "2025-12-31", null, "bs-current"),
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

describe("Buffett Oracle research lens", () => {
  it("uses existing sourced changes instead of inventing a growth history", () => {
    const profile = computeBuffettOracleProfile(xray());
    const earnings = profile.lenses.find((l) => l.id === "EARNINGS");
    const revenue = profile.lenses.find((l) => l.id === "REVENUE");

    expect(earnings?.headline).toContain("+25.0%");
    expect(earnings?.provenance).toEqual(["ni-current", "ni-prior"]);
    expect(revenue?.headline).toContain("+11.1%");
    expect(revenue?.provenance).toEqual(["rev-current", "rev-prior"]);
  });

  it("keeps the uploaded analyst moat library outside decision authority", () => {
    const profile = computeBuffettOracleProfile(xray());
    const moat = profile.lenses.find((l) => l.id === "MOAT");

    expect(moat?.tone).toBe("UNVERIFIABLE");
    expect(moat?.headline).toMatch(/excluded/i);
    expect(moat?.provenance).toEqual([]);
    expect(profile.readiness).toBe("EVIDENCE_GAPS");
  });

  it("computes only a same-date same-unit balance-sheet ratio and does not grade it", () => {
    const profile = computeBuffettOracleProfile(xray());
    const balance = profile.lenses.find((l) => l.id === "BALANCE_SHEET");

    expect(balance?.headline).toBe("Liabilities / equity = 2.00×");
    expect(balance?.tone).toBe("NEUTRAL");
    expect(balance?.provenance).toEqual(["bs-current", "bs-current"]);
  });

  it("propagates Market OS completeness risk instead of hiding it behind an Oracle score", () => {
    const profile = computeBuffettOracleProfile(xray("KNOWN_INCOMPLETE"));
    expect(profile.readiness).toBe("DATA_UNSAFE");
    expect(profile.readinessReason).toMatch(/completeness/i);
    expect(profile.lenses.find((l) => l.id === "EVIDENCE")?.tone).toBe("CAUTION");
  });

  it("does not expose recommendation, target-price or hard-coded fair-value authority", () => {
    const profile = computeBuffettOracleProfile(xray());
    const serialized = JSON.stringify(profile).toLowerCase();

    expect(serialized).not.toContain("buy_now");
    expect(serialized).not.toContain("target price");
    expect(serialized).not.toContain("fair value");
    expect(serialized).not.toContain("sell recommendation");
    expect(profile.limitations.join(" ")).toMatch(/no buy\/sell\/hold recommendation/i);
  });
});
