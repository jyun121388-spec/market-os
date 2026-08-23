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

    it("refuses to DISPLAY an INFERENCE with no verification verdict", () => {
      // IR-095 candidate K. `formatClaimForDisplay` called `assertValidClaim` and rendered whatever
      // passed, so persistence was standing in for publication safety. It no longer can: the
      // verdict argument is obtainable only from verifyClaim.
      expect(() => formatClaimForDisplay(inference)).toThrow(InvalidClaimError);
      expect(() => formatClaimForDisplay(inference, "NOT_VERIFIED")).toThrow(InvalidClaimError);
    });

    it("displays an INFERENCE once it carries a VERIFIED verdict", () => {
      expect(formatClaimForDisplay(inference, "VERIFIED")).toBe(
        "[INFERENCE] this suggests further easing",
      );
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
