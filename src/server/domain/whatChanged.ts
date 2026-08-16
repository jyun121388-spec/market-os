import { prisma } from "@/server/db/client";
import { createClaim } from "./claimStore";
import {
  computeChange,
  getRecentObservationPair,
  type DeterministicChange,
  type ObservationPair,
} from "./seriesReadings";

export type ChangeStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface ChangeResult {
  status: ChangeStatus;
  claimId?: string;
  absoluteChange?: number;
  percentChange?: number | null; // null when previous value is 0 (percent change undefined)
  bpsChange?: number | null; // only set when the series unit is "percent"
}

/**
 * Deterministically builds the exact CALCULATION claim text for a series/unit + observation
 * pair + recomputed change. Exported so `claimVerification.ts` can reconstruct the same text
 * from independently re-fetched observations and an independently recomputed change, then
 * compare by exact equality — see docs/DECISIONS.md's H2 entry. Any drift between this template
 * and the one used at claim-creation time would make every CALCULATION claim unverifiable.
 */
export function buildChangeClaimText(
  seriesName: string,
  unit: string,
  pair: ObservationPair,
  change: DeterministicChange,
): string {
  const currentValue = Number(pair.current.value.toString());
  const previousValue = Number(pair.previous.value.toString());
  const currentDateStr = pair.current.observationDate.toISOString().slice(0, 10);
  const previousDateStr = pair.previous.observationDate.toISOString().slice(0, 10);
  const sign = change.absoluteChange >= 0 ? "+" : "";

  return (
    `${seriesName} changed ${sign}${change.absoluteChange} ${unit} from ${previousDateStr} ` +
    `(${previousValue}) to ${currentDateStr} (${currentValue})` +
    (change.percentChange !== null ? ` — ${sign}${change.percentChange}%` : "") +
    (change.bpsChange !== null ? ` (${sign}${change.bpsChange} bps)` : "")
  );
}

/**
 * Deterministically computes the change between a series' two most recent distinct
 * observation dates (never an LLM judgment call — docs/AI_RESOURCE_POLICY.md), and persists
 * the result as a CALCULATION claim via src/server/domain/claimStore.ts so it carries the same
 * provenance guarantees as a FACT claim. See seriesReadings.ts for the shared revision-aware
 * read logic and pure change calculation.
 */
export async function computeSeriesChange(seriesId: string): Promise<ChangeResult> {
  const series = await prisma.series.findUniqueOrThrow({ where: { id: seriesId } });

  const pair = await getRecentObservationPair(seriesId);
  if (!pair) {
    return { status: "INSUFFICIENT_DATA" };
  }

  const change = computeChange(pair, series.unit);
  const claimText = buildChangeClaimText(series.name, series.unit, pair, change);

  const claim = await createClaim({
    claimText,
    claimType: "CALCULATION",
    sourceId: series.sourceId,
    evidence: {
      seriesId: series.id,
      currentObservationId: pair.current.id,
      previousObservationId: pair.previous.id,
      absoluteChange: change.absoluteChange,
      percentChange: change.percentChange,
      bpsChange: change.bpsChange,
    },
  });

  return {
    status: "COMPUTED",
    claimId: claim.id,
    absoluteChange: change.absoluteChange,
    percentChange: change.percentChange,
    bpsChange: change.bpsChange,
  };
}
