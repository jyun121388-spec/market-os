import { prisma } from "@/server/db/client";
import { computeCalendarEntry } from "@/server/domain/economicCalendar";
import { evaluateStaleness } from "@/server/domain/staleness";
import { assessCompleteness } from "@/server/domain/companyXray";
import { vintageUnavailable, withStoredReleaseDate, type ProviderVintage } from "./vintage";

/**
 * Reality Fabric — READ-ONLY SHADOW PROJECTION (docs/WORLD_DATA_FABRIC.md).
 *
 * This module is deliberately inert. Nothing in Market OS v1 imports it, it performs no writes,
 * and it changes no user-facing output. Its only purpose is to run the freshness and completeness
 * implementations that ALREADY exist, side by side, over the same real data — and report where
 * they disagree.
 *
 * Why that is worth doing rather than writing a fourth implementation: three separate places in
 * v1 currently answer "is this current?" and "is this all of it?", each with its own rule and no
 * shared type.
 *
 *   - `staleness.ts`         judges a SERIES by its own observation cadence
 *   - `systemHealth.ts`      judges a SOURCE by when we last retrieved anything from it
 *   - `assessCompleteness`   judges a COMPANY by its most recent ingest run per target
 *
 * They measure genuinely different things, so a difference between them is not automatically a
 * bug. That is exactly why this layer does NOT pick a winner. It records both answers and labels
 * the disagreement, and a human decides which semantics were intended before any v1 code changes
 * (`docs/META_ARCHITECTURE_V2.md`, shadow-mode policy).
 *
 * The rule this encodes, taken from `assessCompleteness` itself: absence of evidence is never
 * evidence of currency. Anything unmeasurable is UNKNOWN, never FRESH.
 */

/** Reality states, per the Fabric contract. */
export type FabricState =
  "FRESH" | "STALE" | "DELAYED" | "TRUNCATED" | "CONFLICTED" | "UNAVAILABLE" | "UNKNOWN";

/** The three timestamps that must never be collapsed into one. */
export interface TemporalStamp {
  /** The date the value DESCRIBES. */
  observedAt: string | null;
  /** When the provider published it, when the provider says. */
  releasedAt: string | null;
  /** When we fetched it. Always known — and never a substitute for the other two. */
  retrievedAt: string | null;
}

export type DisagreementKind =
  | "FRESHNESS_BASIS"
  | "COMPLETENESS_HISTORY"
  | "CADENCE_UNKNOWN_BUT_RETRIEVED"
  | "NO_RUN_RECORDED"
  | "REVISED_WITHOUT_VINTAGE";

export interface Disagreement {
  kind: DisagreementKind;
  datasetKey: string;
  /** What each implementation said, verbatim. */
  answers: Record<string, string>;
  /** Why these two answers are worth a human's attention. Never asserts which is right. */
  note: string;
}

export interface SeriesFabricRow {
  datasetKey: string;
  sourceCode: string;
  seriesName: string;
  temporal: TemporalStamp;
  /** `staleness.ts` over the cadence `economicCalendar.ts` projects. */
  stalenessVerdict: "FRESH" | "STALE" | "UNKNOWN";
  daysSinceLastObservation: number | null;
  /** `economicCalendar.ts` — whether a cadence could be projected at all. */
  calendarStatus: "PROJECTED" | "INSUFFICIENT_DATA";
  medianIntervalDays: number | null;
  /**
   * What the provider says about WHICH VERSION of the latest value this is.
   *
   * The fourth question, alongside the three in `TemporalStamp`. Those three ask WHEN; this one
   * asks WHICH — and IR-021 is what happens when only the first three are available and the
   * newest arrival is taken for the newest version.
   */
  vintage: ProviderVintage;
  /** Observations in this series that superseded an earlier value. */
  revisionCount: number;
  /** Days since anything for this series was last RETRIEVED, which is a different question. */
  daysSinceLastRetrieval: number | null;
  observationCount: number;
  state: FabricState;
}

export interface CompanyFabricRow {
  datasetKey: string;
  sourceCode: string;
  corpCode: string;
  /** `assessCompleteness`, called directly rather than reimplemented. */
  completenessStatus: string;
  completenessDetail: string;
  /** Raw run history, which `assessCompleteness` deliberately reduces to "most recent per target". */
  totalRuns: number;
  everTruncated: boolean;
  latestRunTruncated: boolean;
  filingCount: number;
  factCount: number;
  state: FabricState;
}

