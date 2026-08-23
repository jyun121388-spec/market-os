import { prisma } from "@/server/db/client";
import { buildFactClaimText } from "./claimStore";
import { buildChangeClaimText } from "./whatChanged";
import { computeChange } from "./seriesReadings";
import { formatVerifiedClaim, InvalidClaimError } from "./claimLedger";
import { verifyInferenceClaim, type PremiseVerification } from "./inferenceClaim";
import type { QuantitativeCitation } from "./quantitativeCitation";
import { calculationAtoms, factAtoms, type QuantitativeAtom } from "./quantitativeEvidence";

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
 * INFERENCE joined them on 2026-08-23, verified against its premises rather than recomputed — see
 * ./inferenceClaim for what verification of an inference can and cannot mean. The old note here
 * said to wait for a real producer, and that was right until the producer's shape was fixed by
 * the authorized architecture.
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
  return verifyLoadedClaim(claim);
}

/**
 * Verifies a claim row the caller has already loaded.
 *
 * Extracted so that publication can verify the EXACT object it is about to render. `verifyClaim`
 * loads by id and `publishClaimForDisplay` loads by id, and if publication called the former it
 * would be verifying one read and rendering another — a window IR-100 candidate N walked through
 * with nothing more exotic than an UPDATE between the two.
 *
 * No verification logic is duplicated: `verifyClaim` is now this function plus a load.
 */
export async function verifyLoadedClaim(claim: {
  id: string;
  claimType: string;
  claimText: string;
  sourceId: string | null;
  confidence: unknown;
  evidence: unknown;
}): Promise<VerificationResult> {
  if (claim.claimType === "FACT") {
    return verifyFactClaim(claim);
  }
  if (claim.claimType === "CALCULATION") {
    return verifyCalculationClaim(claim);
  }

  if (claim.claimType === "INFERENCE") {
    return verifyInferenceClaimFromDb(claim);
  }

  return {
    status: "UNSUPPORTED_CLAIM_TYPE",
    detail: `verifyClaim does not yet support ${claim.claimType} claims`,
  };
}

/**
 * The only way to publish an INFERENCE, and the reason it takes an id rather than a claim.
 *
 * A third-order review (IR-100) reproduced four ways a caller-supplied verdict fails to be an
 * authority: the literal string is forgeable, a verdict for claim A publishes claim B, a verdict
 * survives the claim being mutated underneath it, and a synthetic object that was never stored
 * publishes fine. All four have the same root — the caller was being asked to vouch for itself.
 *
 * So this function takes the one thing a caller cannot fake into meaning something else: an
 * identity in the ledger. It loads that row, verifies THAT OBJECT, and renders the same object it
 * verified. There is no parameter to get wrong and no verdict to carry around.
 *
 * ## On transactions, which are deliberately absent
 *
 * Verification reads premise rows and observation rows after the claim row, so in principle the
 * three could come from different moments. That was checked before adding machinery for it: no
 * production code path updates, deletes or upserts a `Claim` — the ledger is append-only, and the
 * only `claim.update` occurrences in the repository are inside generated Prisma docstrings. With
 * no writer to race, a snapshot would be complexity bought against a scenario the application
 * cannot currently produce. **If a claim mutation path is ever added, this needs one**, and the
 * test that reproduced N by calling `prisma.claim.update` directly is the shape it would take.
 */
export async function publishClaimForDisplay(claimId: string): Promise<string> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    throw new InvalidClaimError(
      `No claim ${claimId} exists. Publication is anchored to a stored ledger identity, so there ` +
        "is nothing here to publish.",
    );
  }

  const verification = await verifyLoadedClaim(claim);
  if (verification.status !== "VERIFIED") {
    throw new InvalidClaimError(
      `Claim ${claimId} did not verify (${verification.status}): ${verification.detail}`,
    );
  }

  // Rendered from the SAME object that was verified, never from a fresh read.
  return formatVerifiedClaim({
    claimText: claim.claimText,
    claimType: claim.claimType,
    sourceId: claim.sourceId,
    confidence: claim.confidence,
  });
}

/**
 * INFERENCE verification, wired to the structured rules in `./inferenceClaim`.
 *
 * **Quantitative authority is the database, not the prose.** The first version derived a premise's
 * supported figures by running a regex over its `claimText`; IR-094 reproduced all five ways that
 * fails. Atoms now come from the observation and change rows themselves, via
 * `./quantitativeEvidence`, and the inference must cite them explicitly.
 *
 * **Malformed evidence fails closed.** The previous adapter kept the string members of
 * `premiseClaimIds` and discarded the rest, so `[validId, 123, null, {}]` verified cleanly — it
 * repaired the evidence instead of refusing it. A member of the wrong type is now the whole
 * claim's problem.
 *
 * A premise that is itself an INFERENCE is not followed. One level, deliberately: a chain of
 * inferences is not evidence, and following it would let an invented number be laundered through
 * an intermediate claim.
 */
