import { prisma } from "@/server/db/client";
import { computeCompanyXray } from "@/server/domain/companyXray";
import { verify } from "./evaluate";
import { computeCalendarEntry } from "@/server/domain/economicCalendar";
import { computeChange, getRecentObservationPair } from "@/server/domain/seriesReadings";
import { evaluateStaleness } from "@/server/domain/staleness";
import { verificationInputFromFilingDiff } from "./fromFilingDiff";
import { verificationInputFromSeriesChange, type ObservationEvidence } from "./fromSeriesChange";
import type { DimensionName, Verdict } from "./types";

/**
 * Verify — SHADOW RUN over real v1 output (docs/VERIFY_ARCHITECTURE.md).
 *
 * Takes what Market OS actually produces for a company, runs it through the evaluators, and
 * records the verdicts. It changes nothing: no writes, no v1 imports of this module, no path by
 * which a verdict can reach a rendered page.
 *
 * **A failure inside the verifier must never become a v1 failure.** Every observation is produced
 * inside a try/catch that degrades to `SHADOW_VERIFY_ERROR`. A shadow layer that can crash the
 * thing it observes is not a shadow layer — and this one runs over financial data where the
 * temptation to "just let it throw" is exactly wrong.
 */

export interface ShadowObservation {
  outputType: "FILING_DIFF" | "SERIES_CHANGE";
  outputId: string;
  entityRef: string;
  sourceCode: string;
  verdict: Verdict | "SHADOW_VERIFY_ERROR";
  /** Dimensions that failed. A verdict must always be traceable to a cause. */
  failed: DimensionName[];
  /** Disclosed caveats — present even on a passing verdict. */
  limitations: string[];
  /** Completeness state of the data underneath, as the Fabric reports it. */
  completeness: "COMPLETE" | "UNCONFIRMED" | "KNOWN_INCOMPLETE" | "LAST_RUN_FAILED" | "UNKNOWN";
  /**
   * Every dimension's status, not just the failures.
   *
   * The first shadow run returned one verdict for all eight outputs and there was no way to see
   * why from the observation alone. A uniform verdict with no breakdown is indistinguishable from
   * a broken verifier, so the breakdown travels with it.
   */
  dimensions: Record<string, string>;
  /** Non-null only when the verifier itself failed. */
  error?: string;
}

export interface ShadowRunResult {
  /** Stamped by the caller, not here — `Date.now()` inside the run would make it untestable. */
  observations: ShadowObservation[];
  byVerdict: Record<string, number>;
}

/**
 * A stable identifier for the evaluator behind a set of observations.
 *
 * Bumped by hand when evaluator semantics change. Without it a ledger of verdicts is
 * uninterpretable later: "REJECTED" means nothing unless you know which rules produced it.
 */
export const VERIFIER_VERSION = "verify-shadow-1";

/**
 * Runs Verify over one company's real Filing Diff output.
 *
 * Returns observations rather than persisting them. Keeping the write decision with the caller is
 * what makes this safe to run against `market_os_dev`, which holds real ingested SEC data.
 */
