import { prisma } from "@/server/db/client";
import { buildFactClaimText } from "./claimStore";
import { buildChangeClaimText } from "./whatChanged";
import { computeChange } from "./seriesReadings";

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
 * or `claimText` as opaque blobs. Supports the two real claim producers that exist:
 *  - FACT claims from createFactClaimFromObservation (M08)
 *  - CALCULATION claims from computeSeriesChange (M10)
 * Extend this as INFERENCE gets a real producer (M21) — see docs/DECISIONS.md for why
 * speculative support isn't added ahead of a real caller.
 *
 * Verification is STRUCTURAL, not substring-based (see docs/DECISIONS.md's H2 entry — a prior
 * version used `claimText.includes(String(value))`, which a value like "3.5" being a substring
 * of an unrelated "13.50" could false-positive through). Every field the claim depends on —
 * series identity, source identity, chronological order, and the exact recomputed
 * value/percent/bps — is independently re-derived from the DB and compared, and the stored
 * `claimText` itself is regenerated from that same data and compared by exact string equality.
 * A claim whose text doesn't match its own evidence is never VERIFIED, even if the evidence
 * itself is internally consistent.
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
  const evidence = claim.evidence as { observationId?: string; seriesId?: string } | null;
  const observationId = evidence?.observationId;
  if (!observationId) {
    return { status: "EVIDENCE_MISSING", detail: "claim.evidence has no observationId" };
  }

  const observation = await prisma.observation.findUnique({
    where: { id: observationId },
    include: { series: true, source: true },
  });
  if (!observation) {
    return {
      status: "EVIDENCE_NOT_FOUND",
      detail: `evidence.observationId "${observationId}" does not reference an existing Observation`,
    };
  }

  // Identity checks: the evidence's own claimed series/source must match what the evidenced
  // observation actually belongs to — catches a tampered evidence.seriesId or claim.sourceId
  // even in cases where the regenerated text (checked below) would coincidentally still match.
  if (evidence?.seriesId !== undefined && evidence.seriesId !== observation.seriesId) {
    return {
      status: "VALUE_MISMATCH",
      detail: `evidence.seriesId ("${evidence.seriesId}") does not match the evidenced observation's actual series ("${observation.seriesId}")`,
    };
  }
  if (claim.sourceId !== observation.sourceId) {
    return {
      status: "VALUE_MISMATCH",
      detail: "claim.sourceId does not match the evidenced observation's sourceId",
    };
  }

  // Structural text check: regenerate the claim text from the (re-fetched, untampered)
  // observation and require an EXACT match. This is what actually closes the substring-
  // collision hole — a claim whose value/unit/date/series-name/source-name don't exactly
  // reconstruct the stored text is rejected, regardless of whether some substring happens to
  // overlap.
  const expectedText = buildFactClaimText(observation);
  if (claim.claimText !== expectedText) {
    return {
      status: "VALUE_MISMATCH",
      detail: `claim text does not match the text reconstructed from the evidenced observation (expected "${expectedText}")`,
    };
  }

  return {
    status: "VERIFIED",
    detail: "claim text and identity exactly match the evidenced observation",
  };
}

async function verifyCalculationClaim(claim: {
  claimText: string;
  evidence: unknown;
}): Promise<VerificationResult> {
  const evidence = claim.evidence as {
    seriesId?: string;
    currentObservationId?: string;
    previousObservationId?: string;
    absoluteChange?: number;
    percentChange?: number | null;
    bpsChange?: number | null;
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

  // Series identity: both observations must belong to the same series as each other AND as
  // evidence.seriesId — catches "different series" tampering (swapping in an observation from
  // an unrelated series that happens to have a convenient value).
  if (current.seriesId !== previous.seriesId) {
    return {
      status: "VALUE_MISMATCH",
      detail: "evidenced current/previous observations belong to different series",
    };
  }
  if (evidence.seriesId !== undefined && evidence.seriesId !== current.seriesId) {
    return {
      status: "VALUE_MISMATCH",
      detail: `evidence.seriesId ("${evidence.seriesId}") does not match the evidenced observations' actual series ("${current.seriesId}")`,
    };
  }
  // Source identity: defensive check — an Observation's sourceId should always equal its
  // series' sourceId by construction, but a claim can't be trusted to have preserved that.
  if (current.sourceId !== previous.sourceId) {
    return {
      status: "VALUE_MISMATCH",
      detail: "evidenced current/previous observations belong to different sources",
    };
  }

  // Chronological order: "current" must actually be the later observation — catches
  // reversed-current/previous tampering, which would otherwise silently flip the sign of every
  // recomputed change.
  if (current.observationDate.getTime() <= previous.observationDate.getTime()) {
    return {
      status: "VALUE_MISMATCH",
      detail:
        "evidence.currentObservationId is not chronologically after evidence.previousObservationId",
    };
  }

  const series = await prisma.series.findUniqueOrThrow({ where: { id: current.seriesId } });
  const recomputed = computeChange({ current, previous }, series.unit);

  const changesMatch =
    evidence.absoluteChange !== undefined &&
    Math.abs(evidence.absoluteChange - recomputed.absoluteChange) < 1e-6 &&
    percentChangesMatch(evidence.percentChange, recomputed.percentChange) &&
    bpsChangesMatch(evidence.bpsChange, recomputed.bpsChange);

  if (!changesMatch) {
    return {
      status: "VALUE_MISMATCH",
      detail:
        `evidence (absoluteChange=${evidence.absoluteChange}, percentChange=${evidence.percentChange}, ` +
        `bpsChange=${evidence.bpsChange}) does not match the recomputed change from the evidenced ` +
        `observations (absoluteChange=${recomputed.absoluteChange}, percentChange=${recomputed.percentChange}, ` +
        `bpsChange=${recomputed.bpsChange})`,
    };
  }

  // Structural text check, same principle as verifyFactClaim: regenerate the claim text from
  // the (re-fetched, untampered) observations and the independently recomputed change, and
  // require exact equality. A claimText that doesn't match its own (now-verified) evidence is
  // never VERIFIED.
  const expectedText = buildChangeClaimText(
    series.name,
    series.unit,
    { current, previous },
    recomputed,
  );
  if (claim.claimText !== expectedText) {
    return {
      status: "VALUE_MISMATCH",
      detail: `claim text does not match the text reconstructed from the evidenced observations and recomputed change (expected "${expectedText}")`,
    };
  }

  return {
    status: "VERIFIED",
    detail: "recomputed change and claim text exactly match the evidenced observations",
  };
}

function percentChangesMatch(
  evidenced: number | null | undefined,
  recomputed: number | null,
): boolean {
  if (recomputed === null) return evidenced === null;
  if (evidenced === null || evidenced === undefined) return false;
  return Math.abs(evidenced - recomputed) < 1e-4;
}

function bpsChangesMatch(evidenced: number | null | undefined, recomputed: number | null): boolean {
  if (recomputed === null) return evidenced === null;
  if (evidenced === null || evidenced === undefined) return false;
  return Math.abs(evidenced - recomputed) < 1e-2;
}
