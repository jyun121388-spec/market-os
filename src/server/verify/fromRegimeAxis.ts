import type { AxisSnapshot } from "@/server/domain/macroRegime";
import type { VerificationInput } from "./types";

/**
 * Adapter: one real Macro Regime axis → a `VerificationInput`.
 *
 * The fourth and last v1 output shape, and the only one assembled from MULTIPLE SERIES ACROSS
 * PROVIDERS. Every other adapter feeds Verify a single-source output, so `cross_source_consistency`
 * has never once left `NOT_APPLICABLE` — it reports "single source, nothing to reconcile against",
 * which is true and has never been tested against anything else.
 *
 * The real RATES axis is where that changes, and reading it is instructive. It is configured with
 * three series — two US Treasury yields and the Bank of Korea base rate — and against the populated
 * database only the Korean one computes. The axis still reports `DATA_AVAILABLE`, and `/today`
 * renders the Korean policy rate as the RATES reading. The page does name the provider and the date
 * (fixed in an earlier round), so nothing is misattributed. What is not visible anywhere is that the
 * axis is standing on one of its three configured inputs.
 *
 * That is what `data_completeness` is for, and it needs the axis's CONFIGURED size to see it —
 * which is why this adapter takes it rather than counting the readings it was handed.
 *
 * Read-only and inert. Nothing in v1 imports this.
 */

export interface RegimeAxisEvidence {
  axis: AxisSnapshot;
  /** How many series the axis is configured with in `AXIS_SERIES`, not how many returned data. */
  configuredCount: number;
  /**
   * Freshness across the axis, where the caller could determine it.
   *
   * The caller passes the WORST state among the computed readings. An axis is a claim about the
   * current state of one macro dimension, and a claim assembled from a stale input is stale —
   * averaging it against fresher inputs would be picking the flattering number.
   */
  freshness?: {
    state: "FRESH" | "STALE" | "UNKNOWN";
    daysSinceLastObservation: number | null;
  };
}

export function verificationInputFromRegimeAxis(
  evidence: RegimeAxisEvidence,
): VerificationInput | null {
  const { axis, configuredCount } = evidence;

  // An axis with no data renders "Insufficient data", which is an honest absence rather than a
  // claim. There is nothing to verify and emitting a verdict would invent a subject.
  if (axis.status !== "DATA_AVAILABLE") return null;

  const computed = axis.readings.filter((r) => r.status === "COMPUTED");
  if (computed.length === 0) return null;

  const sourceCodes = [...new Set(computed.map((r) => r.sourceCode))];

  return {
    outputId: `regimeAxis:${axis.axis}`,
    // Each reading is a stored value shown as itself, alongside a direction that is the sign of a
    // difference. Deterministic, not probabilistic — so FACT rather than INFERENCE, and typing it
    // INFERENCE would demand a confidence this output has no basis to state.
    claimType: "FACT",
    sourceCodes,
    completeness: {
      // The axis's configured size is the only "expected total" that exists here. No provider
      // states how many series a macro regime dimension should have; we chose the list, so we are
      // the authority on it and can be held to it.
      providerTotal: configuredCount,
      fetched: computed.length,
      truncated: computed.length < configuredCount,
    },
    freshness: evidence.freshness,
  };
}
