import { describe, expect, it } from "vitest";
import { verify } from "@/server/verify/evaluate";
import {
  verificationInputFromSeriesChange,
  type ObservationEvidence,
  type SeriesChangeEvidence,
} from "@/server/verify/fromSeriesChange";

/**
 * Verify against the second real output shape.
 *
 * The evaluators were built against Filing Diff, so until now every dimension had been exercised
 * by one output type — the fixture-realism failure this project keeps finding, pointed at the
 * verifier itself. These cases are about what the macro path does DIFFERENTLY: instants instead of
 * spans, and no filing identity to settle which version of a value is current.
 */

const observation = (
  date: string,
  value: number,
  extra: Partial<ObservationEvidence> = {},
): ObservationEvidence => ({
  observationDate: new Date(`${date}T00:00:00.000Z`),
  releaseDate: null,
  retrievedAt: new Date("2026-08-18T00:00:00.000Z"),
  value,
  isRevision: false,
  ...extra,
});

const evidence = (overrides: Partial<SeriesChangeEvidence> = {}): SeriesChangeEvidence => ({
  seriesName: "US 10Y Treasury Yield",
  externalId: "DGS10",
  unit: "percent",
  sourceCode: "FRED",
  current: observation("2026-08-01", 4.25),
  previous: observation("2026-07-01", 4.0),
  claimedAbsoluteChange: 0.25,
  claimedPercentChange: 6.25,
  staleness: "FRESH",
  daysSinceLastObservation: 17,
  observationCount: 24,
  ...overrides,
});

describe("verificationInputFromSeriesChange", () => {
  it("treats two readings as instants, not as zero-length spans", () => {
    const result = verify(verificationInputFromSeriesChange(evidence()));
    expect(result.dimensions.semantic_consistency.status).toBe("PASS");
    expect(result.dimensions.semantic_consistency.rationale).toContain("at a point in time");
    // The failure mode being excluded: a span check that reports on a span that does not exist.
    expect(result.dimensions.semantic_consistency.rationale).not.toContain("null-month");
  });

  /**
   * The point of taking both values from the observation pair.
   *
   * If the adapter derived the previous value by subtracting the claimed change from the current
   * one, `calculation_integrity` would recompute the claim from the claim and pass unconditionally
   * — a verifier that cannot fail is not a verifier. A wrong claim over right data must fail.
   */
  it("catches a claimed change that the two stored values do not support", () => {
    const result = verify(
      verificationInputFromSeriesChange(
        evidence({ claimedAbsoluteChange: 0.9, claimedPercentChange: 22.5 }),
      ),
    );
    expect(result.dimensions.calculation_integrity.status).toBe("FAIL");
    expect(result.verdict).toBe("REJECTED");
  });

  it("withholds a percent change when the previous reading is zero", () => {
    const result = verify(
      verificationInputFromSeriesChange(
        evidence({
          previous: observation("2026-07-01", 0),
          claimedAbsoluteChange: 4.25,
          claimedPercentChange: null,
        }),
      ),
    );
    expect(result.dimensions.calculation_integrity.status).toBe("PASS");
  });

  it("reports a series past its own cadence as STALE", () => {
    const result = verify(
      verificationInputFromSeriesChange(
        evidence({ staleness: "STALE", daysSinceLastObservation: 400 }),
      ),
    );
    expect(result.dimensions.temporal_integrity.status).toBe("FAIL");
    expect(result.verdict).toBe("STALE");
  });
});

describe("the macro path and the version question", () => {
  /**
   * The difference that matters between this output shape and Filing Diff. An SEC figure names the
   * filing it came from, so which version is current follows from that identity. A macro
   * observation names nothing, and v1 resolves it by ingest order — IR-021.
   */
  it("leaves the version question open where nothing identifies the version", () => {
    const result = verify(verificationInputFromSeriesChange(evidence()));
    expect(result.dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.verdict).toBe("SEMANTIC_REVISION_UNRESOLVED");
  });

  it("settles it when the provider dated both versions", () => {
    const result = verify(
      verificationInputFromSeriesChange(
        evidence({
          current: observation("2026-08-01", 4.25, {
            isRevision: true,
            releaseDate: new Date("2026-08-15T00:00:00.000Z"),
          }),
          supersededByCurrent: observation("2026-08-01", 4.2, {
            releaseDate: new Date("2026-08-05T00:00:00.000Z"),
          }),
        }),
      ),
    );
    expect(result.dimensions.revision_integrity.status).toBe("PASS");
    expect(result.verdict).not.toBe("SEMANTIC_REVISION_UNRESOLVED");
  });

  it("rejects a reading that replaced a value the provider released later", () => {
    const result = verify(
      verificationInputFromSeriesChange(
        evidence({
          current: observation("2026-08-01", 4.25, {
            isRevision: true,
            releaseDate: new Date("2026-08-05T00:00:00.000Z"),
          }),
          supersededByCurrent: observation("2026-08-01", 4.2, {
            releaseDate: new Date("2026-08-15T00:00:00.000Z"),
          }),
        }),
      ),
    );
    expect(result.dimensions.revision_integrity.status).toBe("FAIL");
    expect(result.verdict).toBe("REJECTED");
  });

  /**
   * A supersession that was never fetched must not read as a supersession that never happened.
   * The adapter emits no `revision` block rather than a placeholder, so the dimension reports the
   * question as open instead of quietly answering it.
   */
  it("does not treat an unfetched superseded row as an absence of supersession", () => {
    const revised = evidence({
      current: observation("2026-08-01", 4.25, { isRevision: true }),
      supersededByCurrent: null,
    });
    const input = verificationInputFromSeriesChange(revised);
    expect(input.revision).toBeUndefined();
    expect(verify(input).dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
  });
});