export interface FabricProjection {
  generatedAt: string;
  series: SeriesFabricRow[];
  companies: CompanyFabricRow[];
  disagreements: Disagreement[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString();
const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

/**
 * Runs every existing implementation over current data and reports disagreements.
 *
 * `now` is injectable so tests are not tied to wall-clock — freshness is entirely a function of
 * elapsed time, and a test that cannot control the clock cannot test staleness at all.
 */
export async function computeFabricProjection(now: Date = new Date()): Promise<FabricProjection> {
  const [series, companyGroups] = await Promise.all([
    prisma.series.findMany({ include: { source: { select: { code: true } } } }),
    prisma.filing.groupBy({ by: ["sourceId", "corpCode"], _count: { _all: true } }),
  ]);

  const disagreements: Disagreement[] = [];

  const seriesRows: SeriesFabricRow[] = [];
  for (const s of series) {
    const datasetKey = `${s.source.code}:${s.externalId}`;
    const calendar = await computeCalendarEntry(s.id);

    const [latestObservation, retrievalAgg, observationCount, revisionCount] = await Promise.all([
      prisma.observation.findFirst({
        where: { seriesId: s.id },
        orderBy: { observationDate: "desc" },
        select: { observationDate: true, releaseDate: true, retrievedAt: true },
      }),
      prisma.observation.aggregate({ where: { seriesId: s.id }, _max: { retrievedAt: true } }),
      prisma.observation.count({ where: { seriesId: s.id } }),
      prisma.observation.count({ where: { seriesId: s.id, isRevision: true } }),
    ]);

    const staleness =
      calendar.status === "PROJECTED" &&
      calendar.lastObservedDate !== undefined &&
      calendar.medianIntervalDays !== undefined
        ? evaluateStaleness(
            {
              lastObservedDate: calendar.lastObservedDate,
              medianIntervalDays: calendar.medianIntervalDays,
            },
            now,
          )
        : null;

    const lastRetrieval = retrievalAgg._max.retrievedAt ?? null;
    const daysSinceLastRetrieval = lastRetrieval ? daysBetween(lastRetrieval, now) : null;

    // A release date, where the provider gave one, IS vintage evidence — the weaker rung, but
    // real. Everything else is reported at whatever the capability table says is honest for this
    // provider, so the projection never implies we hold evidence we do not.
    const vintage: ProviderVintage = withStoredReleaseDate(
      vintageUnavailable(s.source.code, lastRetrieval ? iso(lastRetrieval) : ""),
      s.source.code,
      latestObservation?.releaseDate?.toISOString() ?? null,
    );

    const stalenessVerdict = staleness?.status ?? "UNKNOWN";
    const state: FabricState =
      stalenessVerdict === "STALE" ? "STALE" : stalenessVerdict === "FRESH" ? "FRESH" : "UNKNOWN";

    seriesRows.push({
      datasetKey,
      sourceCode: s.source.code,
      seriesName: s.name,
      temporal: {
        observedAt: latestObservation?.observationDate.toISOString().slice(0, 10) ?? null,
        releasedAt: latestObservation?.releaseDate?.toISOString().slice(0, 10) ?? null,
        retrievedAt: lastRetrieval ? iso(lastRetrieval) : null,
      },
      stalenessVerdict,
      daysSinceLastObservation: staleness?.daysSinceLastObservation ?? null,
      calendarStatus: calendar.status,
      medianIntervalDays: calendar.medianIntervalDays ?? null,
      vintage,
      revisionCount,
      daysSinceLastRetrieval,
      observationCount,
      state,
    });

    // D5 — this series has had a value replaced, and nothing on record says which version won.
    //
    // Reported for the population where it MATTERS rather than for every series, because a series
    // that has never been revised has no version question to answer. Where one has, the ordering
    // rests on arrival time, which IR-021 proved is not the same claim.
    if (revisionCount > 0 && vintage.providerVintageAt.availability !== "KNOWN") {
      disagreements.push({
        kind: "REVISED_WITHOUT_VINTAGE",
        datasetKey,
        answers: {
          "observationIngest (by arrival)": `${revisionCount} revision(s) applied in ingest order`,
          "provider vintage": `${vintage.providerVintageAt.availability} — ${vintage.providerVintageAt.basis ?? "no basis recorded"}`,
        },
        note:
          "A stored value here was superseded, and which version is current rests on which " +
          "ingest arrived last. The replay guard in observationIngest limits the damage but " +
          "cannot distinguish a stale replay from a genuine re-correction.",
      });
    }

    // D1 — the two questions "is the DATA current?" and "did we FETCH recently?" are different,
    // and a reader of /admin sees only the second. A series can be freshly retrieved and badly
    // stale: we asked the provider an hour ago and it still has nothing newer to give.
    if (
      stalenessVerdict === "STALE" &&
      daysSinceLastRetrieval !== null &&
      daysSinceLastRetrieval <= 1
    ) {
      disagreements.push({
        kind: "FRESHNESS_BASIS",
        datasetKey,
        answers: {
          "staleness.ts (by observationDate)": `STALE, ${staleness?.daysSinceLastObservation} days since last observation`,
          "systemHealth-style (by retrievedAt)": `retrieved ${daysSinceLastRetrieval} day(s) ago`,
        },
        note:
          "Retrieved recently but the data itself is past its cadence. /admin reports source health " +
          "from retrievedAt only, so an operator reading it would see this source as healthy.",
      });
    }

    // D2 — a series with observations but no projectable cadence is UNKNOWN, correctly. Worth
    // surfacing anyway: it is indistinguishable on screen from a series nobody has looked at.
    if (calendar.status === "INSUFFICIENT_DATA" && observationCount > 0) {
      disagreements.push({
        kind: "CADENCE_UNKNOWN_BUT_RETRIEVED",
        datasetKey,
        answers: {
          "economicCalendar.ts": "INSUFFICIENT_DATA — cannot project a cadence",
          "observation count": String(observationCount),
        },
        note:
          "Has stored observations but too few to project a cadence, so freshness is UNKNOWN. " +
          "Correct and deliberate; listed so it is not mistaken for a series with no data.",
      });
    }
  }

  const sources = await prisma.source.findMany({ select: { id: true, code: true } });
  const sourceCode = new Map(sources.map((s) => [s.id, s.code]));

  const companyRows: CompanyFabricRow[] = [];
  for (const g of companyGroups) {
    const datasetKey = `${sourceCode.get(g.sourceId) ?? "UNKNOWN"}:${g.corpCode}`;

    const [note, runs, factCount] = await Promise.all([
      assessCompleteness(g.sourceId, g.corpCode),
      prisma.ingestRun.findMany({
        where: { sourceId: g.sourceId, target: { in: [g.corpCode, `xbrl:${g.corpCode}`] } },
        orderBy: { startedAt: "desc" },
        select: { target: true, truncated: true, status: true, startedAt: true },
      }),
      prisma.financialFact.count({ where: { sourceId: g.sourceId, corpCode: g.corpCode } }),
    ]);

    const seen = new Set<string>();
    const latestPerTarget = runs.filter((r) => !seen.has(r.target) && seen.add(r.target));
    const everTruncated = runs.some((r) => r.truncated || r.status === "PARTIAL");
    const latestRunTruncated = latestPerTarget.some((r) => r.truncated || r.status === "PARTIAL");

    companyRows.push({
      datasetKey,
      sourceCode: sourceCode.get(g.sourceId) ?? "UNKNOWN",
      corpCode: g.corpCode,
      completenessStatus: note.status,
      completenessDetail: note.detail,
      totalRuns: runs.length,
      everTruncated,
      latestRunTruncated,
      filingCount: g._count._all,
      factCount,
      state:
        note.status === "COMPLETE"
          ? "FRESH"
          : note.status === "KNOWN_INCOMPLETE"
            ? "TRUNCATED"
            : note.status === "LAST_RUN_FAILED"
              ? "UNAVAILABLE"
              : "UNKNOWN",
    });

    // D3 — the hypothesis recorded in docs/WORLD_DATA_FABRIC.md. `assessCompleteness` reduces to
    // the most recent run per target, so an earlier truncated run followed by a later clean one
    // reports COMPLETE. Whether that is right depends on something the runs table does not say:
    // whether the later run re-fetched the whole history or only appended to it. Recorded as a
    // question, not asserted as a defect.
    if (note.status === "COMPLETE" && everTruncated && !latestRunTruncated) {
      disagreements.push({
        kind: "COMPLETENESS_HISTORY",
        datasetKey,
        answers: {
          "assessCompleteness (latest run per target)": "COMPLETE",
          "raw run history": `${runs.length} run(s), at least one truncated`,
        },
        note:
          "Reported COMPLETE while an earlier run for this target was truncated. Sound only if the " +
          "later run re-fetched the full history rather than appending. The runs table does not " +
          "record which, so this cannot be settled from stored data alone.",
      });
    }

    if (note.status === "UNKNOWN" && (g._count._all > 0 || factCount > 0)) {
      disagreements.push({
        kind: "NO_RUN_RECORDED",
        datasetKey,
        answers: {
          assessCompleteness: "UNKNOWN — no ingest run recorded",
          "stored rows": `${g._count._all} filing(s), ${factCount} fact(s)`,
        },
        note:
          "Data exists but no ingest run explains where it came from. Either it predates run " +
          "recording, or it was written by a path that does not record one.",
      });
    }
  }

  return {
    generatedAt: iso(now),
    series: seriesRows,
    companies: companyRows,
    disagreements,
  };
}
