import { prisma } from "@/server/db/client";
import { computeChange, getRecentObservationPair } from "./seriesReadings";
import { computeRegimeSnapshot, type RegimeSnapshot } from "./macroRegime";
import { computeCalendar, type CalendarEntry } from "./economicCalendar";
import { evaluateStaleness, type StalenessStatus } from "./staleness";

/**
 * Today / Morning Intelligence (docs/PRODUCT_SPEC.md). Composes existing domain modules into
 * one view — this module does not ingest new data, and it deliberately never persists a new
 * Claim on every call (see docs/DECISIONS.md M20 entry): it's read-only, safe to call on every
 * page load.
 */

export interface RecentEventSummary {
  id: string;
  topic: string;
  firstSeenAt: string;
  latestUpdateAt: string;
  mentionCount: number;
  distinctTierCount: number;
}

export interface RecentFilingSummary {
  id: string;
  corpName: string;
  reportName: string;
  receiptDate: string;
  sourceCode: string;
}

export interface SeriesChangeSummary {
  seriesId: string;
  seriesName: string;
  /**
   * The provider this reading came from. `recentFilings` and `calendar` already carry one; this
   * list did not, and it is the section that shows actual numbers. Series names are not unique
   * across providers (the unique key is (sourceId, externalId)), so two providers tracking the
   * same indicator would appear here as two near-identical rows with different values.
   */
  sourceCode: string;
  unit: string;
  asOfDate: string;
  value: number;
  absoluteChange: number;
  percentChange: number | null;
  /**
   * Whether this value is stale relative to the series' own historical update cadence. UNKNOWN
   * (not FRESH) when there isn't enough history to project a cadence — see staleness.ts.
   */
  staleness: StalenessStatus;
}

export interface MorningBrief {
  generatedAt: string;
  recentEvents: RecentEventSummary[];
  recentFilings: RecentFilingSummary[];
  whatChanged: SeriesChangeSummary[];
  regime: RegimeSnapshot;
  calendar: CalendarEntry[];
}

export async function buildMorningBrief(
  options: { windowHours?: number } = {},
): Promise<MorningBrief> {
  const windowHours = options.windowHours ?? 72;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [events, filings, series, regime, calendar] = await Promise.all([
    prisma.event.findMany({
      where: { latestUpdateAt: { gte: since } },
      // ORDERING_WAIVER: a display list of recent events. Two events updated in the same millisecond may appear in either order, which changes nothing a reader relies on.
      orderBy: { latestUpdateAt: "desc" },
      take: 10,
    }),
    prisma.filing.findMany({
      where: { receiptDate: { gte: since } },
      // ORDERING_WAIVER: a display list of recent filings. Position carries no meaning and no figure is read from the first row.
      orderBy: { receiptDate: "desc" },
      take: 10,
      include: { source: true },
    }),
    prisma.series.findMany({ include: { source: { select: { code: true } } } }),
    computeRegimeSnapshot(),
    computeCalendar(),
  ]);

  const calendarBySeriesId = new Map(calendar.map((c) => [c.seriesId, c]));

  const whatChanged: SeriesChangeSummary[] = [];
  for (const s of series) {
    const pair = await getRecentObservationPair(s.id);
    if (!pair) continue;
    const change = computeChange(pair, s.unit);

    const calendarEntry = calendarBySeriesId.get(s.id);
    const staleness: StalenessStatus =
      calendarEntry?.status === "PROJECTED" &&
      calendarEntry.lastObservedDate !== undefined &&
      calendarEntry.medianIntervalDays !== undefined
        ? evaluateStaleness({
            lastObservedDate: calendarEntry.lastObservedDate,
            medianIntervalDays: calendarEntry.medianIntervalDays,
          }).status
        : "UNKNOWN";

    whatChanged.push({
      seriesId: s.id,
      seriesName: s.name,
      sourceCode: s.source.code,
      unit: s.unit,
      asOfDate: pair.current.observationDate.toISOString().slice(0, 10),
      value: Number(pair.current.value.toString()),
      absoluteChange: change.absoluteChange,
      percentChange: change.percentChange,
      staleness,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    recentEvents: events.map((e) => ({
      id: e.id,
      topic: e.topic,
      firstSeenAt: e.firstSeenAt.toISOString(),
      latestUpdateAt: e.latestUpdateAt.toISOString(),
      mentionCount: e.mentionCount,
      distinctTierCount: e.distinctTierCount,
    })),
    recentFilings: filings.map((f) => ({
      id: f.id,
      corpName: f.corpName,
      reportName: f.reportName,
      receiptDate: f.receiptDate.toISOString().slice(0, 10),
      sourceCode: f.source.code,
    })),
    whatChanged,
    regime,
    calendar: calendar.filter((c) => c.status === "PROJECTED"),
  };
}
