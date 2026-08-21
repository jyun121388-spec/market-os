import { describe, expect, it } from "vitest";
import { PROVIDER_CAPABILITIES, capabilityOf } from "@/server/fabric/providerCapability";
import {
  absentVintage,
  compareVintage,
  knownVintage,
  vintageUnavailable,
  type ProviderVintage,
} from "@/server/fabric/vintage";
import { verify } from "@/server/verify/evaluate";
import type { VerificationInput } from "@/server/verify/types";

/**
 * The provider-vintage contract, tested against IR-021 — the defect that produced it.
 *
 * IR-021 in one line: a replayed stale figure became the current value because it arrived last.
 * The v1 guard rejects any value already seen earlier in the chain, which stops the replay and
 * ALSO stops a provider genuinely correcting back to a figure it published before. The two are
 * indistinguishable without the provider's own vintage, and the point of these tests is that the
 * contract must say so rather than guess.
 */

const at = (iso: string, basis = "test"): ProviderVintage => ({
  providerRevisionId: absentVintage("NOT_PROVIDED", basis),
  providerVintageAt: knownVintage(iso, basis),
  sourceReleasedAt: absentVintage("UNKNOWN", basis),
  sourceEffectiveAt: absentVintage("NOT_PROVIDED", basis),
  retrievedAt: "2026-08-18T00:00:00.000Z",
});

describe("compareVintage", () => {
  it("orders on the provider's own vintage when it is stated", () => {
    expect(compareVintage(at("2026-03-01"), at("2026-04-01")).verdict).toBe("CANDIDATE_IS_NEWER");
    expect(compareVintage(at("2026-04-01"), at("2026-03-01")).verdict).toBe("CANDIDATE_IS_OLDER");
    expect(compareVintage(at("2026-04-01"), at("2026-04-01")).verdict).toBe("SAME_VINTAGE");
  });

  it("falls back to release time, but no further", () => {
    const released = (iso: string): ProviderVintage => ({
      ...at("unused"),
      providerVintageAt: absentVintage("NOT_PROVIDED", "test"),
      sourceReleasedAt: knownVintage(iso, "test"),
    });
    expect(compareVintage(released("2026-03-01"), released("2026-04-01")).verdict).toBe(
      "CANDIDATE_IS_NEWER",
    );
  });

  /**
   * The negative control, and the reason the module exists.
   *
   * The candidate was retrieved eight days later and carries no vintage. Every field that would
   * settle the question is absent, and the ONE field that is present is the very one IR-021
   * proved untrustworthy. If this ever returns CANDIDATE_IS_NEWER, the defect has been rebuilt
   * inside the contract meant to prevent it.
   */
  it("never lets retrieval order decide", () => {
    const decision = compareVintage(
      vintageUnavailable("FRED", "2026-08-10T00:00:00.000Z"),
      vintageUnavailable("FRED", "2026-08-18T00:00:00.000Z"),
    );
    expect(decision.verdict).toBe("UNRESOLVED");
    expect(decision.rationale).toContain("Retrieval order is not semantic recency");
  });

  it("names why it could not decide, rather than returning a bare verdict", () => {
    const secStyle = vintageUnavailable("SEC_EDGAR", "2026-08-18T00:00:00.000Z");
    expect(compareVintage(secStyle, secStyle).rationale).toContain(
      "the provider does not publish a vintage",
    );
    const fredStyle = vintageUnavailable("FRED", "2026-08-18T00:00:00.000Z");
    expect(compareVintage(fredStyle, fredStyle).rationale).toContain("unverified");
  });
});

describe("provider capability table", () => {
  /**
   * No provider may be recorded as KNOWN for a field nobody has seen in a real response. FRED's
   * `realtime_start` is declared in the client types and is exactly the field this contract wants,
   * which makes it the most tempting thing in the repo to mark KNOWN — and HG-002 means no live
   * response has ever been observed.
   */
  it("claims KNOWN only where a live response confirmed it", () => {
    expect(capabilityOf("FRED", "provider_vintage_time")?.state).toBe("NOT_VERIFIED");
    for (const profile of PROVIDER_CAPABILITIES) {
      if (profile.sourceCode === "SEC_EDGAR") continue;
      expect(profile.axes.provider_vintage_time.state).not.toBe("SUPPORTED");
    }
  });

  it("distinguishes 'we never stored it' from 'the provider never publishes it'", () => {
    const sec = vintageUnavailable("SEC_EDGAR", "2026-08-18T00:00:00.000Z");
    // SEC issues accession numbers, so their absence here is OUR gap — a work item.
    expect(sec.providerRevisionId.availability).toBe("UNKNOWN");
    // SEC publishes no per-figure vintage, so there is nothing to go and fetch.
    expect(sec.providerVintageAt.availability).toBe("NOT_PROVIDED");
    expect(sec.providerRevisionId.basis).toContain("SEC_EDGAR");
  });

  it("does not invent a capability for a provider it has never heard of", () => {
    const unknownProvider = vintageUnavailable("BLOOMBERG", "2026-08-18T00:00:00.000Z");
    expect(unknownProvider.providerVintageAt.availability).toBe("UNKNOWN");
    expect(unknownProvider.providerVintageAt.value).toBeUndefined();
  });
});

