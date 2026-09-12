import type { CompanyXray } from "./companyXray";
import { computeProfitability, type ProfitabilityRatio } from "./profitability";
import { REVENUE_CONCEPTS } from "./valuationScenario";

/**
 * Buffett Oracle research lens.
 *
 * This module deliberately sits ON TOP OF Market OS evidence instead of creating another data
 * authority. It consumes only CompanyXray + deterministic ratios already produced by Market OS.
 * No network calls, no provider credentials, no invented prices, no hidden defaults and no LLM.
 *
 * The uploaded Buffett Oracle prototype contains valuable research concepts (quality, moat,
 * bottom/value-trap, company-type routing), but also hard-coded analyst estimates and its own
 * provider bridge. Those ideas are useful; the duplicate authority is not. This module keeps the
 * research workflow while preserving Market OS provenance/UNKNOWN/completeness semantics.
 */

export type OracleTone = "POSITIVE" | "CAUTION" | "UNVERIFIABLE" | "NEUTRAL";

export interface OracleLensItem {
  id: "EARNINGS" | "REVENUE" | "MARGINS" | "BALANCE_SHEET" | "MOAT" | "EVIDENCE";
  label: string;
  tone: OracleTone;
  headline: string;
  detail: string;
  provenance: string[];
}

export interface OracleProfile {
  readiness: "RESEARCH_READY" | "EVIDENCE_GAPS" | "DATA_UNSAFE";
  readinessReason: string;
  lenses: OracleLensItem[];
  profitability: ProfitabilityRatio[];
  limitations: string[];
}

const EQUITY_CONCEPTS = [
  "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "Equity",
  "EquityAttributableToOwnersOfParent",
] as const;
const LIABILITY_CONCEPTS = ["Liabilities"] as const;

function pct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v)
    ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
    : "N/A";
}

function latestComputedChange(xray: CompanyXray, concepts: readonly string[]) {
  const candidates = xray.changes.filter(
    (c) =>
      c.status === "COMPUTED" &&
      concepts.includes(c.concept) &&
      typeof c.percentChange === "number",
  );
  return candidates.sort((a, b) =>
    String(b.currentPeriodEnd ?? "").localeCompare(String(a.currentPeriodEnd ?? "")),
  )[0];
}

function uniqueInstantFigure(xray: CompanyXray, concepts: readonly string[]) {
  const rows = xray.latestFigures.filter(
    (f) => concepts.includes(f.concept) && f.periodStart === null && Number.isFinite(f.value),
  );
  if (rows.length === 0) return null;
  const newestEnd = rows
    .map((r) => r.periodEnd)
    .sort()
    .at(-1);
  const newest = rows.filter((r) => r.periodEnd === newestEnd);
  const identities = new Set(newest.map((r) => `${r.unit}|${r.value}`));
  if (identities.size !== 1) return null;
  return newest[0];
}

function earningsLens(xray: CompanyXray): OracleLensItem {
  const change = latestComputedChange(xray, ["NetIncomeLoss", "ProfitLoss"]);
  if (!change || typeof change.percentChange !== "number") {
    return {
      id: "EARNINGS",
      label: "Earnings durability",
      tone: "UNVERIFIABLE",
      headline: "Comparable earnings trend unavailable",
      detail:
        "Market OS has no mechanically comparable prior-period earnings pair for this company.",
      provenance: [],
    };
  }
  const positive = change.percentChange >= 0;
  return {
    id: "EARNINGS",
    label: "Earnings durability",
    tone: positive ? "POSITIVE" : "CAUTION",
    headline: `${pct(change.percentChange)} comparable-period earnings change`,
    detail: `Compared ${change.previousPeriodEnd ?? "prior"} with ${change.currentPeriodEnd ?? "current"}. This is a reported-fact delta, not a forecast.`,
    provenance: [change.currentAccession, change.previousAccession].filter(Boolean) as string[],
  };
}

function revenueLens(xray: CompanyXray): OracleLensItem {
  const change = latestComputedChange(xray, REVENUE_CONCEPTS);
  if (!change || typeof change.percentChange !== "number") {
    return {
      id: "REVENUE",
      label: "Revenue durability",
      tone: "UNVERIFIABLE",
      headline: "Comparable revenue trend unavailable",
      detail: "No same-duration, source-backed revenue pair is currently available.",
      provenance: [],
    };
  }
  return {
    id: "REVENUE",
    label: "Revenue durability",
    tone: change.percentChange >= 0 ? "POSITIVE" : "CAUTION",
    headline: `${pct(change.percentChange)} comparable-period revenue change`,
    detail: `Literal concept ${change.concept}. Market OS refuses period-mismatched comparisons instead of fabricating growth.`,
    provenance: [change.currentAccession, change.previousAccession].filter(Boolean) as string[],
  };
}

