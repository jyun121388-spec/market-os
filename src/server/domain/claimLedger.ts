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
    // Finiteness before the range, because NaN passes BOTH halves of a range comparison — every
    // comparison with NaN is false — and PostgreSQL stores it happily in a double precision
    // column. `assertValidClaim` accepted it, `createClaim` persisted it, and
    // `formatClaimForDisplay` rendered it (IR-095 candidate J). Infinity was already caught by the
    // range; NaN never was, and it is the one a producer bug actually emits.
    if (!Number.isFinite(claim.confidence)) {
      throw new InvalidClaimError(
        "confidence must be a finite number; NaN and Infinity are not confidences",
      );
    }
    if (claim.confidence < 0 || claim.confidence > 1) {
      throw new InvalidClaimError("confidence must be between 0 and 1");
    }
  }
}

/**
 * The three boundaries, which had silently become one.
 *
 * `WRITE` is permissive on purpose: the ledger stores a claim so it can be audited, and refusing
 * to record a producer's output would destroy the evidence that the producer misbehaved.
 * `PUBLISH` is not, and until IR-095 nothing said so — `formatClaimForDisplay` called
 * `assertValidClaim` and rendered whatever passed, so an INFERENCE that had never been verified
 * was one function call from a user, and a NaN-confidence one actually rendered.
 *
 *     WRITE_ALLOWED     the ledger invariants hold; store it, verified or not
 *     VERIFY_ALLOWED    verifyClaim may examine anything that was stored
 *     PUBLISH_ALLOWED   a FACT or CALCULATION that passed its invariants, or an INFERENCE that
 *                       has a VERIFIED verdict from verifyClaim
 *
 * Persistence is not evidence of publication safety, and the type system now says so: publishing
 * an inference requires a verdict argument that only the verifier produces.
 */
export type PublicationVerdict = "VERIFIED" | "NOT_VERIFIED";

/**
 * Renders a claim for presentation, always prefixed with its type label.
 *
 * An INFERENCE requires `verdict: "VERIFIED"`, which the caller can only honestly obtain from
 * `verifyClaim`. FACT and CALCULATION are unchanged: their invariants are structural and
 * `assertValidClaim` is the whole of what publication needs from this function.
 */
export function formatClaimForDisplay(claim: ClaimInput, verdict?: PublicationVerdict): string {
  assertValidClaim(claim);
  if (claim.claimType === "INFERENCE" && verdict !== "VERIFIED") {
    throw new InvalidClaimError(
      "An INFERENCE may not be displayed without a VERIFIED verdict from verifyClaim. Storing a " +
        "claim and publishing it are different permissions; passing the ledger's write invariants " +
        "is not evidence that the inference traces to anything.",
    );
  }
  return `[${claim.claimType}] ${claim.claimText}`;
}