const observationOutput = (revision: VerificationInput["revision"]): VerificationInput => ({
  outputId: "observation:FRED:GDPC1",
  claimType: "FACT",
  sourceCodes: ["FRED"],
  revision,
});

describe("Verify — revision_integrity against the IR-021 cases", () => {
  /**
   * CASE A — the stale replay. A CDN serves the superseded 100 after the corrected 110 has
   * already been published. With the provider's vintage present this is not ambiguous at all: the
   * figure on the page is an older version than the one it displaced.
   */
  it("Case A: rejects a value that is provably an older provider version", () => {
    const result = verify(
      observationOutput({
        superseded: at("2026-04-01T00:00:00Z"),
        applied: at("2026-03-01T00:00:00Z"),
        valueRepeatsEarlierInChain: true,
      }),
    );
    expect(result.dimensions.revision_integrity.status).toBe("FAIL");
    expect(result.dimensions.revision_integrity.rationale).toContain("superseded figure");
    expect(result.verdict).toBe("REJECTED");
  });

  /**
   * CASE B — the false positive the v1 guard cannot avoid. The provider genuinely re-corrects
   * back to a figure it published before, so the value repeats earlier in the chain exactly as a
   * replay would. v1 must ignore it; with vintage evidence, Verify can tell them apart and say so.
   */
  it("Case B: accepts a re-correction when the provider vintage proves it is newer", () => {
    const result = verify(
      observationOutput({
        superseded: at("2026-04-01T00:00:00Z"),
        applied: at("2026-05-01T00:00:00Z"),
        valueRepeatsEarlierInChain: true,
      }),
    );
    expect(result.dimensions.revision_integrity.status).toBe("PASS");
    // Not VERIFIED, and deliberately not asserted as such: a bare FACT leaves completeness and
    // advice-shape open for reasons that have nothing to do with revisions. The claim this case
    // makes is narrower and is exactly what is asserted — the version question is CLOSED, so the
    // verdict must not be the one that says it is open.
    expect(result.verdict).not.toBe("SEMANTIC_REVISION_UNRESOLVED");
  });

  /**
   * CASE C — today. No adapter populates any vintage field, so A and B are the same input, and
   * the honest answer is that the question is open. Fabricating either verdict here is the failure
   * this whole layer is built to refuse.
   */
  it("Case C: reports SEMANTIC_REVISION_UNRESOLVED when no vintage evidence exists", () => {
    const noVintage = vintageUnavailable("FRED", "2026-08-18T00:00:00.000Z");
    const result = verify(
      observationOutput({
        superseded: noVintage,
        applied: noVintage,
        valueRepeatsEarlierInChain: true,
      }),
    );
    expect(result.dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.dimensions.revision_integrity.rationale).toContain("signature of a stale replay");
    expect(result.verdict).toBe("SEMANTIC_REVISION_UNRESOLVED");
  });

  it("rejects two different values sharing one provider vintage", () => {
    const result = verify(
      observationOutput({
        superseded: at("2026-04-01T00:00:00Z"),
        applied: at("2026-04-01T00:00:00Z"),
      }),
    );
    expect(result.dimensions.revision_integrity.status).toBe("FAIL");
    expect(result.verdict).toBe("REJECTED");
  });
});

describe("Verify — revision_integrity applicability", () => {
  const filingSide = (end: string, accession: string) => ({
    label: "Revenues",
    value: end === "2026-03-28" ? 90_000 : 100_000,
    unit: "USD",
    sourceCode: "SEC_EDGAR",
    entityRef: "0000320193",
    concept: "Revenues",
    period: { start: null, end, months: 3, days: 91 },
    accessionNumber: accession,
    // Filing Diff ranks every held version before choosing; an accession alone does not settle
    // which version is current (IR-025).
    isMostCurrentHeldVersion: true,
  });

  /**
   * The applicability rule has to be earned from the input, or every SEC output turns
   * SEMANTIC_REVISION_UNRESOLVED and the verifier goes back to giving one answer for everything —
   * the uniform-verdict failure this layer has already produced twice.
   */
  it("does not apply where each figure names the filing it was read from", () => {
    const result = verify({
      outputId: "filingDiff:0000320193:Revenues:USD",
      claimType: "CALCULATION",
      sourceCodes: ["SEC_EDGAR"],
      calculation: {
        kind: "PERIOD_OVER_PERIOD_CHANGE",
        current: filingSide("2026-06-27", "0000320193-26-000070"),
        previous: filingSide("2026-03-28", "0000320193-26-000050"),
        claimedAbsoluteChange: 10_000,
        claimedPercentChange: 11.1111,
      },
      completeness: { providerTotal: null, fetched: 1431, truncated: false },
    });
    expect(result.dimensions.revision_integrity.status).toBe("NOT_APPLICABLE");
    expect(result.dimensions.revision_integrity.rationale).toContain("0000320193-26-000070");
    expect(result.verdict).toBe("VERIFIED_WITH_LIMITATION");
  });

  it("reports the gap where nothing identifies the version", () => {
    const result = verify({
      outputId: "observation:FRED:GDPC1",
      claimType: "FACT",
      sourceCodes: ["FRED"],
    });
    expect(result.dimensions.revision_integrity.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.verdict).toBe("SEMANTIC_REVISION_UNRESOLVED");
  });
});
