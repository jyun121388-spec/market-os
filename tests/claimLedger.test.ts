import { describe, expect, it } from "vitest";
import {
  assertValidClaim,
  formatClaimForDisplay,
  InvalidClaimError,
} from "@/server/domain/claimLedger";

describe("claim ledger invariants", () => {
  it("rejects a FACT claim without a source", () => {
    expect(() =>
      assertValidClaim({ claimText: "US CPI rose 0.3% in July", claimType: "FACT" }),
    ).toThrow(InvalidClaimError);
  });

  it("accepts a FACT claim with a source", () => {
    expect(() =>
      assertValidClaim({
        claimText: "US CPI rose 0.3% in July",
        claimType: "FACT",
        sourceId: "src_bls",
      }),
    ).not.toThrow();
  });

  it("rejects a CALCULATION claim without evidence", () => {
    expect(() =>
      assertValidClaim({ claimText: "10Y-2Y spread is 45bps", claimType: "CALCULATION" }),
    ).toThrow(InvalidClaimError);
  });

  it("rejects an INFERENCE claim without a confidence score", () => {
    expect(() =>
      assertValidClaim({ claimText: "This suggests rate cuts are likely", claimType: "INFERENCE" }),
    ).toThrow(InvalidClaimError);
  });

  it("rejects an out-of-range confidence score", () => {
    expect(() =>
      assertValidClaim({
        claimText: "This suggests rate cuts are likely",
        claimType: "INFERENCE",
        confidence: 1.5,
      }),
    ).toThrow(InvalidClaimError);
  });

  it("rejects empty claim text", () => {
    expect(() =>
      assertValidClaim({ claimText: "   ", claimType: "FACT", sourceId: "src_bls" }),
    ).toThrow(InvalidClaimError);
  });

  it("formats a valid claim with its type label", () => {
    const text = formatClaimForDisplay({
      claimText: "US CPI rose 0.3% in July",
      claimType: "FACT",
      sourceId: "src_bls",
    });
    expect(text).toBe("[FACT] US CPI rose 0.3% in July");
  });

  describe("write-time invariants that a range check cannot express", () => {
    it("refuses NaN confidence, which passes both halves of a range comparison", () => {
      // IR-095 candidate J. `NaN < 0` and `NaN > 1` are each false, so the range check accepted it,
      // createClaim persisted it, and formatClaimForDisplay rendered it. PostgreSQL stores NaN in a
      // double precision column, so this was reachable from real data rather than theoretical.
      expect(() =>
        assertValidClaim({
          claimText: "this suggests further easing",
          claimType: "INFERENCE",
          confidence: NaN,
        }),
      ).toThrow(InvalidClaimError);
    });

    it.each([Infinity, -Infinity])("refuses %s confidence", (confidence) => {
      expect(() =>
        assertValidClaim({ claimText: "x", claimType: "INFERENCE", confidence }),
      ).toThrow(InvalidClaimError);
    });

    it("still accepts a finite confidence at the boundaries", () => {
      for (const confidence of [0, 1, 0.5]) {
        expect(() =>
          assertValidClaim({ claimText: "x", claimType: "INFERENCE", confidence }),
        ).not.toThrow();
      }
    });
  });

  describe("storing a claim and publishing it are different permissions", () => {
    const inference = {
      claimText: "this suggests further easing",
      claimType: "INFERENCE" as const,
      confidence: 0.6,
    };

    it("stores an unverified INFERENCE — the ledger is an audit record", () => {
      // Deliberately permissive. Refusing to record a producer's output would destroy the evidence
      // that the producer misbehaved.
      expect(() => assertValidClaim(inference)).not.toThrow();
    });

    it("cannot publish an INFERENCE at all, whatever the caller passes", () => {
      // IR-095 candidate K made this require a verdict; IR-100 showed a caller-supplied verdict is
      // not an authority — forgeable, reusable across claims, and survivable across a mutation. So
      // there is no argument that makes this function publish an inference. The route is
      // `publishClaimForDisplay(claimId)`, which verifies the row it renders.
      expect(() => formatClaimForDisplay(inference)).toThrow(InvalidClaimError);
      expect(() => formatClaimForDisplay(inference)).toThrow(/publishClaimForDisplay/);
    });

    it("has no parameter a caller could use to vouch for an inference", () => {
      // Structural: the signature is the boundary. A second parameter would be the forgeable
      // channel coming back, whatever it was named or branded.
      expect(formatClaimForDisplay.length).toBe(1);
    });

    it("leaves FACT and CALCULATION publication unchanged", () => {
      expect(
        formatClaimForDisplay({
          claimText: "US CPI rose 0.3% in July",
          claimType: "FACT",
          sourceId: "src_bls",
        }),
      ).toBe("[FACT] US CPI rose 0.3% in July");
    });
  });
});
