/**
 * Claim Ledger invariants (docs/ARCHITECTURE.md "Claim Ledger").
 *
 * A FACT-typed claim with no source must never be presented to a user as
 * fact. This module is the single place that enforces that rule so it can't
 * be bypassed by a presentation-layer bug.
 */

export type ClaimType = "FACT" | "CALCULATION" | "INFERENCE";

export interface ClaimInput {
  claimText: string;
  claimType: ClaimType;
  sourceId?: string | null;
  evidence?: unknown;
  confidence?: number | null;
}

export class InvalidClaimError extends Error {}

/**
 * Validates a claim against Claim Ledger invariants before it is persisted
 * or rendered. Throws InvalidClaimError rather than silently downgrading
 * the claim, so a caller can never accidentally show an unsourced FACT.
 */
export function assertValidClaim(claim: ClaimInput): void {
  if (!claim.claimText.trim()) {
    throw new InvalidClaimError("claimText must not be empty");
  }

  if (claim.claimType === "FACT" && !claim.sourceId) {
    throw new InvalidClaimError(
      "FACT claims must have a sourceId; unsourced statements must be typed as INFERENCE",
    );
  }

  if (claim.claimType === "CALCULATION" && claim.evidence === undefined) {
    throw new InvalidClaimError(
      "CALCULATION claims must include evidence (the inputs used to derive the value)",
    );
  }

  if (claim.claimType === "INFERENCE") {
    if (claim.confidence === undefined || claim.confidence === null) {
      throw new InvalidClaimError("INFERENCE claims must include a confidence score");
    }
    if (claim.confidence < 0 || claim.confidence > 1) {
      throw new InvalidClaimError("confidence must be between 0 and 1");
    }
  }
}

/** Renders a claim for presentation, always prefixed with its type label. */
export function formatClaimForDisplay(claim: ClaimInput): string {
  assertValidClaim(claim);
  return `[${claim.claimType}] ${claim.claimText}`;
}
