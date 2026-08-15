import { prisma } from "@/server/db/client";

export type VerificationStatus =
  | "VERIFIED"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_NOT_FOUND"
  | "VALUE_MISMATCH"
  | "UNSUPPORTED_CLAIM_TYPE";

export interface VerificationResult {
  status: VerificationStatus;
  detail: string;
}

/**
 * Checks that a stored Claim's evidence actually supports it, rather than trusting `evidence`
 * as an opaque blob. Supports the two real claim producers that exist:
 *  - FACT claims from createFactClaimFromObservation (M08)
 *  - CALCULATION claims from computeSeriesChange (M10)
 * Extend this as INFERENCE gets a real producer (M21) — see docs/DECISIONS.md for why
 * speculative support isn't added ahead of a real caller.
 */
export async function verifyClaim(claimId: string): Promise<VerificationResult> {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });

  if (claim.claimType === "FACT") {
    return verifyFactClaim(claim);
  }
  if (claim.claimType === "CALCULATION") {
    return verifyCalculationClaim(claim);
  }

  return {
    status: "UNSUPPORTED_CLAIM_TYPE",
    detail: `verifyClaim does not yet support ${claim.claimType} claims`,
  };
}

async function verifyFactClaim(claim: {
  id: string;
  claimText: string;
  sourceId: string | null;
  evidence: unknown;
}): Promise<VerificationResult> {
  const evidence = claim.evidence as { observationId?: string } | null;
  const observationId = evidence?.observationId;
  if (!observationId) {
    return { status: "EVIDENCE_MISSING", detail: "claim.evidence has no observationId" };
  }

  const observation = await prisma.observation.findUnique({ where: { id: observationId } });
  if (!observation) {
    return {
      status: "EVIDENCE_NOT_FOUND",
      detail: `evidence.observationId "${observationId}" does not reference an existing Observation`,
    };
  }

  const stringifiedValue = observation.value.toString();
  if (!claim.claimText.includes(stringifiedValue)) {
    return {
      status: "VALUE_MISMATCH",
      detail: `claim text does not contain the evidenced value "${stringifiedValue}"`,
    };
  }

  if (claim.sourceId !== observation.sourceId) {
    return {
      status: "VALUE_MISMATCH",
      detail: "claim.sourceId does not match the evidenced observation's sourceId",
    };
  }

  return { status: "VERIFIED", detail: "claim text and source match the evidenced observation" };
}

async function verifyCalculationClaim(claim: {
  claimText: string;
  evidence: unknown;
}): Promise<VerificationResult> {
  const evidence = claim.evidence as {
    currentObservationId?: string;
    previousObservationId?: string;
    absoluteChange?: number;
  } | null;

  if (!evidence?.currentObservationId || !evidence?.previousObservationId) {
    return {
      status: "EVIDENCE_MISSING",
      detail: "claim.evidence is missing currentObservationId/previousObservationId",
    };
  }

  const [current, previous] = await Promise.all([
    prisma.observation.findUnique({ where: { id: evidence.currentObservationId } }),
    prisma.observation.findUnique({ where: { id: evidence.previousObservationId } }),
  ]);

  if (!current || !previous) {
    return {
      status: "EVIDENCE_NOT_FOUND",
      detail: "evidence references an Observation id that no longer exists",
    };
  }

  const recomputed = Number(current.value.toString()) - Number(previous.value.toString());
  const recomputedRounded = Math.round(recomputed * 1e6) / 1e6;

  if (
    evidence.absoluteChange === undefined ||
    Math.abs(evidence.absoluteChange - recomputedRounded) > 1e-6
  ) {
    return {
      status: "VALUE_MISMATCH",
      detail: `evidence.absoluteChange (${evidence.absoluteChange}) does not match the recomputed delta (${recomputedRounded}) from the current evidenced observations`,
    };
  }

  return {
    status: "VERIFIED",
    detail: "recomputed delta from the evidenced observations matches claim.evidence",
  };
}
