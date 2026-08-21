import { describe, expect, it } from "vitest";
import {
  absentVintage,
  compareVintage,
  knownVintage,
  withStoredReleaseDate,
  vintageUnavailable,
  type ProviderVintage,
} from "@/server/fabric/vintage";
import { classifyEvidenceGap } from "@/server/fabric/providerCapability";
import { evaluateAction, observeExecution } from "@/server/governance/policy";
import { verify } from "@/server/verify/evaluate";
import {
  verificationInputFromSeriesChange,
  type ObservationEvidence,
  type SeriesChangeEvidence,
} from "@/server/verify/fromSeriesChange";

/**
 * Independent review of the shadow layers by `gpt-5.6-terra`, 2026-08-18.
 *
 * Five findings, all reproduced against the running code before anything was changed, and all
 * five valid — which is worth recording precisely because the last two rounds of model review
 * produced a fabricated reproduction (IR-020) and four worthless local findings. A reviewer being
 * wrong before does not make it wrong now, and a reviewer being right now does not make it an
 * authority. Each finding below was run first.
 *
 * Every test pairs the defect with a positive control, because four of the five fixes narrow
 * something, and a narrowing that goes too far produces a layer that answers "cannot tell" to
 * everything — a failure this project has already caused itself twice.
 */

const vintage = (providerVintageAt: string | null, released: string | null): ProviderVintage => ({
  providerRevisionId: absentVintage("NOT_PROVIDED", "test"),
  providerVintageAt: providerVintageAt
    ? knownVintage(providerVintageAt, "test")
    : absentVintage("UNKNOWN", "test"),
  sourceReleasedAt: released ? knownVintage(released, "test") : absentVintage("UNKNOWN", "test"),
  sourceEffectiveAt: absentVintage("NOT_PROVIDED", "test"),
  retrievedAt: "2026-08-18T00:00:00.000Z",
});

