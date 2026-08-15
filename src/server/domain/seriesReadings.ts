import { prisma } from "@/server/db/client";
import type { Observation } from "@/generated/prisma/client";

export interface ObservationPair {
  current: Observation;
  previous: Observation;
}

/**
 * Shared read logic for "the two most recent distinct observation dates for a series,
 * respecting revisions" — used by both whatChanged.ts (M10) and macroRegime.ts (M11), which
 * both need this exact query. Revisions are respected via the retrievedAt-desc tiebreak: the
 * most recently retrieved value for a date wins, not the first one ever ingested.
 */
export async function getRecentObservationPair(seriesId: string): Promise<ObservationPair | null> {
  const recent = await prisma.observation.findMany({
    where: { seriesId },
    orderBy: [{ observationDate: "desc" }, { retrievedAt: "desc" }],
    distinct: ["observationDate"],
    take: 2,
  });

  if (recent.length < 2) {
    return null;
  }

  return { current: recent[0], previous: recent[1] };
}

export interface DeterministicChange {
  absoluteChange: number;
  percentChange: number | null; // null when previous value is 0 (percent change undefined)
  bpsChange: number | null; // only meaningful when unit === "percent"
}

/** Pure, deterministic change calculation — no DB access, no LLM. */
export function computeChange(pair: ObservationPair, unit: string): DeterministicChange {
  const currentValue = Number(pair.current.value.toString());
  const previousValue = Number(pair.previous.value.toString());

  const absoluteChange = round(currentValue - previousValue, 6);
  const percentChange =
    previousValue === 0 ? null : round((absoluteChange / previousValue) * 100, 4);
  const bpsChange = unit === "percent" ? round(absoluteChange * 100, 2) : null;

  return { absoluteChange, percentChange, bpsChange };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
