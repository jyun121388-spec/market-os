import { prisma } from "@/server/db/client";
import { upsertRevisionAwareObservation } from "@/server/domain/observationIngest";
import { fetchAllFredObservations } from "./client";
import { normalizeFredObservations } from "./normalize";
import type { FredSeriesDefinition } from "./types";

/**
 * The documented sentinels that ask FRED for every vintage it holds rather than the current one.
 *
 * FRED's own documented bounds. Measured on 2026-09-06: CPIAUCSL from 2023-01-01 came back as 114
 * rows over 43 observation dates, 35 of them with several vintages, ordered and non-overlapping
 * within a date and the latest open-ended at 9999-12-31.
 */
export const FRED_ALL_VINTAGES = {
  realtimeStart: "1776-07-04",
  realtimeEnd: "9999-12-31",
} as const;

export interface IngestOptions {
  /**
   * Ask for every vintage instead of the current value.
   *
   * Off by default, so the ordinary ingest is byte-for-byte the run it has always been. On, the
   * provider's own `realtime_start` is stored as each row's `releaseDate` — the evidence the
   * provider-vintage contract was written for and has never had. It is STORED and not yet ORDERED
   * on: the rollback guard in `observationIngest.ts` is untouched, because using a release date to
   * decide which of two readings is newer changes V1 revision semantics and is a separate decision.
   */
  allVintages?: boolean;
  /** Narrows the observation window. Unrelated to the vintage range above. */
  observationStart?: string;
}

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
export async function ingestFredSeries(
  def: FredSeriesDefinition,
  options: IngestOptions = {},
): Promise<IngestResult> {
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

  const page = await fetchAllFredObservations(def.seriesId, {
    ...(options.observationStart ? { observationStart: options.observationStart } : {}),
    ...(options.allVintages ? FRED_ALL_VINTAGES : {}),
  });
  const { observations, skippedMissing } = normalizeFredObservations(
    {
      observation_start: page.observationStart,
      observation_end: page.observationEnd,
      units: page.units,
      count: page.count,
      observations: page.observations,
    },
    // Only the caller that asked for the range may say `realtime_start` is a vintage boundary.
    { vintageAware: options.allVintages === true },
  );

  // `stale_ignored` is counted, not dropped. It means the provider replayed a figure this
  // chain already superseded and the rollback guard refused to apply it — a fact an operator
  // needs, and a silent zero would be the "silence where there should be a signal" pattern
  // that produced most of this project's real defects.
  const counts = { inserted: 0, revised: 0, unchanged: 0, stale_ignored: 0 };
  for (const obs of observations) {
    const status = await upsertRevisionAwareObservation({
      seriesId: series.id,
      sourceId: source.id,
      observationDate: obs.observationDate,
      releaseDate: obs.releaseDate,
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
