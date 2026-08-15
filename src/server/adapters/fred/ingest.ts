import { prisma } from "@/server/db/client";
import { fetchFredObservations } from "./client";
import { normalizeFredObservations } from "./normalize";
import type { FredSeriesDefinition } from "./types";

export interface IngestResult {
  seriesId: string;
  inserted: number;
  revised: number;
  unchanged: number;
  skippedMissing: number;
}

/**
 * Fetches, normalizes, and persists one FRED series. Revisions are never silently overwritten:
 * a changed value for an already-stored observation date is inserted as a new row with
 * `isRevision: true` / `revisionOf` pointing at the prior row (docs/DATA_POLICY.md financial
 * data checklist: "revised vs preliminary/final"). Missing (".") values are never persisted as
 * 0 or dropped silently — they are counted and returned for visibility.
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

  const raw = await fetchFredObservations(def.seriesId);
  const { observations, skippedMissing } = normalizeFredObservations(raw);

  let inserted = 0;
  let revised = 0;
  let unchanged = 0;

  for (const obs of observations) {
    const existing = await prisma.observation.findFirst({
      where: { seriesId: series.id, observationDate: obs.observationDate },
      orderBy: { retrievedAt: "desc" },
    });

    if (!existing) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: obs.observationDate,
          value: obs.value,
          raw: obs.raw,
        },
      });
      inserted++;
      continue;
    }

    if (Number(existing.value.toString()) === Number(obs.value)) {
      unchanged++;
      continue;
    }

    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: obs.observationDate,
        value: obs.value,
        isRevision: true,
        revisionOf: existing.id,
        raw: obs.raw,
      },
    });
    revised++;
  }

  return {
    seriesId: def.seriesId,
    inserted,
    revised,
    unchanged,
    skippedMissing: skippedMissing.length,
  };
}
