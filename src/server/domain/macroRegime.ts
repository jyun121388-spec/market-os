import { prisma } from "@/server/db/client";
import {
  computeChange,
  getRecentObservationPair,
  type DeterministicChange,
} from "./seriesReadings";

/**
 * Macro Regime Engine (docs/PRODUCT_SPEC.md "Macro Regime Engine"). Reports the latest
 * deterministic reading + change for every series mapped to each axis — it does NOT compute a
 * single fabricated "regime score" per axis, since no documented, defensible methodology for
 * combining heterogeneous series (a policy rate, a volatility index, a commodity price) into
 * one number exists yet. See docs/ARCHITECTURE.md: "LLM does not invent scores" — the same
 * principle applies to deterministic code inventing an unjustified composite index. Downstream
 * presentation (a future milestone) can decide how to summarize these readings for a user;
 * this layer only guarantees every number shown is traceable to a real Observation.
 */
export type AxisName =
  "GROWTH" | "INFLATION" | "LIQUIDITY" | "RISK" | "RATES" | "USD" | "CREDIT" | "COMMODITY";

interface AxisSeriesRef {
  sourceCode: string;
  externalId: string;
}

/**
 * Which tracked series feed each axis. A series missing here isn't a bug — it means no free
 * source for that axis has been wired yet (see docs/CURRENT_TASK.md's M11 note on axis
 * coverage). Extending this list is how future milestones add axis coverage.
 */
export const AXIS_SERIES: Record<AxisName, AxisSeriesRef[]> = {
  GROWTH: [
    { sourceCode: "FRED", externalId: "UNRATE" },
    { sourceCode: "FRED", externalId: "INDPRO" },
  ],
  INFLATION: [{ sourceCode: "FRED", externalId: "CPIAUCSL" }],
  LIQUIDITY: [
    { sourceCode: "FRED", externalId: "M2SL" },
    { sourceCode: "FRED", externalId: "WALCL" },
  ],
  RISK: [{ sourceCode: "FRED", externalId: "VIXCLS" }],
  RATES: [
    { sourceCode: "FRED", externalId: "DGS10" },
    { sourceCode: "FRED", externalId: "DGS2" },
    { sourceCode: "ECOS", externalId: "722Y001:0101000" }, // BOK base rate — see ecos/ingest.ts
  ],
  USD: [{ sourceCode: "FRED", externalId: "DTWEXBGS" }],
  CREDIT: [{ sourceCode: "FRED", externalId: "BAA10Y" }],
  COMMODITY: [{ sourceCode: "FRED", externalId: "DCOILWTICO" }],
};

export type Direction = "UP" | "DOWN" | "FLAT";

export type SeriesReadingStatus = "COMPUTED" | "INSUFFICIENT_DATA" | "NOT_TRACKED";

export interface SeriesReading {
  sourceCode: string;
  externalId: string;
  status: SeriesReadingStatus;
  seriesName?: string;
  asOfDate?: string; // YYYY-MM-DD
  value?: number;
  change?: DeterministicChange;
  direction?: Direction;
}

export interface AxisSnapshot {
  axis: AxisName;
  status: "DATA_AVAILABLE" | "INSUFFICIENT_DATA";
  readings: SeriesReading[];
}

export interface RegimeSnapshot {
  axes: AxisSnapshot[];
}

const FLAT_EPSILON = 1e-9;

function directionOf(absoluteChange: number): Direction {
  if (Math.abs(absoluteChange) < FLAT_EPSILON) return "FLAT";
  return absoluteChange > 0 ? "UP" : "DOWN";
}

async function readSeries(ref: AxisSeriesRef): Promise<SeriesReading> {
  const series = await prisma.series.findFirst({
    where: { externalId: ref.externalId, source: { code: ref.sourceCode } },
  });

  if (!series) {
    return { ...ref, status: "NOT_TRACKED" };
  }

  const pair = await getRecentObservationPair(series.id);
  if (!pair) {
    return { ...ref, status: "INSUFFICIENT_DATA", seriesName: series.name };
  }

  const change = computeChange(pair, series.unit);
  return {
    ...ref,
    status: "COMPUTED",
    seriesName: series.name,
    asOfDate: pair.current.observationDate.toISOString().slice(0, 10),
    value: Number(pair.current.value.toString()),
    change,
    direction: directionOf(change.absoluteChange),
  };
}

/** Computes the current snapshot across every axis, purely by reading stored Observations. */
export async function computeRegimeSnapshot(): Promise<RegimeSnapshot> {
  const axes: AxisSnapshot[] = [];

  for (const axis of Object.keys(AXIS_SERIES) as AxisName[]) {
    const readings = await Promise.all(AXIS_SERIES[axis].map(readSeries));
    const status = readings.some((r) => r.status === "COMPUTED")
      ? "DATA_AVAILABLE"
      : "INSUFFICIENT_DATA";
    axes.push({ axis, status, readings });
  }

  return { axes };
}
