import { prisma } from "@/server/db/client";
import { round } from "./seriesReadings";

/**
 * Real Estate Intelligence analysis (docs/PRODUCT_SPEC.md). No ingestion adapter exists yet
 * (docs/DECISIONS.md — data.go.kr is egress-blocked in this dev environment); this module
 * operates on whatever RealEstateTransaction rows exist. Uses MEDIAN price-per-area across a
 * window of transactions, not a two-point delta like whatChanged.ts: individual real-estate
 * transactions have high per-unit variance (a single unusual sale), so a median over a window
 * is a more honest summary than comparing two arbitrary points.
 */

export type PriceChangeStatus = "COMPUTED" | "INSUFFICIENT_DATA";

export interface RegionalPriceChangeResult {
  status: PriceChangeStatus;
  region: string;
  dealType: string;
  currentWindow?: { medianPricePerSqm: number; sampleSize: number; from: string; to: string };
  previousWindow?: { medianPricePerSqm: number; sampleSize: number; from: string; to: string };
  absoluteChange?: number;
  percentChange?: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Compares the median price-per-sqm of transactions in the most recent `windowDays` against
 * the `windowDays` immediately before that, for one region + deal type. Requires at least
 * `minSampleSize` transactions in EACH window — a median of 1-2 transactions is not a
 * meaningful market signal, so this returns INSUFFICIENT_DATA rather than a misleading number.
 */
export async function computeRegionalPriceChange(
  sourceId: string,
  region: string,
  dealType: "SALE" | "JEONSE" | "WOLSE",
  options: { asOf?: Date; windowDays?: number; minSampleSize?: number } = {},
): Promise<RegionalPriceChangeResult> {
  const asOf = options.asOf ?? new Date();
  const windowDays = options.windowDays ?? 30;
  const minSampleSize = options.minSampleSize ?? 3;
  const dayMs = 24 * 60 * 60 * 1000;

  const currentStart = new Date(asOf.getTime() - windowDays * dayMs);
  const previousStart = new Date(asOf.getTime() - 2 * windowDays * dayMs);

  const transactions = await prisma.realEstateTransaction.findMany({
    where: {
      sourceId,
      region,
      dealType,
      dealDate: { gte: previousStart, lte: asOf },
    },
  });

  const current = transactions.filter((t) => t.dealDate >= currentStart && t.dealDate <= asOf);
  const previous = transactions.filter(
    (t) => t.dealDate >= previousStart && t.dealDate < currentStart,
  );

  const base = { region, dealType };

  if (current.length < minSampleSize || previous.length < minSampleSize) {
    return { ...base, status: "INSUFFICIENT_DATA" };
  }

  const pricePerSqm = (t: (typeof transactions)[number]) =>
    Number(t.price.toString()) / Number(t.areaSqm.toString());

  const currentMedian = round(median(current.map(pricePerSqm)), 2);
  const previousMedian = round(median(previous.map(pricePerSqm)), 2);
  const absoluteChange = round(currentMedian - previousMedian, 2);
  const percentChange =
    previousMedian === 0 ? null : round((absoluteChange / previousMedian) * 100, 4);

  return {
    ...base,
    status: "COMPUTED",
    currentWindow: {
      medianPricePerSqm: currentMedian,
      sampleSize: current.length,
      from: currentStart.toISOString().slice(0, 10),
      to: asOf.toISOString().slice(0, 10),
    },
    previousWindow: {
      medianPricePerSqm: previousMedian,
      sampleSize: previous.length,
      from: previousStart.toISOString().slice(0, 10),
      to: currentStart.toISOString().slice(0, 10),
    },
    absoluteChange,
    percentChange,
  };
}
