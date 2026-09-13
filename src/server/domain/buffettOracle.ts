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

type Change = CompanyXray["changes"][number];
type ChangeSelection =
  | { status: "NONE" }
  | { status: "AMBIGUOUS" }
  | { status: "OK"; change: Change; provenance: string[] };

function pct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v)
    ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
    : "N/A";
}

/**
 * Select the newest mechanically comparable change without silently choosing between competing
 * fact identities.
 *
 * FilingDiff works one literal concept/unit at a time. That is the right primitive, but an Oracle
 * lens spans a small concept family (notably the US-GAAP revenue tags). More than one member of the
 * family can therefore survive for the same newest period. Picking whichever happened to sort
 * first would create a second semantic authority above FilingDiff. We accept duplicates only when
 * every numeric/comparison identity agrees; otherwise the lens refuses as AMBIGUOUS.
 */
function latestComputedChange(xray: CompanyXray, concepts: readonly string[]): ChangeSelection {
  const candidates = xray.changes.filter(
    (c) =>
      c.status === "COMPUTED" &&
      concepts.includes(c.concept) &&
      typeof c.percentChange === "number" &&
      Number.isFinite(c.percentChange),
  );
  if (candidates.length === 0) return { status: "NONE" };

  const newestEnd = candidates
    .map((c) => String(c.currentPeriodEnd ?? ""))
    .sort()
    .at(-1)!;
  const latest = candidates.filter((c) => String(c.currentPeriodEnd ?? "") === newestEnd);

  const signatures = new Set(
    latest.map((c) =>
      [
        c.unit,
        c.previousPeriodEnd ?? "",
        c.currentPeriodEnd ?? "",
        c.periodMonths ?? "instant",
        c.previousValue ?? "",
        c.currentValue ?? "",
        c.percentChange ?? "",
      ].join("|"),
    ),
  );
  if (signatures.size !== 1) return { status: "AMBIGUOUS" };

  return {
    status: "OK",
    change: latest[0],
    provenance: [
      ...new Set(
        latest
          .flatMap((c) => [c.currentAccession, c.previousAccession])
          .filter(Boolean) as string[],
      ),
    ],
  };
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
  const selected = latestComputedChange(xray, ["NetIncomeLoss", "ProfitLoss"]);
  if (selected.status === "AMBIGUOUS") {
    return {
      id: "EARNINGS",
      label: "Earnings durability",
      tone: "UNVERIFIABLE",
      headline: "Latest earnings evidence is ambiguous",
      detail:
        "More than one eligible earnings identity reaches the newest period and they do not agree. Oracle refuses to choose one.",
      provenance: [],
    };
  }
  if (selected.status === "NONE") {
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

  const { change, provenance } = selected;
  const positive = change.percentChange! >= 0;
  return {
    id: "EARNINGS",
    label: "Earnings durability",
    tone: positive ? "POSITIVE" : "CAUTION",
    headline: `${pct(change.percentChange)} comparable-period earnings change`,
    detail: `Compared ${change.previousPeriodEnd ?? "prior"} with ${change.currentPeriodEnd ?? "current"}. This is a reported-fact delta, not a forecast.`,
    provenance,
  };
}

function revenueLens(xray: CompanyXray): OracleLensItem {
  const selected = latestComputedChange(xray, REVENUE_CONCEPTS);
  if (selected.status === "AMBIGUOUS") {
    return {
      id: "REVENUE",
      label: "Revenue durability",
      tone: "UNVERIFIABLE",
      headline: "Latest revenue evidence is ambiguous",
      detail:
        "Multiple tracked revenue identities reach the newest period but disagree on the comparison. Oracle refuses to pick a preferred tag or unit.",
      provenance: [],
    };
  }
  if (selected.status === "NONE") {
    return {
      id: "REVENUE",
      label: "Revenue durability",
      tone: "UNVERIFIABLE",
      headline: "Comparable revenue trend unavailable",
      detail: "No same-duration, source-backed revenue pair is currently available.",
      provenance: [],
    };
  }

  const { change, provenance } = selected;
  return {
    id: "REVENUE",
    label: "Revenue durability",
    tone: change.percentChange! >= 0 ? "POSITIVE" : "CAUTION",
    headline: `${pct(change.percentChange)} comparable-period revenue change`,
    detail: `Literal concept ${change.concept}. Market OS refuses period-mismatched or identity-ambiguous comparisons instead of fabricating growth.`,
    provenance,
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
