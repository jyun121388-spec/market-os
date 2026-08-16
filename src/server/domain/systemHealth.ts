import { prisma } from "@/server/db/client";

/**
 * Admin / Monitoring (docs/ROADMAP.md M24) — internal data-pipeline health, built entirely
 * from data already in the DB. No external monitoring service (error tracking, uptime, APM) is
 * integrated: those are typically paid and would be a Human Gate (docs/DATA_POLICY.md cost
 * policy) — this is scoped to what's honestly buildable without one. See docs/DECISIONS.md.
 */

export interface SourceHealth {
  sourceCode: string;
  sourceName: string;
  tier: string;
  lastIngestAt: string | null; // ISO timestamp, or null if this source has never ingested anything
}

export interface SystemHealth {
  sources: SourceHealth[];
  unresolvedDataConflicts: number;
}

async function lastIngestForSource(sourceId: string): Promise<Date | null> {
  const [obs, filing, fact, etf, mention] = await Promise.all([
    prisma.observation.aggregate({ where: { sourceId }, _max: { retrievedAt: true } }),
    prisma.filing.aggregate({ where: { sourceId }, _max: { retrievedAt: true } }),
    prisma.financialFact.aggregate({ where: { sourceId }, _max: { retrievedAt: true } }),
    prisma.etf.aggregate({ where: { sourceId }, _max: { retrievedAt: true } }),
    prisma.eventMention.aggregate({ where: { sourceId }, _max: { retrievedAt: true } }),
  ]);

  const candidates = [
    obs._max.retrievedAt,
    filing._max.retrievedAt,
    fact._max.retrievedAt,
    etf._max.retrievedAt,
    mention._max.retrievedAt,
  ].filter((d): d is Date => d !== null);

  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

export async function computeSystemHealth(): Promise<SystemHealth> {
  const [sources, unresolvedDataConflicts] = await Promise.all([
    prisma.source.findMany({ orderBy: { code: "asc" } }),
    prisma.dataConflict.count({ where: { resolved: false } }),
  ]);

  const sourceHealth = await Promise.all(
    sources.map(async (source) => ({
      sourceCode: source.code,
      sourceName: source.name,
      tier: source.tier,
      lastIngestAt: (await lastIngestForSource(source.id))?.toISOString() ?? null,
    })),
  );

  return { sources: sourceHealth, unresolvedDataConflicts };
}
