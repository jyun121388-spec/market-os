import {
  CAPABILITY_AXES,
  PROVIDER_CAPABILITIES,
  type CapabilityAxis,
  type ProviderCapabilityProfile,
} from "../fabric/providerCapability";
import type { ActionKind } from "../governance/policy";
import type { WeaknessCategory } from "./ledger";

/**
 * Evolution Engine — PROPOSALS (docs/EVOLUTION_ENGINE.md).
 *
 * The Engine detects weaknesses; this turns one class of them into something a human can act on
 * without having to re-derive the reasoning. It proposes and nothing else: no code is written, no
 * migration is run, and every proposal names the governed actions it would require, so the
 * decision to act stays where it belongs.
 *
 * The whole design rests on one separation. A proposal carries OBSERVED evidence and INFERRED
 * reasoning as different fields, and a test requires at least one observation per proposal. The
 * failure mode being designed out is specific and documented: `docs/LOCAL_AI_CALIBRATION.md`
 * records four fluent, confident, entirely fabricated defect reports, and IR-020 records a strong
 * model quoting a reproduction it had never run. Both were indistinguishable in form from real
 * findings. Structure is the only thing that separates them, so the structure is enforced.
 *
 * These proposals are also GENERATED from the capability matrix rather than written by hand. A
 * hand-written proposal can claim whatever its author believes; a generated one can only say what
 * the matrix says.
 *
 * SHADOW ONLY. Nothing in v1 imports this.
 */

/** Whether a statement was seen or concluded. Never both, and never left to the reader. */
export type EvidenceStanding = "OBSERVED" | "INFERRED";

export interface ProposalEvidence {
  standing: EvidenceStanding;
  statement: string;
  /** Where to go to check it: a capability cell, a ledger id, a shadow run. */
  source: string;
}

export interface Proposal {
  id: string;
  /** What was seen, with no interpretation attached. */
  observation: string;
  /** At least one OBSERVED item, by construction and by test. */
  evidence: ProposalEvidence[];
  /** The recurring cause this belongs to, or null when it does not belong to a known cluster. */
  systemicWeakness: WeaknessCategory | null;
  /** The reasoning. Always inferred — labelled so it is never mistaken for the observation. */
  hypothesis: string;
  proposedChange: string;
  expectedBenefit: string;
  /** Required, and never "none". A change with no downside has not been thought about. */
  expectedRisk: string;
  requiredVerify: string[];
  /** Which governed actions carrying this out would involve, so the gate is visible up front. */
  requiredGovernance: ActionKind[];
  /** The gate that blocks it now, where one does. */
  blockedBy?: string;
}

const axesWhere = (
  profile: ProviderCapabilityProfile,
  predicate: (axis: CapabilityAxis) => boolean,
): CapabilityAxis[] => CAPABILITY_AXES.filter(predicate);

/**
 * One proposal per provider whose capabilities have never been seen in a real response.
 *
 * This is the largest single body of unknowns in the system and it is invisible in the code: an
 * adapter compiles, its types look authoritative, and nothing marks the difference between a shape
 * confirmed against SEC's real responses and one transcribed from a documentation page. The matrix
 * makes the difference explicit; this turns it into a work item with a named gate.
 */
