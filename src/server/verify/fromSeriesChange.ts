import { vintageUnavailable, knownVintage, type ProviderVintage } from "../fabric/vintage";
import type { CalculationInput, VerificationInput } from "./types";

/**
 * Adapter: a real Morning Brief "What Changed" row → a `VerificationInput`.
 *
 * The second real output shape Verify has been pointed at, and the reason for writing it is not
 * coverage. The evaluators were built against Filing Diff, so every dimension has so far been
 * exercised by ONE output type — which is the fixture-realism failure this project keeps finding,
 * applied to the verifier itself. A dimension set fitted to one shape looks complete until a
 * second shape arrives.
 *
 * It is also the first output on the macro path, where `revision_integrity` actually bites. SEC
 * figures name the filing they came from, so the version question is settled by that identity. A
 * FRED or ECOS observation names nothing, and which value is current rests on ingest order — the
 * IR-021 situation, now visible in a verdict rather than only in a code comment.
 *
 * Read-only and inert. Nothing in v1 imports this.
 */

/** The fields of an `Observation` this adapter needs. Narrowed so it stays pure and testable. */
export interface ObservationEvidence {
  observationDate: Date;
  releaseDate: Date | null;
  retrievedAt: Date;
  value: number;
  isRevision: boolean;
}

export interface SeriesChangeEvidence {
  seriesName: string;
  /** The provider's own identifier for the series — the entity this reading describes. */
  externalId: string;
  unit: string;
  sourceCode: string;
  current: ObservationEvidence;
  previous: ObservationEvidence;
  /**
   * The row the current reading superseded, where it superseded one.
   *
   * Supplied only when `current.isRevision` is true and the superseded row was actually read.
   * Absent means no supersession is claimed, which is different from a supersession whose
   * evidence went unfetched — and the adapter must not blur the two by inventing a placeholder.
   */
  supersededByCurrent?: ObservationEvidence | null;
  /** What Morning Brief claims changed. Taken verbatim so the claim can be recomputed, not trusted. */
  claimedAbsoluteChange: number;
  claimedPercentChange: number | null;
  /** `staleness.ts` over the cadence `economicCalendar.ts` projects. */
  staleness: "FRESH" | "STALE" | "UNKNOWN";
  daysSinceLastObservation: number | null;
  /** Observations held for this series. There is no provider-stated total to check it against. */
  observationCount: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Vintage for one observation: the release date is real evidence where the provider gave one. */
function vintageOf(sourceCode: string, observation: ObservationEvidence): ProviderVintage {
  const base = vintageUnavailable(sourceCode, observation.retrievedAt.toISOString());
  return observation.releaseDate
    ? {
        ...base,
        sourceReleasedAt: knownVintage(
          observation.releaseDate.toISOString(),
          `${sourceCode}: Observation.releaseDate as stored`,
        ),
      }
    : base;
}

export function verificationInputFromSeriesChange(
  evidence: SeriesChangeEvidence,
): VerificationInput {
  const side = (observation: ObservationEvidence): CalculationInput => ({
    label: evidence.seriesName,
    value: observation.value,
    unit: evidence.unit,
    sourceCode: evidence.sourceCode,
    entityRef: evidence.externalId,
    // A macro reading measures the series itself. Naming the concept as the series identifier is
    // what lets `semantic_consistency` catch two different indicators being differenced — the
    // macro equivalent of comparing revenue against net income.
    concept: evidence.externalId,
    period: {
      // An observation is an INSTANT, not a span: a value AT a date, with no start and no
      // duration. Reporting a fabricated start so the shape matches a filing period would invent
      // a claim the provider never made.
      start: null,
      end: iso(observation.observationDate),
      months: null,
      days: null,
    },
    // No accession: a macro observation carries no provider filing identity, which is precisely
    // why `revision_integrity` cannot short-circuit on this path.
  });

  return {
    outputId: `seriesChange:${evidence.sourceCode}:${evidence.externalId}`,
    claimType: "CALCULATION",
    sourceCodes: [evidence.sourceCode],
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE",
      current: side(evidence.current),
      previous: side(evidence.previous),
      claimedAbsoluteChange: evidence.claimedAbsoluteChange,
      claimedPercentChange: evidence.claimedPercentChange,
    },
    completeness: {
      // No macro provider states how many observations a series should have, so this is the same
      // honest shape SEC gets: no shortfall detected, and no total to have detected one against.
      providerTotal: null,
      fetched: evidence.observationCount,
      truncated: false,
    },
    freshness: {
      state: evidence.staleness,
      daysSinceLastObservation: evidence.daysSinceLastObservation,
    },
    revision: evidence.supersededByCurrent
      ? {
          applied: vintageOf(evidence.sourceCode, evidence.current),
          superseded: vintageOf(evidence.sourceCode, evidence.supersededByCurrent),
          // Whether the applied value repeats one earlier in the chain is exactly what the v1
          // guard tests, and this adapter deliberately does not recompute it: it is derived from
          // rows outside the pair Morning Brief read, and asserting it from two rows would be a
          // guess dressed as evidence.
        }
      : undefined,
  };
}
