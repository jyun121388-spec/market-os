import type { CompanyXray, ReportedFigure } from "./companyXray";
import type { FilingDiffResult } from "./filingDiff";
import { computeProfitability, type ProfitabilityRatio } from "./profitability";
import {
  EARNINGS_CONCEPT,
  REVENUE_CONCEPTS,
  computeValuationScenarios,
} from "./valuationScenario";

/**
 * Buffett Oracle Lens
 * -------------------
 *
 * This is the part of the uploaded Buffett Oracle concept that is safe and useful to retain:
 * a disciplined value-investing research checklist over source-backed company facts.
 *
 * It deliberately does NOT carry over the standalone prototype's hard-coded prices, simulated
 * price paths, buy/sell labels, target prices, recommended share counts, broker links or browser
 * API-key flow. Market OS already has stronger authorities for provenance, filings, freshness,
 * bounded valuation scenarios and uncertainty, so this module is only an evidence lens over those
 * authorities. It never queries a provider and it never invents a missing input.
 */

export type OracleAvailability = "AVAILABLE" | "UNVERIFIABLE";

export interface OracleBalanceSheetLens {
  status: OracleAvailability;
  reason?:
    | "ASSETS_MISSING"
    | "LIABILITIES_MISSING"
    | "NO_MATCHED_PERIOD"
    | "ASSETS_NOT_POSITIVE"
    | "PROVENANCE_INCOMPLETE";
  periodEnd?: string;
  unit?: string;
  liabilitiesToAssetsPct?: number;
  cashToLiabilitiesPct?: number;
  assets?: OracleFact;
  liabilities?: OracleFact;
  cash?: OracleFact;
  limitation: string;
}

export interface OracleFact {
  concept: string;
  value: number;
  unit: string;
  periodEnd: string;
  accessionNumber: string;
  form: string;
}

export interface OracleChangeLens {
  status: "COMPUTED" | "INSUFFICIENT_DATA";
  concept: string;
  percentChange?: number | null;
  currentPeriodEnd?: string;
  previousPeriodEnd?: string;
  periodMonths?: number | null;
  periodLengthMismatch?: boolean;
  sourceCode?: string;
  currentAccession?: string;
  previousAccession?: string;
}

export interface OracleDurabilityLens {
  filingCount: number;
  earliestFilingDate: string | null;
  latestFilingDate: string | null;
  coveredYears: number | null;
  completenessStatus: CompanyXray["completeness"]["status"];
  completenessDetail: string;
}

export interface OracleValuationReadiness {
  pe: "FACT_READY" | "UNVERIFIABLE";
  ps: "FACT_READY" | "UNVERIFIABLE";
  peReason?: string;
  psReason?: string;
  limitation: string;
}

export interface BuffettOracleLens {
  company: CompanyXray["company"];
  profitability: ProfitabilityRatio[];
  balanceSheet: OracleBalanceSheetLens;
  durability: OracleDurabilityLens;
  earningsChange: OracleChangeLens;
  revenueChange: OracleChangeLens;
  valuationReadiness: OracleValuationReadiness;
  evidenceCoverage: {
    supportedDimensions: number;
    totalDimensions: number;
  };
  /**
   * Human-readable product contract. This is not a legal disclaimer bolted on after the fact: the
   * shapes above also contain no action, target-price or portfolio-allocation field.
   */
  contract: string;
}

const BALANCE_LIMITATION =
  "Liabilities ÷ assets and cash ÷ liabilities are arithmetic over same-date, same-unit filed " +
  "facts. They are balance-sheet context, not a debt rating, credit opinion or investment signal.";

const ORACLE_CONTRACT =
  "Evidence-first value-investing research. Market OS shows sourced facts, calculations and data " +
  "gaps; it does not choose an investment action, target price, expected return or position size.";

function fact(f: ReportedFigure): OracleFact {
  return {
    concept: f.concept,
    value: f.value,
    unit: f.unit,
    periodEnd: f.periodEnd,
    accessionNumber: f.accessionNumber,
    form: f.form,
  };
}

const hasProvenance = (f: ReportedFigure): boolean =>
  f.accessionNumber.trim().length > 0 && f.form.trim().length > 0;

const newestFirst = (a: ReportedFigure, b: ReportedFigure): number =>
  a.periodEnd === b.periodEnd ? 0 : a.periodEnd < b.periodEnd ? 1 : -1;

/**
 * Balance-sheet resilience context using only concepts already tracked by Market OS.
 *
 * Assets and liabilities must refer to the same instant and unit. Cash is optional: its absence
 * withholds only the cash ratio, not the liabilities/assets calculation that is otherwise proven.
 */
