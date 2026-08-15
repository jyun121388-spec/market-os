import { prisma } from "@/server/db/client";
import { round } from "./seriesReadings";

/**
 * ETF exposure aggregation (docs/PRODUCT_SPEC.md "ETF X-Ray"). Purely deterministic
 * fact-aggregation from stored holdings — sums each holding's weight into its sector/country
 * bucket. Never produces a recommendation, suitability, or "fitness" score
 * (docs/LEGAL_GUARDRAILS.md hard prohibition) — this module only groups and sums numbers
 * already present in EtfHolding rows.
 */

export interface ExposureBucket {
  key: string; // sector or country name, or "Unclassified" if the holding has none recorded
  totalWeightPct: number;
  holdingCount: number;
}

async function aggregateBy(etfId: string, field: "sector" | "country"): Promise<ExposureBucket[]> {
  const holdings = await prisma.etfHolding.findMany({ where: { etfId } });

  const buckets = new Map<string, { total: number; count: number }>();
  for (const holding of holdings) {
    const key = holding[field] ?? "Unclassified";
    const existing = buckets.get(key) ?? { total: 0, count: 0 };
    existing.total += Number(holding.weightPct.toString());
    existing.count += 1;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([key, { total, count }]) => ({
      key,
      totalWeightPct: round(total, 4),
      holdingCount: count,
    }))
    .sort((a, b) => b.totalWeightPct - a.totalWeightPct);
}

export async function computeSectorExposure(etfId: string): Promise<ExposureBucket[]> {
  return aggregateBy(etfId, "sector");
}

export async function computeCountryExposure(etfId: string): Promise<ExposureBucket[]> {
  return aggregateBy(etfId, "country");
}
