import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { assertValidClaim, type ClaimInput } from "./claimLedger";

export interface CreateClaimInput extends ClaimInput {
  sourceUrl?: string;
  sourceTimestamp?: Date;
  retrievedAt?: Date;
  evidence?: Prisma.InputJsonValue;
  conflictStatus?: string;
}

/**
 * The one real write path for Claim rows. Every caller goes through `assertValidClaim` first —
 * this is the actual enforcement point for the Claim Ledger invariants described in
 * docs/ARCHITECTURE.md, not just a unit-tested function nobody calls in production.
 */
export async function createClaim(input: CreateClaimInput) {
  assertValidClaim(input);

  return prisma.claim.create({
    data: {
      claimText: input.claimText,
      claimType: input.claimType,
      sourceId: input.sourceId ?? undefined,
      sourceUrl: input.sourceUrl,
      sourceTimestamp: input.sourceTimestamp,
      retrievedAt: input.retrievedAt,
      evidence: input.evidence,
      confidence: input.confidence ?? undefined,
      conflictStatus: input.conflictStatus,
    },
  });
}

/**
 * Builds and persists a FACT claim directly from a stored Observation, so the Claim Ledger's
 * "every FACT must trace to a stored source" invariant is enforced by construction rather than
 * left to whoever writes presentation-layer code later (docs/ARCHITECTURE.md, CLAUDE.md
 * "No hallucinated financial facts").
 */
export async function createFactClaimFromObservation(observationId: string) {
  const observation = await prisma.observation.findUniqueOrThrow({
    where: { id: observationId },
    include: { series: true, source: true },
  });

  const dateStr = observation.observationDate.toISOString().slice(0, 10);
  const claimText = `${observation.series.name} was ${observation.value.toString()} ${observation.series.unit} on ${dateStr} (${observation.source.name})`;

  return createClaim({
    claimText,
    claimType: "FACT",
    sourceId: observation.sourceId,
    retrievedAt: observation.retrievedAt,
    evidence: { observationId: observation.id, seriesId: observation.seriesId },
    conflictStatus: "none",
  });
}
