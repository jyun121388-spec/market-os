/**
 * Verifying an inference, which cannot mean what verifying a fact means.
 *
 * `verifyClaim` re-derives a FACT or a CALCULATION from the database and compares. An inference has
 * nothing to re-derive — that is what makes it an inference — so the four things this establishes
 * are deliberately weaker and deliberately checkable:
 *
 * 1. **Every premise verifies.** An inference resting on a FACT that does not check out is not
 *    verified, whatever it says.
 * 2. **No premise is missing.** An inference with no premises is an assertion.
 * 3. **Every quantity in the prose is cited, and every citation matches structured evidence** on
 *    sign, unit and value. This is the one a language model fails.
 * 4. **Confidence is a real number in range.** `NaN` is not.
 *
 * ## What replaced the first version, and why
 *
 * The first version compared numeric tokens: it pulled digits out of the premise's `claimText` with
 * a regex and out of the inference's, and asked whether the sets overlapped. A probe matrix
 * (IR-094) showed all five ways that fails — sign lost, unit lost, currency lost, subject lost, and
 * a date component authorising a financial value. Every probe was ACCEPTED.
 *
 * The repair is not a longer regex. Prose stopped being the authority:
 *
 *     text side        WHAT DID THE OUTPUT SAY?         -> quantities that need a citation
 *     structured side  WHAT DOES THE EVIDENCE SUPPORT?  -> atoms from the database
 *                      then compare, in ./quantitativeCitation
 *
 * The text side still finds the numbers — that is legitimately its job — but it no longer decides
 * what backs them.
 *
 * ## What VERIFIED does not mean
 *
 * Not "true", and not "the reasoning is sound". No deterministic check establishes either, and a
 * verifier that let a caller read it that way would be the Claim Ledger's own failure mode: a label
 * doing work the check never did. It means provenance exists, premises verify, every quantitative
 * assertion is traceable, and the confidence metadata is valid. Semantic truth is outside it.
 *
 * Pure and synchronous. The database work belongs to the caller.
 */

import type { QuantitativeAtom } from "./quantitativeEvidence";
import {
  checkCitation,
  type CitationCheck,
  type QuantitativeCitation,
} from "./quantitativeCitation";

/** How a premise verified, as reported by whoever verified it. */
export interface PremiseVerification {
  claimId: string;
  /** Anything other than `VERIFIED` disqualifies the inference resting on it. */
  status: string;
  /** Quantities this premise establishes, derived from its evidence rows and never from prose. */
  atoms: QuantitativeAtom[];
}

export type InferenceVerificationStatus =
  | "VERIFIED"
  | "NO_PREMISES"
  | "PREMISE_NOT_VERIFIED"
  | "MALFORMED_EVIDENCE"
  | "UNCITED_QUANTITY"
  | "CITATION_UNSUPPORTED"
  | "CONFIDENCE_MISSING"
  | "CONFIDENCE_NOT_A_NUMBER"
  | "CONFIDENCE_OUT_OF_RANGE";

export interface InferenceVerificationResult {
  status: InferenceVerificationStatus;
  detail: string;
  /** Quantities in the prose that no citation covers. */
  uncitedQuantities: string[];
  /** Every citation that failed, with the reason. */
  failedCitations: CitationCheck[];
}

export interface InferenceClaimInput {
  claimText: string;
  confidence: number | null | undefined;
  premises: PremiseVerification[];
  citations: QuantitativeCitation[];
  /**
   * Set when the stored evidence could not be read exactly as the contract requires.
   *
   * Fails the whole claim rather than being repaired. Silently dropping the members of
   * `premiseClaimIds` that are not strings is how `[validId, 123, null, {}]` verified cleanly
   * (IR-094 candidate D) — malformed evidence normalised into valid evidence.
   */
  evidenceMalformed?: string;
}

/**
 * Quantities a reader would take away from the prose, as spans.
 *
 * A full ISO date is excluded: `2026-03-01` is not a financial quantity, no producer emits it as
 * one, and requiring a citation for it would make every claim text uncitable. A BARE year is not
 * excluded — `Revenue reached 2026` must still be cited, which is exactly the laundering case the
 * old version waved through.
 */
