import { prisma } from "@/server/db/client";
import { upsertRevisionAwareObservation } from "@/server/domain/observationIngest";
import { fetchEcosObservations } from "./client";
import { normalizeEcosObservations } from "./normalize";
import type { EcosSeriesDefinition, EcosStatisticSearchSuccess } from "./types";

export interface IngestResult {
  seriesId: string;
  inserted: number;
  revised: number;
  unchanged: number;
  skippedMissing: number;
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

  const raw = await fetchEcosObservations(def, range);
  const { observations, skippedMissing } = normalizeEcosObservations(
    raw as EcosStatisticSearchSuccess,
  );

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

  return { seriesId: extId, ...counts, skippedMissing: skippedMissing.length };
}
