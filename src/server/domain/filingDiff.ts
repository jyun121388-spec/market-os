import { prisma } from "@/server/db/client";
import { round } from "./seriesReadings";

/**
 * Filing Diff (docs/PRODUCT_SPEC.md "Filing Diff") — numeric-delta half only. See
 * docs/DECISIONS.md for scope: text-diff (new/removed risk factors, management-language
 * changes) requires filing document text, which no adapter fetches yet, and is explicitly
 * BLOCKED/future work — not attempted here.
 *
 * Compares the two most recent FinancialFact rows for one (corpCode, concept, unit) — i.e.
 * across two different filings' accession numbers — the same deterministic-change pattern as
 * src/server/domain/seriesReadings.ts (M10/M11), applied to filing-derived facts instead of
 * time-series observations.
 */

export type FilingDiffStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface FilingDiffResult {
  status: FilingDiffStatus;
  corpCode: string;
  concept: string;
  unit: string;
  currentAccession?: string;
  previousAccession?: string;
  currentValue?: number;
  previousValue?: number;
  absoluteChange?: number;
  percentChange?: number | null;
}

export async function computeFinancialFactDiff(
  sourceId: string,
  corpCode: string,
  concept: string,
  unit: string,
): Promise<FilingDiffResult> {
  const facts = await prisma.financialFact.findMany({
    where: { sourceId, corpCode, concept, unit },
    orderBy: [{ periodEnd: "desc" }, { filedDate: "desc" }],
    take: 2,
  });

  const base = { corpCode, concept, unit };

  if (facts.length < 2) {
    return { ...base, status: "INSUFFICIENT_DATA" };
  }

  const [current, previous] = facts;
  const currentValue = Number(current.value.toString());
  const previousValue = Number(previous.value.toString());
  const absoluteChange = round(currentValue - previousValue, 4);
  const percentChange =
    previousValue === 0 ? null : round((absoluteChange / previousValue) * 100, 4);

  return {
    ...base,
    status: "COMPUTED",
    currentAccession: current.accessionNumber,
    previousAccession: previous.accessionNumber,
    currentValue,
    previousValue,
    absoluteChange,
    percentChange,
  };
}

/** Computes the diff for every concept tracked for one company, in one call. */
export async function computeFilingDiff(
  sourceId: string,
  corpCode: string,
  concepts: { concept: string; unit: string }[],
): Promise<FilingDiffResult[]> {
  return Promise.all(
    concepts.map((c) => computeFinancialFactDiff(sourceId, corpCode, c.concept, c.unit)),
  );
}
