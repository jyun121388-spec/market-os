import { prisma } from "@/server/db/client";
import { TtlCache, withCache } from "@/server/domain/cache";

/**
 * Admin / Monitoring (docs/ROADMAP.md M24) — internal data-pipeline health, built entirely
 * from data already in the DB. No external monitoring service (error tracking, uptime, APM) is
 * integrated: those are typically paid and would be a Human Gate (docs/DATA_POLICY.md cost
 * policy) — this is scoped to what's honestly buildable without one. See docs/DECISIONS.md.
 *
 * computeSystemHealth() is cached (M25) with a short TTL: it's rendered on every /admin page
 * load, and "last ingest was a few seconds ago vs. right now" is not a meaningful distinction
 * for an operator, so re-querying every source's aggregate on every request is wasted work.
 */

export interface SourceHealth {
  sourceCode: string;
  sourceName: string;
  tier: string;
  lastIngestAt: string | null; // ISO timestamp, or null if this source has never ingested anything
}

/**
 * The most recent recorded run per (source, target), so an operator can answer the question
 * that actually matters: is the stored data complete?
 *
 * Every adapter returns a `truncated` flag now, because each was at some point silently storing
 * a partial result. A flag nothing surfaces is barely better than no flag — so it ends up here.
 */
export interface IngestRunHealth {
  sourceCode: string;
  target: string;
  status: string;
  finishedAt: string | null;
  inserted: number;
  unchanged: number;
  skipped: number;
  fetched: number | null;
  /** What the provider said exists. A gap against `fetched` is the signal. */
  providerTotal: number | null;
  truncated: boolean;
  error: string | null;
}

export interface SystemHealth {
  sources: SourceHealth[];
  unresolvedDataConflicts: number;
  recentRuns: IngestRunHealth[];
  /** Runs that ended knowably incomplete or failed outright — the ones worth acting on. */
  incompleteRuns: number;
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

const SYSTEM_HEALTH_TTL_MS = 30_000;
const systemHealthCache = new TtlCache<SystemHealth>(SYSTEM_HEALTH_TTL_MS);

/** How many recent runs to show. Enough to spot a pattern, few enough to stay readable. */
const RECENT_RUN_LIMIT = 25;

async function computeSystemHealthUncached(): Promise<SystemHealth> {
  const [sources, unresolvedDataConflicts, runs] = await Promise.all([
    // ORDERING_WAIVER: Source.code is unique at the database level, so this ordering is already total.
    prisma.source.findMany({ orderBy: { code: "asc" } }),
    prisma.dataConflict.count({ where: { resolved: false } }),
    prisma.ingestRun.findMany({
      // ORDERING_WAIVER: the recent-runs panel. Two runs starting in the same millisecond may appear in either order; nothing downstream reads the first element as an answer.
      orderBy: { startedAt: "desc" },
      take: RECENT_RUN_LIMIT,
      include: { source: { select: { code: true } } },
    }),
  ]);

  const sourceHealth = await Promise.all(
    sources.map(async (source) => ({
      sourceCode: source.code,
      sourceName: source.name,
      tier: source.tier,
      lastIngestAt: (await lastIngestForSource(source.id))?.toISOString() ?? null,
    })),
  );

  // Only the newest run per (source, target) — older ones are history, not current state.
  const seen = new Set<string>();
  const recentRuns: IngestRunHealth[] = [];
  for (const run of runs) {
    const key = `${run.source.code}::${run.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentRuns.push({
      sourceCode: run.source.code,
      target: run.target,
      status: run.status,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      inserted: run.inserted,
      unchanged: run.unchanged,
      skipped: run.skipped,
      fetched: run.fetched,
      providerTotal: run.providerTotal,
      truncated: run.truncated,
      error: run.error,
    });
  }

  return {
    sources: sourceHealth,
    unresolvedDataConflicts,
    recentRuns,
    incompleteRuns: recentRuns.filter((r) => r.truncated || r.status === "FAILED").length,
  };
}

export async function computeSystemHealth(): Promise<SystemHealth> {
  return withCache(systemHealthCache, "system-health", computeSystemHealthUncached);
}

/** Test-only escape hatch — bypasses the TTL cache so tests can assert on fresh DB state. */
export function clearSystemHealthCache(): void {
  systemHealthCache.clear();
}