export async function shadowVerifyCompany(corpCode: string): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];

  const xray = await computeCompanyXray(corpCode);
  if (!xray) return { observations, byVerdict: {} };

  // The same completeness evidence the page shows its reader, so the verifier is judging the
  // output as presented rather than a more favourable version of it.
  const completeness = xray.completeness.status;
  const truncated = completeness === "KNOWN_INCOMPLETE";
  const providerTotal = completeness === "COMPLETE" ? xray.company.filingCount : null;

  for (const diff of xray.changes) {
    try {
      const input = verificationInputFromFilingDiff(diff, {
        completeness: {
          providerTotal,
          fetched: xray.company.filingCount,
          truncated,
        },
      });
      // INSUFFICIENT_DATA diffs produce no claim. Skipping them is correct: there is nothing to
      // verify, and emitting a verdict would imply one was evaluated.
      if (!input) continue;

      const result = verify(input);
      observations.push({
        outputType: "FILING_DIFF",
        outputId: result.outputId,
        entityRef: corpCode,
        sourceCode: diff.sourceCode ?? "",
        verdict: result.verdict,
        failed: result.failed,
        limitations: result.limitations,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([name, d]) => [name, d.status]),
        ),
        completeness,
      });
    } catch (error) {
      // Degrade, never propagate. A defect in the verifier must cost an observation, not a page.
      observations.push({
        outputType: "FILING_DIFF",
        outputId: `filingDiff:${corpCode}:${diff.concept}:${diff.unit}`,
        entityRef: corpCode,
        sourceCode: diff.sourceCode ?? "",
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        completeness,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;

  return { observations, byVerdict };
}

/**
 * Runs Verify over the real Morning Brief "What Changed" rows.
 *
 * Deliberately built from the SAME reads Morning Brief performs — `getRecentObservationPair` and
 * `computeChange`, called rather than reimplemented. A verifier fed its own reconstruction of the
 * data verifies the reconstruction, and the two can diverge silently; this project has already
 * shipped one defect where two call sites derived "which row is current" independently.
 *
 * The previous value is NOT derived by subtracting the claimed change from the current one. That
 * would make `calculation_integrity` recompute the claim from the claim, which passes always and
 * proves nothing. Both sides come from the observation pair.
 */
export async function shadowVerifySeriesChanges(now: Date = new Date()): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];
  const series = await prisma.series.findMany({
    include: { source: { select: { code: true } } },
    orderBy: { externalId: "asc" },
  });

  for (const s of series) {
    const outputId = `seriesChange:${s.source.code}:${s.externalId}`;
    try {
      const pair = await getRecentObservationPair(s.id);
      // Fewer than two distinct dates is Morning Brief correctly showing nothing. There is no
      // claim, and inventing a verdict for an absent output would be assurance about nothing.
      if (!pair) continue;

      const change = computeChange(pair, s.unit);
      const calendar = await computeCalendarEntry(s.id);
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

      const evidence = (row: typeof pair.current): ObservationEvidence => ({
        observationDate: row.observationDate,
        releaseDate: row.releaseDate,
        retrievedAt: row.retrievedAt,
        value: Number(row.value.toString()),
        isRevision: row.isRevision,
      });

      // Read the row the current reading superseded, where it superseded one. Only fetched when
      // `revisionOf` names one — an absent supersession and an unfetched one are different states
      // and the adapter is built so they cannot be confused.
      const superseded = pair.current.revisionOf
        ? await prisma.observation.findUnique({ where: { id: pair.current.revisionOf } })
        : null;

      const result = verify(
        verificationInputFromSeriesChange({
          seriesName: s.name,
          externalId: s.externalId,
          unit: s.unit,
          sourceCode: s.source.code,
          current: evidence(pair.current),
          previous: evidence(pair.previous),
          supersededByCurrent: superseded ? evidence(superseded) : null,
          claimedAbsoluteChange: change.absoluteChange,
          claimedPercentChange: change.percentChange,
          staleness: staleness?.status ?? "UNKNOWN",
          daysSinceLastObservation: staleness?.daysSinceLastObservation ?? null,
          observationCount: await prisma.observation.count({ where: { seriesId: s.id } }),
        }),
      );

      observations.push({
        outputType: "SERIES_CHANGE",
        outputId: result.outputId,
        entityRef: s.externalId,
        sourceCode: s.source.code,
        verdict: result.verdict,
        failed: result.failed,
        limitations: result.limitations,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([name, d]) => [name, d.status]),
        ),
        // No macro provider states how many observations a series should have, which is the same
        // position SEC leaves companyfacts in.
        completeness: "UNCONFIRMED",
      });
    } catch (error) {
      observations.push({
        outputType: "SERIES_CHANGE",
        outputId,
        entityRef: s.externalId,
        sourceCode: s.source.code,
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        completeness: "UNKNOWN",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;
  return { observations, byVerdict };
}

/** Every company with stored filings, so a shadow run needs no hard-coded list. */
export async function companiesWithFilings(): Promise<string[]> {
  const rows = await prisma.filing.findMany({
    distinct: ["corpCode"],
    select: { corpCode: true },
    orderBy: { corpCode: "asc" },
  });
  return rows.map((r) => r.corpCode);
}
