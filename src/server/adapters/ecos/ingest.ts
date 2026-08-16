import { prisma } from "@/server/db/client";
import { upsertRevisionAwareObservation } from "@/server/domain/observationIngest";
import { fetchAllEcosObservations } from "./client";
import { normalizeEcosObservations } from "./normalize";
import type { EcosSeriesDefinition } from "./types";

export interface IngestResult {
  seriesId: string;
  inserted: number;
  revised: number;
  unchanged: number;
  skippedMissing: number;
  /** ECOS's own row count for the range — compare against what was actually processed. */
  totalCount: number;
  requestsMade: number;
  /** True when ECOS reported more rows than this run was willing to fetch. */
  truncated: boolean;
}

function externalSeriesId(def: EcosSeriesDefinition): string {
  return `${def.statCode}:${def.itemCode1}`;
}

/**
 * Fetches, normalizes, and persists one ECOS series. See
 * src/server/domain/observationIngest.ts for the revision/missing-value invariants this
 * maintains.
 */
export async function ingestEcosSeries(
  def: EcosSeriesDefinition,
  range: { start: string; end: string },
): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "ECOS" },
    update: {},
    create: { code: "ECOS", name: "한국은행 경제통계시스템 (BOK ECOS)", tier: "TIER_S" },
  });

  const extId = externalSeriesId(def);
  const series = await prisma.series.upsert({
    where: { sourceId_externalId: { sourceId: source.id, externalId: extId } },
    update: { name: def.name, unit: def.unit, frequency: def.frequency },
    create: {
      sourceId: source.id,
      externalId: extId,
      name: def.name,
      unit: def.unit,
      frequency: def.frequency,
    },
  });

  const page = await fetchAllEcosObservations(def, range);
  const { observations, skippedMissing } = normalizeEcosObservations({
    StatisticSearch: { list_total_count: page.totalCount, row: page.rows },
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
      `[ECOS] ${extId}: ECOS reported ${page.totalCount} rows but this run fetched ` +
        `${page.rows.length}. The series is knowably incomplete — narrow the range and re-run.`,
    );
  }

  return {
    seriesId: extId,
    ...counts,
    skippedMissing: skippedMissing.length,
    totalCount: page.totalCount,
    requestsMade: page.requestsMade,
    truncated: page.truncated,
  };
}
