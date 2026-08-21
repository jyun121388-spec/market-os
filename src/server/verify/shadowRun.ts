import { prisma } from "@/server/db/client";
import { computeCompanyXray } from "@/server/domain/companyXray";
import { verify } from "./evaluate";
import { askMarket } from "@/server/domain/askMarket";
import { computeCalendarEntry } from "@/server/domain/economicCalendar";
import { computeChange, getRecentObservationPair } from "@/server/domain/seriesReadings";
import { AXIS_SERIES, computeRegimeSnapshot } from "@/server/domain/macroRegime";
import { evaluateStaleness } from "@/server/domain/staleness";
import { verificationInputFromAskMarket } from "./fromAskMarket";
import { verificationInputFromFilingDiff } from "./fromFilingDiff";
import { verificationInputFromRegimeAxis } from "./fromRegimeAxis";
import { verificationInputFromSeriesChange, type ObservationEvidence } from "./fromSeriesChange";
import type { DimensionName, Verdict, VerificationResult } from "./types";

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
  outputType: "FILING_DIFF" | "SERIES_CHANGE" | "ASK_MARKET" | "REGIME_AXIS";
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
  /**
   * Per dimension, why the evidence it wanted was missing — structural limitation, verification
   * debt, or a defect in this record. Present only for dimensions the capability matrix could
   * explain. A run where every gap is VERIFICATION_DEBT is a work list; one where they are all
   * STRUCTURAL_LIMITATION is the ceiling of what these providers can support.
   */
  evidenceGaps: Record<string, string>;
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
export const VERIFIER_VERSION = "verify-shadow-2";

/** Only dimensions the capability matrix could explain; an empty map means it explained none. */
function collectEvidenceGaps(result: VerificationResult): Record<string, string> {
  return Object.fromEntries(
    Object.entries(result.dimensions)
      .filter(([, d]) => d.evidenceGap !== undefined && d.evidenceGap !== "NO_GAP")
      .map(([name, d]) => [name, d.evidenceGap as string]),
  );
}

/**
 * Runs Verify over one company's real Filing Diff output.
 *
 * Returns observations rather than persisting them. Keeping the write decision with the caller is
 * what makes this safe to run against `market_os_dev`, which holds real ingested SEC data.
 */
