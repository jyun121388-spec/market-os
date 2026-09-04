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
 *                       `publishClaimForDisplay` has just verified for itself
 *
 * Persistence is not evidence of publication safety, and neither is a caller saying so. The
 * boundary obtains its own authority for the exact stored state it renders; nothing about it is
 * passed in.
 */
/**
 * Renders a claim for presentation, always prefixed with its type label.
 *
 * **This function cannot publish an INFERENCE, and there is no argument that makes it able to.**
 *
 * It briefly took a `verdict` parameter that the caller supplied, and a third-order review took
 * that apart in four ways (IR-100): a caller could pass the literal `"VERIFIED"` without ever
 * running the verifier; a verdict obtained for claim A published claim B; a verdict obtained
 * before a claim was mutated still published it afterwards; and a synthetic object that had never
 * been stored published fine. A string saying VERIFIED is a claim about verification, not
 * verification — and asking the caller for it is asking the caller to vouch for itself.
 *
 * Branding the type would have made the forgery inconvenient rather than impossible, and would
 * have left M, N and O standing: none of them requires a forged value, only a genuine value used
 * against the wrong claim, the wrong version, or no stored claim at all.
 *
 * So the parameter is gone. Publishing an inference goes through
 * `publishClaimForDisplay(claimId)` in `./claimVerification`, which loads the stored claim,
 * verifies THAT object, and renders the same object it verified. The caller cannot say "trust me";
 * the publication boundary asks the verifier itself.
 *
 * FACT and CALCULATION are unchanged here — see the reachability note in IR-100 before widening
 * that, and note that this function has no production caller today.
 */
/**
 * Renders a claim whose verification the CALLER has already established for that exact object.
 *
 * Internal to the publication path: `publishClaimForDisplay` in ./claimVerification loads a stored
 * claim, verifies that object, and calls this with the same object. It is exported only because
 * the verifier lives in another module, and it is deliberately not the function anyone reaches for
 * — the one with the friendly name refuses inferences outright.
 */
export function formatVerifiedClaim(claim: ClaimInput): string {
  assertValidClaim(claim);
  return `[${claim.claimType}] ${claim.claimText}`;
}

export function formatClaimForDisplay(claim: ClaimInput): string {
  assertValidClaim(claim);
  if (claim.claimType === "INFERENCE") {
    throw new InvalidClaimError(
      "An INFERENCE cannot be published through formatClaimForDisplay. Use " +
        "publishClaimForDisplay(claimId), which verifies the stored claim it renders. Passing the " +
        "ledger's write invariants is not evidence that an inference traces to anything, and a " +
        "caller-supplied verdict is not evidence that anyone checked.",
    );
  }
  return `[${claim.claimType}] ${claim.claimText}`;
}
