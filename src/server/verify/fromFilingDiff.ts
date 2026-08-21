import type { FilingDiffResult } from "@/server/domain/filingDiff";
import type { CalculationInput, VerificationInput } from "./types";

/**
 * Adapter: a real Filing Diff result → a `VerificationInput`.
 *
 * This is what moves Verify from "passes its own fixtures" to "runs against live v1 output". The
 * evaluators were written against reconstructed historical defects; until something feeds them
 * what the product actually produces, they are proven only against cases I chose myself.
 *
 * Read-only and inert. Nothing in v1 imports this — `scripts/verify-shadow.ts` runs it over the
 * real database and reports verdicts without changing a single rendered page.
 *
 * The conversion is deliberately dumb. Judgement applied HERE is judgement the evaluators never
 * see, which would quietly relocate the verification into the adapter and leave Verify grading a
 * pre-cleaned view of reality.
 */
export function verificationInputFromFilingDiff(
  diff: FilingDiffResult,
  context: {
    /** Provider-stated total vs stored, from the ingest run behind this data. */
    completeness?: { providerTotal: number | null; fetched: number | null; truncated: boolean };
  } = {},
): VerificationInput | null {
  // INSUFFICIENT_DATA is Filing Diff correctly declining to compare. There is no claim to verify,
  // and manufacturing one would invent a subject.
  if (diff.status !== "COMPUTED") return null;
  if (
    diff.currentValue === undefined ||
    diff.previousValue === undefined ||
    diff.absoluteChange === undefined ||
    diff.currentPeriodEnd === undefined ||
    diff.previousPeriodEnd === undefined
  ) {
    return null;
  }

  const side = (
    value: number,
    periodEnd: string,
    periodDays: number | null | undefined,
    accessionNumber: string | undefined,
  ): CalculationInput => ({
    label: diff.concept,
    value,
    unit: diff.unit,
    sourceCode: diff.sourceCode ?? "",
    entityRef: diff.corpCode,
    concept: diff.concept,
    period: {
      // Filing Diff reports the period END plus its span in days and months, never the start.
      // Deriving a start from those would be arithmetic the source did not perform, so it stays
      // null rather than becoming a number that reads as reported.
      start: null,
      end: periodEnd,
      months: diff.periodMonths ?? null,
      days: periodDays ?? null,
    },
    accessionNumber,
    // `computeFinancialFactDiff` sorts every held fact through the shared `compareFactCurrency`
    // and takes the top-ranked row for each period, so both sides here ARE the most current
    // version held. Stated explicitly rather than inferred downstream, because the ranking
    // happens in v1 and Verify cannot see it.
    isMostCurrentHeldVersion: true,
  });

  return {
    outputId: `filingDiff:${diff.sourceCode ?? "UNKNOWN_SOURCE"}:${diff.corpCode}:${diff.concept}:${diff.unit}`,
    claimType: "CALCULATION",
    sourceCodes: diff.sourceCode ? [diff.sourceCode] : [],
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE",
      current: side(
        diff.currentValue,
        diff.currentPeriodEnd,
        diff.currentPeriodDays,
        diff.currentAccession,
      ),
      previous: side(
        diff.previousValue,
        diff.previousPeriodEnd,
        diff.previousPeriodDays,
        diff.previousAccession,
      ),
      claimedAbsoluteChange: diff.absoluteChange,
      claimedPercentChange: diff.percentChange ?? null,
    },
    completeness: context.completeness,
  };
}
