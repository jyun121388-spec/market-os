import { describe, expect, it } from "vitest";
import type { AxisSnapshot, SeriesReading } from "@/server/domain/macroRegime";
import { verify } from "@/server/verify/evaluate";
import { verificationInputFromRegimeAxis } from "@/server/verify/fromRegimeAxis";

/**
 * The fourth and last v1 output shape, and the only one assembled from more than one provider.
 *
 * Against the populated database both axes with data come back TRUNCATED, which is the right
 * answer and one no other adapter can produce: GROWTH stands on one of its two configured series
 * and RATES on one of its three. `/today` renders the Bank of Korea base rate as the RATES reading,
 * correctly attributed, with nothing anywhere saying the axis is standing on a third of its inputs.
 *
 * `cross_source_consistency` is the dimension this adapter exists to reach. On real data it still
 * returns NOT_APPLICABLE, because only one series per axis currently computes — the two US Treasury
 * series are untracked pending FRED (HG-002). So the multi-source branch is exercised here, on a
 * fixture shaped exactly like what RATES becomes once a key exists, rather than being left
 * untested until it silently starts mattering.
 */

const reading = (over: Partial<SeriesReading> = {}): SeriesReading => ({
  sourceCode: "FRED",
  externalId: "DGS10",
  status: "COMPUTED",
  seriesName: "10-Year Treasury",
  asOfDate: "2026-08-01",
  value: 4.25,
  change: { absoluteChange: 0.05, percentChange: 1.19, bpsChange: 5 },
  direction: "UP",
  ...over,
});

const axis = (readings: SeriesReading[]): AxisSnapshot => ({
  axis: "RATES",
  status: readings.some((r) => r.status === "COMPUTED") ? "DATA_AVAILABLE" : "INSUFFICIENT_DATA",
  readings,
});

describe("verificationInputFromRegimeAxis", () => {
  it("produces no claim for an axis that renders 'Insufficient data'", () => {
    // An honest absence is not a claim, and a verdict over one would invent a subject.
    const empty = axis([reading({ status: "NOT_TRACKED" })]);
    expect(verificationInputFromRegimeAxis({ axis: empty, configuredCount: 3 })).toBeNull();
  });

  /**
   * The reason the adapter takes `configuredCount` instead of counting the readings it was handed.
   * An axis reporting DATA_AVAILABLE from one of three inputs is computed over a knowably partial
   * dataset, and counting only what arrived would make every axis look complete by definition.
   */
  it("reports an axis standing on a third of its inputs as TRUNCATED", () => {
    const partial = axis([
      reading(),
      reading({ externalId: "DGS2", status: "NOT_TRACKED" }),
      reading({ sourceCode: "ECOS", externalId: "722Y001:0101000", status: "INSUFFICIENT_DATA" }),
    ]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: partial,
        configuredCount: 3,
        freshness: { state: "FRESH", daysSinceLastObservation: 3 },
      })!,
    );
    expect(result.dimensions.data_completeness.status).toBe("FAIL");
    expect(result.dimensions.data_completeness.rationale).toContain("1 of 3");
    expect(result.verdict).toBe("TRUNCATED");
  });

  it("passes completeness when every configured series reported", () => {
    const full = axis([reading(), reading({ externalId: "DGS2", value: 3.9 })]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: full,
        configuredCount: 2,
        freshness: { state: "FRESH", daysSinceLastObservation: 1 },
      })!,
    );
    expect(result.dimensions.data_completeness.status).toBe("PASS");
  });
});

describe("cross_source_consistency, on the only output that can reach it", () => {
  /**
   * Every other adapter feeds Verify a single-source output, so this dimension has only ever
   * returned "single source, nothing to reconcile against" — true, and never tested against
   * anything else. This is the shape RATES takes the moment a FRED key exists.
   */
  it("owes a reconciliation once two providers cover one axis", () => {
    const mixed = axis([
      reading(),
      reading({
        sourceCode: "ECOS",
        externalId: "722Y001:0101000",
        value: 2.75,
        direction: "DOWN",
      }),
    ]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: mixed,
        configuredCount: 2,
        freshness: { state: "FRESH", daysSinceLastObservation: 1 },
      })!,
    );
    expect(result.dimensions.cross_source_consistency.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.dimensions.cross_source_consistency.rationale).toContain("2 sources");
    // Not silently VERIFIED: two providers covering one dimension must be compared, not assumed
    // to agree.
    expect(result.verdict).not.toBe("VERIFIED");
  });

  it("stands down honestly when one provider supplies the whole axis", () => {
    const single = axis([reading(), reading({ externalId: "DGS2", value: 3.9 })]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: single,
        configuredCount: 2,
        freshness: { state: "FRESH", daysSinceLastObservation: 1 },
      })!,
    );
    expect(result.dimensions.cross_source_consistency.status).toBe("NOT_APPLICABLE");
  });
});

describe("an axis is only as current as its stalest input", () => {
  it("reports STALE when the caller found a stale reading in the axis", () => {
    const full = axis([reading(), reading({ externalId: "DGS2", value: 3.9 })]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: full,
        configuredCount: 2,
        freshness: { state: "STALE", daysSinceLastObservation: 400 },
      })!,
    );
    expect(result.dimensions.temporal_integrity.status).toBe("FAIL");
    expect(result.verdict).toBe("STALE");
  });

  it("does not claim currency when freshness could not be established", () => {
    const full = axis([reading(), reading({ externalId: "DGS2", value: 3.9 })]);
    const result = verify(
      verificationInputFromRegimeAxis({
        axis: full,
        configuredCount: 2,
        freshness: { state: "UNKNOWN", daysSinceLastObservation: null },
      })!,
    );
    expect(result.dimensions.temporal_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
  });
});