function verificationDebtProposal(profile: ProviderCapabilityProfile): Proposal | null {
  const unverified = axesWhere(profile, (axis) => profile.axes[axis].state === "NOT_VERIFIED");
  if (unverified.length === 0) return null;

  const gates = [
    ...new Set(unverified.map((axis) => profile.axes[axis].blockedBy).filter(Boolean)),
  ] as string[];

  return {
    id: `CAP-DEBT-${profile.sourceCode}`,
    observation:
      `${unverified.length} of ${CAPABILITY_AXES.length} capability axes for ` +
      `${profile.sourceCode} rest on documentation or adapter declaration, and none on an ` +
      "observed response.",
    evidence: [
      {
        standing: "OBSERVED",
        statement: profile.standing,
        source: `providerCapability.ts — ${profile.sourceCode}.standing`,
      },
      {
        standing: "OBSERVED",
        statement: `Axes never confirmed live: ${unverified.join(", ")}.`,
        source: "providerCapability.ts — capability states",
      },
      {
        standing: "OBSERVED",
        statement:
          "SEC EDGAR's documented shape differed from its real responses in four ways when the " +
          "two were first compared: fy/fp nullability, the 1000-row filings cap, the files[] " +
          "overflow, and revenue moving across three us-gaap tags.",
        source: "docs/PROJECT_STATE.md; ledger PD-01, PD-03, PD-04",
      },
      {
        standing: "INFERRED",
        statement:
          "These adapters were written the same way EDGAR's was — from documentation — so the " +
          "prior for drift on first real contact is high rather than speculative.",
        source: "inference from the observations above",
      },
    ],
    systemicWeakness: "PROVIDER_ASSUMPTION",
    hypothesis:
      `${profile.sourceCode} will diverge from its documented shape on first real contact, in ` +
      "nullability, pagination or field semantics, exactly as EDGAR did.",
    proposedChange:
      `Run the existing live-verification harness against ${profile.sourceCode} the moment a ` +
      "legitimate key exists, and promote capability cells from NOT_VERIFIED only on the strength " +
      "of the response — never on the strength of the harness having run.",
    expectedBenefit:
      "Converts the largest block of unknowns in the system into either confirmed capabilities or " +
      "named defects, and unblocks any Verify dimension currently reporting VERIFICATION_DEBT for " +
      "this provider.",
    expectedRisk:
      "A live run will very likely surface defects in an adapter currently believed working, " +
      "which turns a quiet unknown into visible work. That is the point, and it is still a cost.",
    requiredVerify: [
      "response shape against the declared TypeScript types",
      "nullability of every field the adapter treats as required",
      "pagination and total-count behaviour at a boundary, not just a happy path",
      "a real ingest followed by a re-ingest, proving idempotency",
    ],
    requiredGovernance: ["CALL_FREE_PROVIDER", "FIX_REPRODUCED_DEFECT"],
    blockedBy: gates.join(", ") || undefined,
  };
}

/**
 * One proposal per provider with a confirmed structural ceiling.
 *
 * The opposite situation, and the one more likely to be mishandled. A limitation that will never
 * lift should stop generating work — but only after it is written down as a ceiling rather than
 * left looking like an unfinished task, or every future reader re-opens the same investigation.
 */
function structuralLimitationProposal(profile: ProviderCapabilityProfile): Proposal | null {
  const unsupported = axesWhere(profile, (axis) => profile.axes[axis].state === "NOT_SUPPORTED");
  if (unsupported.length === 0) return null;

  return {
    id: `CAP-CEILING-${profile.sourceCode}`,
    observation:
      `${profile.sourceCode} was observed not to supply: ${unsupported.join(", ")}. Each was ` +
      "established from a real response, not from an absence in the documentation.",
    evidence: unsupported.map((axis) => ({
      standing: "OBSERVED" as const,
      statement: `${axis}: ${profile.axes[axis].basis}`,
      source: `providerCapability.ts — ${profile.sourceCode}.${axis}`,
    })),
    systemicWeakness: null,
    hypothesis:
      "These gaps will not close through any work on our side, so any layer treating them as " +
      "missing data will keep reporting a defect that has no fix.",
    proposedChange:
      "Keep the ceiling declared in the matrix and have downstream layers classify these absences " +
      "as STRUCTURAL_LIMITATION rather than as gaps — which Verify now does — so the product " +
      "discloses the limit to the reader instead of quietly implying completeness.",
    expectedBenefit:
      "Stops recurring investigation of a question already settled, and makes the limit visible " +
      "to a user rather than only to whoever last read the adapter.",
    expectedRisk:
      "A ceiling recorded once can become a ceiling assumed forever. A provider may add a field, " +
      "and nothing here would notice; the matrix needs re-checking when a provider versions its " +
      "API, not only when our code changes.",
    requiredVerify: [
      "the classification appears in a real shadow run rather than only in a unit test",
    ],
    requiredGovernance: ["EDIT_DOCS"],
  };
}

/**
 * Proposals derived from the capability matrix.
 *
 * Deterministic and total: same matrix, same proposals. Nothing here consults a model, and nothing
 * here can assert anything the matrix does not already say.
 */
export function capabilityGapProposals(
  profiles: ProviderCapabilityProfile[] = PROVIDER_CAPABILITIES,
): Proposal[] {
  return profiles
    .flatMap((profile) => [
      verificationDebtProposal(profile),
      structuralLimitationProposal(profile),
    ])
    .filter((proposal): proposal is Proposal => proposal !== null);
}

/** Observations only. Useful for a reader who wants the facts before anyone's reasoning. */
export function observedEvidence(proposal: Proposal): ProposalEvidence[] {
  return proposal.evidence.filter((e) => e.standing === "OBSERVED");
}