export async function shadowVerifyCompany(
  corpCode: string,
  sourceCode: string,
): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];

  // The provider is now required, not inferred. `computeCompanyXray` refuses to guess between two
  // providers sharing a corp code, so a shadow run that passed only the code would have silently
  // verified nothing for an ambiguous company — the same collapse as A11, one layer up (IR-032).
  const xray = await computeCompanyXray(corpCode, sourceCode);
  if (!xray) return { observations, byVerdict: {} };

  // The same completeness evidence the page shows its reader, so the verifier is judging the
  // output as presented rather than a more favourable version of it.
  const completeness = xray.completeness.status;

  // UNKNOWN and LAST_RUN_FAILED are ABSENCES of evidence, not measurements of zero shortfall.
  //
  // They used to be passed through as `{ providerTotal: null, truncated: false }`, which
  // `data_completeness` reads as "no shortfall was detected" — a sentence that is true for
  // UNCONFIRMED and false for the other two. UNKNOWN means no ingest run was ever recorded, so
  // nothing was detected because nothing looked; LAST_RUN_FAILED means the most recent attempt
  // failed outright. Both were rendering as the same mild caveat as a successful run against a
  // provider that publishes no total.
  //
  // Found by a second-order pass asking the protocol's question directly: which consumer turns
  // UNKNOWN into COMPLETE? This one, one step short of it.
  //
  // The nuance is not lost — `ShadowObservation.completeness` carries the status verbatim. What
  // changes is that Verify stops making a claim it has no basis for.
  const completenessMeasured =
    completeness === "COMPLETE" ||
    completeness === "UNCONFIRMED" ||
    completeness === "KNOWN_INCOMPLETE";
  const truncated = completeness === "KNOWN_INCOMPLETE";
  const providerTotal = completeness === "COMPLETE" ? xray.company.filingCount : null;

  for (const diff of xray.changes) {
    try {
      const input = verificationInputFromFilingDiff(diff, {
        completeness: completenessMeasured
          ? { providerTotal, fetched: xray.company.filingCount, truncated }
          : undefined,
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
        evidenceGaps: collectEvidenceGaps(result),
        completeness,
      });
    } catch (error) {
      // Degrade, never propagate. A defect in the verifier must cost an observation, not a page.
      observations.push({
        outputType: "FILING_DIFF",
        outputId: `filingDiff:${diff.sourceCode ?? sourceCode}:${corpCode}:${diff.concept}:${diff.unit}`,
        entityRef: corpCode,
        sourceCode: diff.sourceCode ?? "",
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        evidenceGaps: {},
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
        evidenceGaps: collectEvidenceGaps(result),
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
        evidenceGaps: {},
        completeness: "UNKNOWN",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;
  return { observations, byVerdict };
}

/**
 * Runs Verify over real Ask Market answers.
 *
 * The queries are DERIVED from the corp names actually stored, plus an advice-framed variant of
 * each. Hard-coding a question list would make this a test of the questions I happened to think
 * of; deriving them means the run covers whatever this database actually holds, and the advice
 * variant is the only path in the product where `adversarial_resilience` has anything to bite on.
 */
export async function shadowVerifyAskMarket(): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];
  const companies = await prisma.filing.findMany({
    distinct: ["corpName"],
    select: { corpName: true, source: { select: { code: true } } },
    orderBy: { corpName: "asc" },
  });

  const queries = companies.flatMap((c) => [
    { query: c.corpName, sourceCode: c.source.code },
    { query: `Should I buy ${c.corpName}?`, sourceCode: c.source.code },
  ]);

  for (const { query, sourceCode } of queries) {
    try {
      const answer = await askMarket(query);

      // Count what COULD have been shown, so the shortfall is a number rather than an absence.
      // Ask Market caps company facts at ten and series matches at five, and nothing on the page
      // says so — against the real database that is ten of 1428 held facts.
      const source = await prisma.source.findFirst({ where: { code: sourceCode } });
      const companyFactsHeld =
        source && answer.companyFacts.length > 0
          ? await prisma.financialFact.count({
              where: {
                sourceId: source.id,
                corpCode: (
                  await prisma.filing.findFirst({
                    where: { sourceId: source.id, corpName: answer.matchedTopic ?? "" },
                    select: { corpCode: true },
                  })
                )?.corpCode,
              },
            })
          : answer.companyFacts.length;

      const input = verificationInputFromAskMarket(answer, {
        companyFactsHeld,
        seriesMatchesHeld: answer.seriesFactors.length,
      });
      // NOT_FOUND shows the reader nothing, so there is no claim. Emitting a verdict would imply
      // one was evaluated.
      if (!input) continue;

      const result = verify(input);
      observations.push({
        outputType: "ASK_MARKET",
        outputId: result.outputId,
        entityRef: query,
        sourceCode,
        verdict: result.verdict,
        failed: result.failed,
        limitations: result.limitations,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([name, d]) => [name, d.status]),
        ),
        evidenceGaps: collectEvidenceGaps(result),
        completeness: "UNKNOWN",
      });
    } catch (error) {
      observations.push({
        outputType: "ASK_MARKET",
        outputId: `askMarket:${query}`,
        entityRef: query,
        sourceCode,
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        evidenceGaps: {},
        completeness: "UNKNOWN",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;
  return { observations, byVerdict };
}

/**
 * Runs Verify over the real Macro Regime axes.
 *
 * The only output assembled from more than one provider, and therefore the only one that can
 * exercise `cross_source_consistency` on anything other than "single source, nothing to reconcile".
 */
export async function shadowVerifyRegimeAxes(now: Date = new Date()): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];
  const snapshot = await computeRegimeSnapshot();

  for (const axis of snapshot.axes) {
    const outputId = `regimeAxis:${axis.axis}`;
    try {
      const configuredCount = AXIS_SERIES[axis.axis].length;
      const computed = axis.readings.filter((r) => r.status === "COMPUTED");

      // Worst freshness across the computed readings. An axis assembled from a stale input is a
      // stale claim about the present, and taking the freshest input instead would be choosing the
      // number that looks best.
      let worst: { state: "FRESH" | "STALE" | "UNKNOWN"; daysSinceLastObservation: number | null } =
        {
          state: "FRESH",
          daysSinceLastObservation: null,
        };
      for (const reading of computed) {
        const series = await prisma.series.findFirst({
          where: { externalId: reading.externalId, source: { code: reading.sourceCode } },
          select: { id: true },
        });
        if (!series) continue;
        const calendar = await computeCalendarEntry(series.id);
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
        const state = staleness?.status ?? "UNKNOWN";
        // STALE outranks UNKNOWN outranks FRESH.
        if (state === "STALE" || (state === "UNKNOWN" && worst.state === "FRESH")) {
          worst = { state, daysSinceLastObservation: staleness?.daysSinceLastObservation ?? null };
        }
      }

      const input = verificationInputFromRegimeAxis({ axis, configuredCount, freshness: worst });
      if (!input) continue;

      const result = verify(input);
      observations.push({
        outputType: "REGIME_AXIS",
        outputId: result.outputId,
        entityRef: axis.axis,
        sourceCode: [...new Set(computed.map((r) => r.sourceCode))].join("+"),
        verdict: result.verdict,
        failed: result.failed,
        limitations: result.limitations,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([name, d]) => [name, d.status]),
        ),
        evidenceGaps: collectEvidenceGaps(result),
        completeness: input.completeness?.truncated ? "KNOWN_INCOMPLETE" : "COMPLETE",
      });
    } catch (error) {
      observations.push({
        outputType: "REGIME_AXIS",
        outputId,
        entityRef: axis.axis,
        sourceCode: "",
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        evidenceGaps: {},
        completeness: "UNKNOWN",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;
  return { observations, byVerdict };
}

/**
 * Every company with stored filings, as (provider, corp code) PAIRS.
 *
 * Deduplicating on `corpCode` alone dropped one of any two companies sharing a code, and the run
 * then verified whichever provider the resolver happened to pick. A corp code is not a company
 * (IR-001, IR-002, IR-032); the pair is.
 */
export async function companiesWithFilings(): Promise<{ sourceCode: string; corpCode: string }[]> {
  const rows = await prisma.filing.findMany({
    distinct: ["sourceId", "corpCode"],
    select: { corpCode: true, source: { select: { code: true } } },
    orderBy: [{ corpCode: "asc" }],
  });
  return rows
    .map((r) => ({ sourceCode: r.source.code, corpCode: r.corpCode }))
    .sort((a, b) =>
      a.corpCode === b.corpCode
        ? a.sourceCode.localeCompare(b.sourceCode)
        : a.corpCode.localeCompare(b.corpCode),
    );
}