export function quantitativeSpans(text: string): string[] {
  const withoutIsoDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  return [...new Set(withoutIsoDates.match(/-?\d[\d,]*(\.\d+)?%?/g) ?? [])];
}

/**
 * Verifies an inference against its premises and citations. No model, no network, no database.
 *
 * Cheapest and most basic checks first, so the reported failure is the most actionable one.
 */
export function verifyInferenceClaim(input: InferenceClaimInput): InferenceVerificationResult {
  const empty = { uncitedQuantities: [] as string[], failedCitations: [] as CitationCheck[] };

  if (input.evidenceMalformed) {
    return {
      status: "MALFORMED_EVIDENCE",
      detail:
        `The claim's evidence could not be read as the contract requires: ${input.evidenceMalformed}. ` +
        "Refused rather than repaired — dropping the parts that do not parse turns malformed " +
        "evidence into valid evidence.",
      ...empty,
    };
  }

  if (input.confidence === undefined || input.confidence === null) {
    return {
      status: "CONFIDENCE_MISSING",
      detail: "An INFERENCE claim must carry a confidence score.",
      ...empty,
    };
  }

  if (Number.isNaN(input.confidence)) {
    return {
      status: "CONFIDENCE_NOT_A_NUMBER",
      detail:
        "confidence is NaN. Checked explicitly because NaN passes both halves of a range " +
        "comparison — `NaN < 0` and `NaN > 1` are each false — and PostgreSQL stores it happily " +
        "in a double precision column, so this was reachable from production data.",
      ...empty,
    };
  }

  if (input.confidence < 0 || input.confidence > 1) {
    return {
      status: "CONFIDENCE_OUT_OF_RANGE",
      detail: `confidence ${input.confidence} is outside [0, 1].`,
      ...empty,
    };
  }

  if (input.premises.length === 0) {
    return {
      status: "NO_PREMISES",
      detail:
        "An inference with no premises is an assertion. There is nothing for it to rest on and " +
        "nothing to check it against.",
      ...empty,
    };
  }

  const unverified = input.premises.filter((p) => p.status !== "VERIFIED");
  if (unverified.length > 0) {
    return {
      status: "PREMISE_NOT_VERIFIED",
      detail:
        `${unverified.length} of ${input.premises.length} premises did not verify: ` +
        unverified.map((p) => `${p.claimId} (${p.status})`).join(", ") +
        ". An inference is at most as good as what it rests on.",
      ...empty,
    };
  }

  // Only a verified premise contributes atoms. An unverified one has already failed above; this
  // keeps the set honest if that ordering ever changes.
  const atoms = input.premises.filter((p) => p.status === "VERIFIED").flatMap((p) => p.atoms);

  const checks = input.citations.map((citation) => checkCitation(citation, input.claimText, atoms));
  const failedCitations = checks.filter((c) => c.verdict !== "SUPPORTED");
  if (failedCitations.length > 0) {
    return {
      status: "CITATION_UNSUPPORTED",
      detail:
        `${failedCitations.length} citation(s) do not hold: ` +
        failedCitations.map((c) => `${c.verdict} — ${c.detail}`).join(" | "),
      uncitedQuantities: [],
      failedCitations,
    };
  }

  // Coverage. Structured citations alone are not enough: prose may still contain a number nobody
  // cited, and an uncited number is exactly what a model invents.
  const supportedSpans = checks.map((c) => c.citation.surfaceText);
  const uncitedQuantities = quantitativeSpans(input.claimText).filter(
    (span) => !supportedSpans.some((surface) => surface.includes(span)),
  );
  if (uncitedQuantities.length > 0) {
    return {
      status: "UNCITED_QUANTITY",
      detail:
        `The text states ${uncitedQuantities.length} quantity/quantities no citation covers: ` +
        `${uncitedQuantities.join(", ")}. Every number a reader would take away has to be ` +
        "attributable to a premise, and an uncited one was invented somewhere.",
      uncitedQuantities,
      failedCitations: [],
    };
  }

  return {
    status: "VERIFIED",
    detail:
      `${input.premises.length} premise(s) verified, ${checks.length} citation(s) match their ` +
      "evidence on sign, unit and value, every quantity in the prose is cited, and confidence is " +
      "a real number in range. This says the inference is well-founded and traceable, not that " +
      "it is correct — no deterministic check establishes that.",
    ...empty,
  };
}