function marginLens(profitability: ProfitabilityRatio[]): OracleLensItem {
  const net = profitability.find((r) => r.name === "NET_MARGIN");
  const op = profitability.find((r) => r.name === "OPERATING_MARGIN");
  const computed = [net, op].filter(
    (r): r is ProfitabilityRatio & { percent: number } =>
      r?.status === "COMPUTED" && typeof r.percent === "number",
  );
  if (computed.length === 0) {
    return {
      id: "MARGINS",
      label: "Economic quality",
      tone: "UNVERIFIABLE",
      headline: "Margins are not mechanically verifiable",
      detail: "Numerator and revenue must share the same period, unit and filing provenance.",
      provenance: [],
    };
  }
  const values = computed.map((r) => r.percent);
  const tone: OracleTone = values.every((v) => v > 0) ? "POSITIVE" : "CAUTION";
  return {
    id: "MARGINS",
    label: "Economic quality",
    tone,
    headline: computed
      .map((r) => `${r.name === "NET_MARGIN" ? "Net" : "Operating"} ${pct(r.percent)}`)
      .join(" · "),
    detail:
      "Deterministic same-period ratios over company-reported facts. No industry benchmark or peer inference is embedded.",
    provenance: computed
      .flatMap((r) => [r.numerator?.accessionNumber, r.denominator?.accessionNumber])
      .filter(Boolean) as string[],
  };
}

function balanceLens(xray: CompanyXray): OracleLensItem {
  const liabilities = uniqueInstantFigure(xray, LIABILITY_CONCEPTS);
  const equity = uniqueInstantFigure(xray, EQUITY_CONCEPTS);
  if (
    !liabilities ||
    !equity ||
    liabilities.periodEnd !== equity.periodEnd ||
    liabilities.unit !== equity.unit
  ) {
    return {
      id: "BALANCE_SHEET",
      label: "Balance-sheet evidence",
      tone: "UNVERIFIABLE",
      headline: "Comparable liabilities/equity pair unavailable",
      detail:
        "Oracle will not mix different dates, units or ambiguous equity concepts to create a leverage ratio.",
      provenance: [],
    };
  }
  if (equity.value <= 0) {
    return {
      id: "BALANCE_SHEET",
      label: "Balance-sheet evidence",
      tone: "CAUTION",
      headline: "Reported equity is non-positive",
      detail: `${equity.periodEnd} · ${equity.unit}. No leverage ratio is published when equity is non-positive.`,
      provenance: [liabilities.accessionNumber, equity.accessionNumber],
    };
  }
  const ratio = liabilities.value / equity.value;
  return {
    id: "BALANCE_SHEET",
    label: "Balance-sheet evidence",
    tone: "NEUTRAL",
    headline: `Liabilities / equity = ${ratio.toFixed(2)}×`,
    detail: `Arithmetic over same-date instant facts (${equity.periodEnd}). No good/bad threshold is imposed by Market OS.`,
    provenance: [liabilities.accessionNumber, equity.accessionNumber],
  };
}

function moatLens(): OracleLensItem {
  return {
    id: "MOAT",
    label: "Moat",
    tone: "UNVERIFIABLE",
    headline: "Analyst moat estimate intentionally excluded",
    detail:
      "The prototype's 14-dimension moat library is useful as a research worksheet, but it is analyst-authored. Until each moat claim is tied to stored evidence, it is shown as unverified and never affects ranking or valuation.",
    provenance: [],
  };
}

function evidenceLens(xray: CompanyXray): OracleLensItem {
  const status = xray.completeness.status;
  return {
    id: "EVIDENCE",
    label: "Evidence integrity",
    tone:
      status === "COMPLETE"
        ? "POSITIVE"
        : status === "KNOWN_INCOMPLETE" || status === "LAST_RUN_FAILED"
          ? "CAUTION"
          : "NEUTRAL",
    headline: `Market OS completeness: ${status}`,
    detail: xray.completeness.detail,
    provenance: [],
  };
}

export function computeBuffettOracleProfile(xray: CompanyXray): OracleProfile {
  const profitability = computeProfitability(xray.latestFigures);
  const lenses = [
    earningsLens(xray),
    revenueLens(xray),
    marginLens(profitability),
    balanceLens(xray),
    moatLens(),
    evidenceLens(xray),
  ];

  const unsafe =
    xray.completeness.status === "KNOWN_INCOMPLETE" ||
    xray.completeness.status === "LAST_RUN_FAILED";
  const gaps = lenses.some((l) => l.tone === "UNVERIFIABLE");

  return {
    readiness: unsafe ? "DATA_UNSAFE" : gaps ? "EVIDENCE_GAPS" : "RESEARCH_READY",
    readinessReason: unsafe
      ? "Known data completeness risk blocks a confident research profile."
      : gaps
        ? "The profile is usable, but at least one research lens remains explicitly unverifiable."
        : "Every implemented evidence lens has source-backed inputs. This is still research, not a recommendation.",
    lenses,
    profitability,
    limitations: [
      "No buy/sell/hold recommendation and no target price.",
      "No hard-coded Buffett/Munger quote or moat score is treated as a fact.",
      "No live provider call is made by this module; it consumes already-stored Market OS evidence.",
      "Price-timing/Bottom logic remains disabled until Market OS has a verified security-price authority for the selected company.",
    ],
  };
}