export function computeOracleBalanceSheet(figures: ReportedFigure[]): OracleBalanceSheetLens {
  const assets = figures
    .filter((f) => f.concept === "Assets" && f.periodStart === null)
    .sort(newestFirst);
  const liabilities = figures
    .filter((f) => f.concept === "Liabilities" && f.periodStart === null)
    .sort(newestFirst);

  if (assets.length === 0) {
    return { status: "UNVERIFIABLE", reason: "ASSETS_MISSING", limitation: BALANCE_LIMITATION };
  }
  if (liabilities.length === 0) {
    return {
      status: "UNVERIFIABLE",
      reason: "LIABILITIES_MISSING",
      limitation: BALANCE_LIMITATION,
    };
  }

  const pairs: Array<{ assets: ReportedFigure; liabilities: ReportedFigure }> = [];
  for (const a of assets) {
    const matched = liabilities.find(
      (l) => l.periodEnd === a.periodEnd && l.unit === a.unit && l.periodStart === null,
    );
    if (matched) pairs.push({ assets: a, liabilities: matched });
  }
  if (pairs.length === 0) {
    return { status: "UNVERIFIABLE", reason: "NO_MATCHED_PERIOD", limitation: BALANCE_LIMITATION };
  }

  const chosen = pairs[0];
  if (!hasProvenance(chosen.assets) || !hasProvenance(chosen.liabilities)) {
    return {
      status: "UNVERIFIABLE",
      reason: "PROVENANCE_INCOMPLETE",
      limitation: BALANCE_LIMITATION,
    };
  }
  if (!Number.isFinite(chosen.assets.value) || chosen.assets.value <= 0) {
    return {
      status: "UNVERIFIABLE",
      reason: "ASSETS_NOT_POSITIVE",
      limitation: BALANCE_LIMITATION,
    };
  }

  const cash = figures
    .filter(
      (f) =>
        f.concept === "CashAndCashEquivalentsAtCarryingValue" &&
        f.periodStart === null &&
        f.periodEnd === chosen.assets.periodEnd &&
        f.unit === chosen.assets.unit,
    )
    .sort(newestFirst)[0];

  const liabilitiesToAssetsPct =
    Math.round((chosen.liabilities.value / chosen.assets.value) * 10000) / 100;
  const cashToLiabilitiesPct =
    cash &&
    hasProvenance(cash) &&
    Number.isFinite(cash.value) &&
    Number.isFinite(chosen.liabilities.value) &&
    chosen.liabilities.value > 0
      ? Math.round((cash.value / chosen.liabilities.value) * 10000) / 100
      : undefined;

  return {
    status: "AVAILABLE",
    periodEnd: chosen.assets.periodEnd,
    unit: chosen.assets.unit,
    liabilitiesToAssetsPct,
    cashToLiabilitiesPct,
    assets: fact(chosen.assets),
    liabilities: fact(chosen.liabilities),
    cash: cash && hasProvenance(cash) ? fact(cash) : undefined,
    limitation: BALANCE_LIMITATION,
  };
}

function yearsCovered(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / (365.2425 * 24 * 60 * 60 * 1000)) * 10) / 10;
}

function changeFor(
  changes: FilingDiffResult[],
  concepts: readonly string[],
): OracleChangeLens {
  for (const concept of concepts) {
    const c = changes.find((row) => row.concept === concept);
    if (!c) continue;
    if (c.status !== "COMPUTED") return { status: "INSUFFICIENT_DATA", concept };
    return {
      status: "COMPUTED",
      concept: c.concept,
      percentChange: c.percentChange,
      currentPeriodEnd: c.currentPeriodEnd,
      previousPeriodEnd: c.previousPeriodEnd,
      periodMonths: c.periodMonths,
      periodLengthMismatch: c.periodLengthMismatch,
      sourceCode: c.sourceCode,
      currentAccession: c.currentAccession,
      previousAccession: c.previousAccession,
    };
  }
  return { status: "INSUFFICIENT_DATA", concept: concepts[0] ?? "UNKNOWN" };
}

/**
 * Build the Oracle research lens from the SAME read model used by Company Intelligence.
 *
 * No second database query and no second fact-selection authority lives here. If Company X-Ray
 * cannot prove a number, Oracle cannot magically prove it either.
 */
export function computeBuffettOracleLens(xray: CompanyXray): BuffettOracleLens {
  const profitability = computeProfitability(xray.latestFigures);
  const balanceSheet = computeOracleBalanceSheet(xray.latestFigures);
  const valuation = computeValuationScenarios({
    figures: xray.latestFigures,
    sourceCode: xray.company.sourceCode,
    completeness: xray.completeness,
  });

  const peReady = valuation.pe.status === "AWAITING_ASSUMPTIONS";
  const psReady = valuation.ps.status === "AWAITING_ASSUMPTIONS";
  const profitabilityReady = profitability.some((r) => r.status === "COMPUTED");
  const durabilityReady = Boolean(
    xray.company.earliestFilingDate && xray.company.latestFilingDate && xray.company.filingCount > 0,
  );
  const earningsChange = changeFor(xray.changes, [EARNINGS_CONCEPT]);
  const revenueChange = changeFor(xray.changes, REVENUE_CONCEPTS);
  const changeReady =
    earningsChange.status === "COMPUTED" || revenueChange.status === "COMPUTED";

  const supportedDimensions = [
    profitabilityReady,
    balanceSheet.status === "AVAILABLE",
    durabilityReady,
    changeReady,
    peReady || psReady,
  ].filter(Boolean).length;

  return {
    company: xray.company,
    profitability,
    balanceSheet,
    durability: {
      filingCount: xray.company.filingCount,
      earliestFilingDate: xray.company.earliestFilingDate,
      latestFilingDate: xray.company.latestFilingDate,
      coveredYears: yearsCovered(
        xray.company.earliestFilingDate,
        xray.company.latestFilingDate,
      ),
      completenessStatus: xray.completeness.status,
      completenessDetail: xray.completeness.detail,
    },
    earningsChange,
    revenueChange,
    valuationReadiness: {
      pe: peReady ? "FACT_READY" : "UNVERIFIABLE",
      ps: psReady ? "FACT_READY" : "UNVERIFIABLE",
      peReason: peReady ? undefined : valuation.pe.unverifiableBecause,
      psReason: psReady ? undefined : valuation.ps.unverifiableBecause,
      limitation:
        "Oracle does not choose a multiple. Use the existing Market OS valuation surface to enter " +
        "your own low/base/high assumptions against the sourced annual fact.",
    },
    evidenceCoverage: { supportedDimensions, totalDimensions: 5 },
    contract: ORACLE_CONTRACT,
  };
}
