import { prisma } from "@/server/db/client";
import { upsertRevisionAwareObservation } from "@/server/domain/observationIngest";
import { fetchAllFredObservations } from "./client";
import { normalizeFredObservations } from "./normalize";
import type { FredSeriesDefinition } from "./types";

export interface IngestResult {
  seriesId: string;
  inserted: number;
  revised: number;
  unchanged: number;
  skippedMissing: number;
  /** FRED's own observation count for the query — compare against what was processed. */
  count: number;
  requestsMade: number;
  /** True when FRED reported more observations than this run was willing to fetch. */
  truncated: boolean;
}

/**
 * Fetches, normalizes, and persists one FRED series. See
 * src/server/domain/observationIngest.ts for the revision/missing-value invariants this
 * maintains.
 */
export async function ingestFredSeries(def: FredSeriesDefinition): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "FRED" },
    update: {},
    create: { code: "FRED", name: "Federal Reserve Economic Data", tier: "TIER_S" },
  });

  const series = await prisma.series.upsert({
    where: { sourceId_externalId: { sourceId: source.id, externalId: def.seriesId } },
    update: { name: def.name, unit: def.unit, frequency: def.frequency },
    create: {
      sourceId: source.id,
      externalId: def.seriesId,
      name: def.name,
      unit: def.unit,
      frequency: def.frequency,
    },
  });

  const page = await fetchAllFredObservations(def.seriesId);
  const { observations, skippedMissing } = normalizeFredObservations({
    observation_start: page.observationStart,
    observation_end: page.observationEnd,
    units: page.units,
    count: page.count,
    observations: page.observations,
  });

  const counts = { inserted: 0, revised: 0, unchanged: 0 };
  for (const obs of observations) {
    const status = await upsertRevisionAwareObservation({
      seriesId: series.id,
      sourceId: source.id,
      observationDate: obs.observationDate,
      value: obs.value,
      raw: obs.raw,
    });
    counts[status]++;
  }

  if (page.truncated) {
    console.warn(
      `[FRED] ${def.seriesId}: FRED reported ${page.count} observations but this run fetched ` +
        `${page.observations.length}. The series is knowably incomplete — narrow the range.`,
    );
  }

  return {
    seriesId: def.seriesId,
    ...counts,
    skippedMissing: skippedMissing.length,
    count: page.count,
    requestsMade: page.requestsMade,
    truncated: page.truncated,
  };
}
