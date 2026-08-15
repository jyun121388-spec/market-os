import { prisma } from "@/server/db/client";
import { createClaim } from "./claimStore";
import { computeChange, getRecentObservationPair } from "./seriesReadings";

export type ChangeStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface ChangeResult {
  status: ChangeStatus;
  claimId?: string;
  absoluteChange?: number;
  percentChange?: number | null; // null when previous value is 0 (percent change undefined)
  bpsChange?: number | null; // only set when the series unit is "percent"
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
  const { current, previous } = pair;

  const { absoluteChange, percentChange, bpsChange } = computeChange(pair, series.unit);

  const currentValue = Number(current.value.toString());
  const previousValue = Number(previous.value.toString());
  const currentDateStr = current.observationDate.toISOString().slice(0, 10);
  const previousDateStr = previous.observationDate.toISOString().slice(0, 10);
  const sign = absoluteChange >= 0 ? "+" : "";

  const claimText =
    `${series.name} changed ${sign}${absoluteChange} ${series.unit} from ${previousDateStr} ` +
    `(${previousValue}) to ${currentDateStr} (${currentValue})` +
    (percentChange !== null ? ` — ${sign}${percentChange}%` : "") +
    (bpsChange !== null ? ` (${sign}${bpsChange} bps)` : "");

  const claim = await createClaim({
    claimText,
    claimType: "CALCULATION",
    sourceId: series.sourceId,
    evidence: {
      seriesId: series.id,
      currentObservationId: current.id,
      previousObservationId: previous.id,
      absoluteChange,
      percentChange,
      bpsChange,
    },
  });

  return { status: "COMPUTED", claimId: claim.id, absoluteChange, percentChange, bpsChange };
}
