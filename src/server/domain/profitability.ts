import type { ReportedFigure } from "./companyXray";
import { REVENUE_CONCEPTS } from "./valuationScenario";

/**
 * Deterministic profitability ratios — `[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`,
 * the Company Intelligence half.
 *
 * "Deterministic ratios only where numerator and denominator are source-backed, same-period,
 * same-unit and mechanically identifiable from already tracked literal concepts. Start with the
 * narrowest honest set. No semantic synonym expansion by guesswork; otherwise UNVERIFIABLE."
 *
 * So: two ratios, built from four literal us-gaap tags this repository already ingests. Net margin
 * and operating margin, both over revenue. Nothing is inferred, no concept is approximated by a
 * near neighbour, and where the two sides cannot be shown to describe the same period in the same
 * unit the answer is a refusal rather than a plausible percentage.
 *
 * NOT ANNUAL-ONLY, and the difference from `valuationScenario` is deliberate rather than
 * inconsistent. A multiple is defined against a year, so applying one to a quarter is wrong by
 * roughly four; a margin is a ratio of two quantities over the SAME span, so it is exactly as
 * meaningful for a quarter as for a year — provided both sides really do cover that same span,
 * which is the whole of what this module checks.
 */

export const NET_INCOME_CONCEPT = "NetIncomeLoss";
export const OPERATING_INCOME_CONCEPT = "OperatingIncomeLoss";

export type RatioName = "NET_MARGIN" | "OPERATING_MARGIN";

export type RatioUnverifiableReason =
  | "NUMERATOR_MISSING"
  | "DENOMINATOR_MISSING"
  | "NO_SHARED_PERIOD"
  | "DENOMINATOR_NOT_POSITIVE"
  | "PROVENANCE_INCOMPLETE"
  | "DENOMINATOR_AMBIGUOUS";

export type RatioStatus = "COMPUTED" | "UNVERIFIABLE";

/** One side of a ratio, carrying the provenance that makes it checkable. */
export interface RatioTerm {
  concept: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  periodMonths: number | null;
  form: string;
  accessionNumber: string;
}

export interface ProfitabilityRatio {
  name: RatioName;
  status: RatioStatus;
  unverifiableBecause?: RatioUnverifiableReason;
  numerator?: RatioTerm;
  denominator?: RatioTerm;
  /** Percent, rounded to two places. Present only when status is COMPUTED. */
  percent?: number;
  limitations: string;
}

export const PROFITABILITY_LIMITATIONS =
  "A ratio of two figures the company reported for the same period, in the same unit, from the " +
  "filing named beside each. It is arithmetic over what was filed and nothing more — no " +
  "adjustment, no normalisation, and no comparison against anybody else.";

const term = (f: ReportedFigure): RatioTerm => ({
  concept: f.concept,
  value: f.value,
  unit: f.unit,
  periodStart: f.periodStart,
  periodEnd: f.periodEnd,
  periodMonths: f.periodMonths,
  form: f.form,
  accessionNumber: f.accessionNumber,
});

/** Same span, same unit. The identity a ratio's two sides must share to be a ratio at all. */
const sharesPeriod = (a: ReportedFigure, b: ReportedFigure): boolean =>
  a.periodStart === b.periodStart &&
  a.periodEnd === b.periodEnd &&
  a.periodMonths === b.periodMonths &&
  a.unit === b.unit;

const hasProvenance = (f: ReportedFigure): boolean =>
  f.accessionNumber.trim().length > 0 && f.form.trim().length > 0;

/** Newest period end first. Only ever used to prefer the most recent shared period. */
const byPeriodEndDesc = (a: ReportedFigure, b: ReportedFigure): number =>
  a.periodEnd === b.periodEnd ? 0 : a.periodEnd < b.periodEnd ? 1 : -1;

function ratio(
  name: RatioName,
  numeratorConcept: string,
  figures: ReportedFigure[],
): ProfitabilityRatio {
  const base = { name, limitations: PROFITABILITY_LIMITATIONS } as const;

  const numerators = figures.filter((f) => f.concept === numeratorConcept);
  if (numerators.length === 0) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "NUMERATOR_MISSING" };
  }
  const denominators = figures.filter((f) =>
    (REVENUE_CONCEPTS as readonly string[]).includes(f.concept),
  );
  if (denominators.length === 0) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "DENOMINATOR_MISSING" };
  }

  // The most recent period for which BOTH sides exist. Pairing anything else would be comparing
  // a quarter's profit against a year's revenue, which is the error `periodMonths` exists to make
  // visible — and it would produce a number that looks entirely reasonable.
  const pairs: { numerator: ReportedFigure; denominators: ReportedFigure[] }[] = [];
  for (const n of [...numerators].sort(byPeriodEndDesc)) {
    const matched = denominators.filter((d) => sharesPeriod(n, d));
    if (matched.length > 0) pairs.push({ numerator: n, denominators: matched });
  }
  if (pairs.length === 0) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "NO_SHARED_PERIOD" };
  }

  const { numerator, denominators: candidates } = pairs[0];

  if (!hasProvenance(numerator) || candidates.some((d) => !hasProvenance(d))) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "PROVENANCE_INCOMPLETE" };
  }

  // Two revenue TAGS covering the same period with different amounts. Choosing one would be a
  // guess about which basis the reader meant, and the guess would move the percentage by whatever
  // the two disagree by. Equal amounts are not ambiguous — the ratio is the same either way — so
  // only a real disagreement refuses. Same rule as the valuation surface, for the same reason.
  const distinct = new Set(candidates.map((d) => d.value));
  if (distinct.size > 1) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "DENOMINATOR_AMBIGUOUS" };
  }

  const denominator = candidates[0];
  if (!Number.isFinite(denominator.value) || denominator.value <= 0) {
    return {
      ...base,
      status: "UNVERIFIABLE",
      unverifiableBecause: "DENOMINATOR_NOT_POSITIVE",
      numerator: term(numerator),
      denominator: term(denominator),
    };
  }
  if (!Number.isFinite(numerator.value)) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: "NUMERATOR_MISSING" };
  }

  return {
    ...base,
    status: "COMPUTED",
    numerator: term(numerator),
    denominator: term(denominator),
    // A negative margin is a real, reportable fact about a loss-making period, not a refusal.
    percent: Math.round((numerator.value / denominator.value) * 10000) / 100,
  };
}

/**
 * Both ratios. Each stands alone: a company that reports net income but no operating income gets
 * one margin and one explicit refusal, which is more honest than withholding both.
 */
export function computeProfitability(figures: ReportedFigure[]): ProfitabilityRatio[] {
  return [
    ratio("NET_MARGIN", NET_INCOME_CONCEPT, figures),
    ratio("OPERATING_MARGIN", OPERATING_INCOME_CONCEPT, figures),
  ];
}