describe("TERRA-1 — a stored release date is not evidence until its meaning is confirmed", () => {
  /**
   * Both `fromSeriesChange` and `shadowProjection` promoted a stored `Observation.releaseDate` to
   * KNOWN for any provider, while the capability matrix says FRED's, ECOS's and DART's release
   * semantics have never been seen in a real response. Holding a value and understanding it are
   * different things, and the unverified one was strong enough to flip `revision_integrity` to
   * PASS.
   */
  const observation = (
    value: number,
    releaseDate: string | null,
    isRevision = false,
  ): ObservationEvidence => ({
    observationDate: new Date("2026-08-01T00:00:00.000Z"),
    releaseDate: releaseDate ? new Date(releaseDate) : null,
    retrievedAt: new Date("2026-08-18T00:00:00.000Z"),
    value,
    isRevision,
  });

  const revisedSeries = (sourceCode: string): SeriesChangeEvidence => ({
    seriesName: "Unemployment Rate",
    externalId: "UNRATE",
    unit: "percent",
    sourceCode,
    current: observation(4.25, "2026-08-15T00:00:00.000Z", true),
    previous: {
      ...observation(4.0, null),
      observationDate: new Date("2026-07-01T00:00:00.000Z"),
    },
    supersededByCurrent: observation(4.2, "2026-08-05T00:00:00.000Z"),
    claimedAbsoluteChange: 0.25,
    claimedPercentChange: 6.25,
    staleness: "FRESH",
    daysSinceLastObservation: 3,
    observationCount: 12,
  });

  it("does not order two FRED readings on a field FRED has never been seen returning", () => {
    const input = verificationInputFromSeriesChange(revisedSeries("FRED"));
    expect(input.revision?.applied.sourceReleasedAt.availability).toBe("NOT_VERIFIED");
    expect(verify(input).dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("still records the value it holds, so nothing is thrown away", () => {
    const input = verificationInputFromSeriesChange(revisedSeries("FRED"));
    expect(input.revision?.applied.sourceReleasedAt.basis).toContain("2026-08-15");
  });

  it("accepts the same field where a live response confirmed the provider's semantics", () => {
    // The positive control. SEC's `filed` date IS live-verified, so a stored release date from
    // SEC is evidence and must remain usable — the fix narrows by provenance, not by blanket
    // distrust.
    const sec = withStoredReleaseDate(
      vintageUnavailable("SEC_EDGAR", "2026-08-18T00:00:00.000Z"),
      "SEC_EDGAR",
      "2026-08-15T00:00:00.000Z",
    );
    expect(sec.sourceReleasedAt.availability).toBe("KNOWN");
    expect(sec.sourceReleasedAt.value).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("TERRA-2 — 'permitted subject to verification' recorded as simply done", () => {
  /**
   * `observeExecution` refused to record a DENIED action as EXECUTED but happily recorded one
   * that was AUTO_ALLOWED_WITH_VERIFY, with no statement that the verification had passed. The
   * condition is part of the permission, so an outcome that omits it is not evidence the action
   * was allowed — the same hole as the DENIED case, one decision further along.
   */
  it("refuses an EXECUTED record that does not name what satisfied the condition", () => {
    const refactor = evaluateAction({ kind: "REFACTOR" });
    expect(refactor.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(refactor.requiredVerification.length).toBeGreaterThan(0);
    expect(() => observeExecution(refactor, "EXECUTED", "changed code")).toThrow(
      /without naming what satisfied/,
    );
  });

  it("accepts it once the verification is named", () => {
    const refactor = evaluateAction({ kind: "REFACTOR" });
    const record = observeExecution(
      refactor,
      "EXECUTED",
      "extracted a comparator",
      "596/596 + build",
    );
    expect(record.outcome).toBe("EXECUTED");
    expect(record.verifiedBy).toBe("596/596 + build");
  });

  it("leaves unconditional permissions alone", () => {
    // ADD_TEST is AUTO_ALLOWED with nothing required, so demanding an attestation would be
    // ceremony rather than governance.
    const addTest = evaluateAction({ kind: "ADD_TEST" });
    expect(addTest.decision).toBe("AUTO_ALLOWED");
    expect(observeExecution(addTest, "EXECUTED", "added a regression test").outcome).toBe(
      "EXECUTED",
    );
  });

  it("still refuses to record a denied action as executed", () => {
    const denied = evaluateAction({ kind: "PERSONALIZED_ADVICE_OUTPUT" });
    expect(() => observeExecution(denied, "EXECUTED", "shipped", "everything green")).toThrow();
  });
});

describe("TERRA-3 — the vintage rungs are not interchangeable", () => {
  /**
   * `compareVintage` dropped to release time whenever the two sides did not BOTH carry a vintage.
   * Reproduced: current with vintage 2026-06-01 and release 2026-01-01, candidate with no vintage
   * and release 2026-02-01, returned CANDIDATE_IS_NEWER — while the stronger evidence held says
   * the current value became current four months after the candidate was published.
   */
  it("refuses to answer from release time while holding a vintage on one side", () => {
    const decision = compareVintage(
      vintage("2026-06-01", "2026-01-01"),
      vintage(null, "2026-02-01"),
    );
    expect(decision.verdict).toBe("UNRESOLVED");
    expect(decision.rationale).toContain("weaker evidence");
  });

  it("is symmetric — the same gap in the other direction is equally unresolvable", () => {
    expect(
      compareVintage(vintage(null, "2026-01-01"), vintage("2026-06-01", "2026-02-01")).verdict,
    ).toBe("UNRESOLVED");
  });

  it("still uses release time when neither side has a vintage at all", () => {
    // The positive control, and the reason this is a narrowing rather than a removal. With no
    // vintage anywhere, release time is the best evidence available and comparing it is sound.
    expect(compareVintage(vintage(null, "2026-01-01"), vintage(null, "2026-02-01")).verdict).toBe(
      "CANDIDATE_IS_NEWER",
    );
  });

  it("still uses vintage when both sides have one", () => {
    expect(compareVintage(vintage("2026-01-01", null), vintage("2026-02-01", null)).verdict).toBe(
      "CANDIDATE_IS_NEWER",
    );
  });
});

describe("TERRA-4 — an accession names a filing, not the current version", () => {
  /**
   * `revision_integrity` returned NOT_APPLICABLE whenever both figures carried an accession, on
   * the reasoning that filing identity settles which version is shown. It does not: a figure
   * restated by a later 10-K/A still carries the accession of the filing it was first reported
   * in. The dimension was standing down for exactly the case it exists to catch.
   */
  const side = (end: string, value: number, accession: string, ranked?: boolean) => ({
    label: "Revenues",
    value,
    unit: "USD",
    sourceCode: "SEC_EDGAR",
    entityRef: "0000320193",
    concept: "Revenues",
    period: { start: null, end, months: 3, days: 91 },
    accessionNumber: accession,
    isMostCurrentHeldVersion: ranked,
  });

  const diff = (ranked?: boolean) => ({
    outputId: "filingDiff:0000320193:Revenues:USD",
    claimType: "CALCULATION" as const,
    sourceCodes: ["SEC_EDGAR"],
    calculation: {
      kind: "PERIOD_OVER_PERIOD_CHANGE" as const,
      current: side("2026-06-27", 100_000, "0000320193-26-000070", ranked),
      previous: side("2026-03-28", 90_000, "0000320193-26-000050", ranked),
      claimedAbsoluteChange: 10_000,
      claimedPercentChange: 11.1111,
    },
    completeness: { providerTotal: null, fetched: 1431, truncated: false },
  });

  it("leaves the version question open when nobody ranked the held versions", () => {
    const result = verify(diff());
    expect(result.dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.dimensions.revision_integrity.rationale).toContain("later amendment");
    expect(result.verdict).toBe("SEMANTIC_REVISION_UNRESOLVED");
  });

  it("stands down once the adapter states each side is the most current version held", () => {
    // The positive control, and the one that matters: `filingDiff` DOES rank every held fact
    // through the shared `compareFactCurrency`, so the real product output still resolves. If
    // this ever flips, all eight real SEC outputs collapse to one verdict.
    const result = verify(diff(true));
    expect(result.dimensions.revision_integrity.status).toBe("NOT_APPLICABLE");
    expect(result.verdict).toBe("VERIFIED_WITH_LIMITATION");
  });
});

describe("TERRA-5 — a conditional absence is not a checked condition", () => {
  /**
   * `classifyEvidenceGap` reported CONDITIONAL_ABSENCE without being given anything that could
   * establish whether this record met the condition. The classification stays — it is still the
   * best available — but it no longer implies a check that did not happen.
   */
  it("says the condition went unevaluated rather than implying it was met", () => {
    const gap = classifyEvidenceGap("SEC_EDGAR", "period_start", false);
    expect(gap.kind).toBe("CONDITIONAL_ABSENCE");
    expect(gap.rationale).toContain("not evaluated here");
  });
});