async function verifyInferenceClaimFromDb(claim: {
  id: string;
  claimText: string;
  confidence: unknown;
  evidence: unknown;
}): Promise<VerificationResult> {
  const evidence = claim.evidence as {
    premiseClaimIds?: unknown;
    quantitativeCitations?: unknown;
  } | null;

  const malformed = describeMalformedInferenceEvidence(evidence);
  if (malformed) {
    const refused = verifyInferenceClaim({
      claimText: claim.claimText,
      confidence: null,
      premises: [],
      citations: [],
      evidenceMalformed: malformed,
    });
    return { status: "VALUE_MISMATCH", detail: `${refused.status}: ${refused.detail}` };
  }

  const ids = (evidence?.premiseClaimIds ?? []) as string[];
  const citations = (evidence?.quantitativeCitations ?? []) as QuantitativeCitation[];

  const premises: PremiseVerification[] = [];
  for (const premiseId of ids) {
    const premise = await prisma.claim.findUnique({ where: { id: premiseId } });
    if (!premise) {
      premises.push({ claimId: premiseId, status: "EVIDENCE_NOT_FOUND", atoms: [] });
      continue;
    }
    if (premise.claimType === "INFERENCE") {
      premises.push({ claimId: premiseId, status: "UNSUPPORTED_CLAIM_TYPE", atoms: [] });
      continue;
    }
    const verified = await verifyClaim(premiseId);
    premises.push({
      claimId: premiseId,
      status: verified.status,
      atoms: verified.status === "VERIFIED" ? await atomsForPremise(premise) : [],
    });
  }

  const result = verifyInferenceClaim({
    claimText: claim.claimText,
    confidence: typeof claim.confidence === "number" ? claim.confidence : null,
    premises,
    citations,
  });

  // Mapped onto the existing VerificationStatus vocabulary so a caller does not need to know which
  // claim type it asked about. VERIFIED stays VERIFIED; every other outcome is a mismatch between
  // the claim and its evidence, which is what VALUE_MISMATCH has always meant here.
  return {
    status: result.status === "VERIFIED" ? "VERIFIED" : "VALUE_MISMATCH",
    detail: `${result.status}: ${result.detail}`,
  };
}

/**
 * Names the first way the stored evidence departs from the contract, or `null` if it holds.
 *
 * Strict about types on purpose. Everything it rejects was previously either silently dropped or
 * silently coerced, and both turn a producer bug into a passing verification.
 */
function describeMalformedInferenceEvidence(
  evidence: { premiseClaimIds?: unknown; quantitativeCitations?: unknown } | null,
): string | null {
  // Absent is not malformed. An INFERENCE with no evidence field has no premises, which the next
  // check names precisely; calling it malformed would report a producer bug where there is only a
  // missing one. Evidence that is PRESENT and not an object is malformed.
  if (evidence === null || evidence === undefined) return null;
  if (typeof evidence !== "object") return "evidence is present and not an object";
  const ids = evidence.premiseClaimIds;
  if (ids !== undefined) {
    if (!Array.isArray(ids)) return "premiseClaimIds is present and not an array";
    const bad = ids.findIndex((v) => typeof v !== "string" || v.length === 0);
    if (bad !== -1) {
      return `premiseClaimIds[${bad}] is ${JSON.stringify(ids[bad])}, not a non-empty string`;
    }
  }
  const citations = evidence.quantitativeCitations;
  if (citations !== undefined) {
    if (!Array.isArray(citations)) {
      return "quantitativeCitations is present and not an array";
    }
    for (let i = 0; i < citations.length; i += 1) {
      const c = citations[i] as Record<string, unknown> | null;
      if (c === null || typeof c !== "object") {
        return `quantitativeCitations[${i}] is not an object`;
      }
      for (const field of ["premiseClaimId", "kind", "surfaceText", "subjectId"]) {
        if (typeof c[field] !== "string" || (c[field] as string).length === 0) {
          return `quantitativeCitations[${i}].${field} is missing or not a non-empty string`;
        }
      }
      for (const field of ["assertionStart", "assertionEnd"]) {
        if (!Number.isInteger(c[field])) {
          return `quantitativeCitations[${i}].${field} is missing or not an integer offset`;
        }
      }
      if (!Array.isArray(evidence.premiseClaimIds)) continue;
      if (!(evidence.premiseClaimIds as string[]).includes(c.premiseClaimId as string)) {
        return `quantitativeCitations[${i}] cites ${String(c.premiseClaimId)}, which is not in premiseClaimIds`;
      }
    }
  }
  return null;
}

/** Loads the rows a premise's atoms are derived from, then derives them. */
async function atomsForPremise(premise: {
  id: string;
  claimType: string;
  evidence: unknown;
}): Promise<QuantitativeAtom[]> {
  const evidence = premise.evidence as {
    observationId?: unknown;
    seriesId?: unknown;
  } | null;

  if (premise.claimType === "FACT") {
    const observationId =
      typeof evidence?.observationId === "string" ? evidence.observationId : null;
    if (!observationId) return [];
    const observation = await prisma.observation.findUnique({
      where: { id: observationId },
      include: { series: true },
    });
    if (!observation) return [];
    return factAtoms(premise, {
      observation,
      seriesUnit: observation.series.unit,
    });
  }

  if (premise.claimType === "CALCULATION") {
    const seriesId = typeof evidence?.seriesId === "string" ? evidence.seriesId : null;
    if (!seriesId) return [];
    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    return calculationAtoms(premise, { seriesUnit: series?.unit ?? null });
  }

  return [];
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
  sourceId: string | null;
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
  // The claim's OWN source attribution must match its evidence. verifyFactClaim has always
  // checked this; the CALCULATION path did not, which was an asymmetry rather than a decision —
  // nothing documented it. It mattered because `buildChangeClaimText` does not mention the
  // source, so a claim whose `sourceId` had been repointed at a different provider reconstructed
  // to byte-identical text and verified as VERIFIED. For a product whose central promise is that
  // every displayed figure traces to a stored source, a verifier that skips the claimed source
  // on half its claim types is not verifying provenance.
  if (claim.sourceId !== current.sourceId) {
    return {
      status: "VALUE_MISMATCH",
      detail: "claim.sourceId does not match the evidenced observations' sourceId",
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
