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
 * as an opaque blob. Currently scoped to the one real claim producer that exists
 * (createFactClaimFromObservation, M08): a FACT claim whose evidence names an observationId.
 * Extend this as CALCULATION/INFERENCE get real producers (M11, M21) — see docs/DECISIONS.md
 * for why speculative support isn't added ahead of a real caller.
 */
export async function verifyClaim(claimId: string): Promise<VerificationResult> {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });

  if (claim.claimType !== "FACT") {
    return {
      status: "UNSUPPORTED_CLAIM_TYPE",
      detail: `verifyClaim only supports FACT claims currently (got ${claim.claimType})`,
    };
  }

  const evidence = claim.evidence as { observationId?: string } | null;
  const observationId = evidence?.observationId;
  if (!observationId) {
    return { status: "EVIDENCE_MISSING", detail: "claim.evidence has no observationId" };
  }

  const observation = await prisma.observation.findUnique({
    where: { id: observationId },
    include: { series: true },
  });
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
