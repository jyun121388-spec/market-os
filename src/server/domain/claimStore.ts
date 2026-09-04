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

interface FactClaimObservation {
  value: { toString(): string };
  observationDate: Date;
  series: { name: string; unit: string };
  source: { name: string };
}

/**
 * Deterministically builds the exact FACT claim text for an observation. Exported so
 * `claimVerification.ts` can reconstruct the same text from the (re-fetched) evidenced
 * observation and compare by exact equality — the structural replacement for the old
 * substring-containment check (see docs/DECISIONS.md's H2 entry). Any drift between this
 * template and the one actually used at claim-creation time would make every FACT claim
 * unverifiable, which is exactly the kind of drift a shared function prevents.
 */
export function buildFactClaimText(observation: FactClaimObservation): string {
  const dateStr = observation.observationDate.toISOString().slice(0, 10);
  return `${observation.series.name} was ${observation.value.toString()} ${observation.series.unit} on ${dateStr} (${observation.source.name})`;
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

  const claimText = buildFactClaimText(observation);

  return createClaim({
    claimText,
    claimType: "FACT",
    sourceId: observation.sourceId,
    retrievedAt: observation.retrievedAt,
    evidence: { observationId: observation.id, seriesId: observation.seriesId },
    conflictStatus: "none",
  });
}
