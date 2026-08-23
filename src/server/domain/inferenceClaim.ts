/**
 * Verifying an inference, which cannot mean what verifying a fact means.
 *
 * `verifyClaim` re-derives a FACT or a CALCULATION from the database and compares. An inference
 * has nothing to re-derive — that is what makes it an inference — so the same question asked of it
 * returns `UNSUPPORTED_CLAIM_TYPE`, and has since the ledger was written. The comment there says to
 * extend it when a real producer exists, and that reasoning was right: speculative support for a
 * caller nobody has written is how you get a verifier shaped around an imagined producer.
 *
 * What changed is that the producer's SHAPE is now fixed. `./inferenceAuthorization` decides what
 * may reach a model, `./outputPolicy` decides what may leave one, and
 * `[CHATGPT_ARCHITECT_GUIDANCE][ASK-HOLDOUT-20260823]` names claim/provenance verification as the
 * stage between the second of those and the user. The contract is buildable now and the model is
 * still not approved, which is the order the guidance asks for.
 *
 * ## What verification of an inference actually is
 *
 * Not "is this true" — no deterministic check establishes that, and any function claiming to would
 * be lying about a harder problem. Four things that CAN be established:
 *
 * 1. **Every premise verifies.** An inference resting on a FACT that does not check out is not
 *    verified, whatever it says. The caller supplies each premise's own verification result.
 * 2. **No premise is missing.** An inference with no premises is an assertion.
 * 3. **Every figure in the text comes from a premise.** This is the sharp one. A model that writes
 *    "growth slowed to 2.1%" when no premise contains 2.1 has invented a number, and inventing
 *    numbers is precisely what a language model does effortlessly and a database cannot.
 * 4. **Confidence is present and in range.** Already enforced at write time by the ledger; checked
 *    again here because a verifier that trusts an upstream invariant is one refactor from not
 *    checking it at all.
 *
 * ## Fail closed
 *
 * There is no `VERIFIED_WITH_CAVEAT`. An inference either passes all four or it does not pass, and
 * the reason is named so the failure is auditable rather than a boolean somebody has to
 * investigate.
 *
 * Pure and synchronous. The database work belongs to the caller, which keeps every case here
 * testable without one.
 */

/** How a premise verified, as reported by whoever verified it. */
export interface PremiseVerification {
  claimId: string;
  /** Anything other than `VERIFIED` disqualifies the inference resting on it. */
  status: string;
  /**
   * Figures this premise establishes, exactly as they would appear in prose.
   *
   * The caller derives these from the premise's own evidence, not from the inference text — the
   * whole point is to compare what the model wrote against what the data says, and deriving both
   * sides from the model's output would compare it with itself.
   */
  figures: string[];
}

export type InferenceVerificationStatus =
  | "VERIFIED"
  | "NO_PREMISES"
  | "PREMISE_NOT_VERIFIED"
  | "UNSUPPORTED_FIGURE"
  | "CONFIDENCE_MISSING"
  | "CONFIDENCE_OUT_OF_RANGE";

export interface InferenceVerificationResult {
  status: InferenceVerificationStatus;
  detail: string;
  /** Figures in the text that no premise establishes. Empty unless the status says otherwise. */
  unsupportedFigures: string[];
}

export interface InferenceClaimInput {
  claimText: string;
  confidence: number | null | undefined;
  premises: PremiseVerification[];
}

/**
 * Every numeric token in prose, normalised the way a reader would compare two of them.
 *
 * Thousands separators are dropped and a trailing percent sign is kept, because "1,234" and "1234"
 * are the same figure and "2.1" and "2.1%" are not. Deliberately does not strip currency symbols:
 * a premise establishing 1400 does not establish $1400.
 */
export function figuresIn(text: string): string[] {
  const matches = text.match(/\d[\d,]*(\.\d+)?%?/g) ?? [];
  return [...new Set(matches.map((figure) => figure.replace(/,/g, "")))];
}

/**
 * Verifies an inference against its premises. Deterministic, no model, no network, no database.
 *
 * Order matters only for which failure gets reported first, and it runs cheapest-and-most-basic
 * first so the detail is the most actionable one rather than the most specific.
 */
export function verifyInferenceClaim(input: InferenceClaimInput): InferenceVerificationResult {
  const none: string[] = [];

  if (input.confidence === undefined || input.confidence === null) {
    return {
      status: "CONFIDENCE_MISSING",
      detail:
        "An INFERENCE claim must carry a confidence score. The ledger enforces this at write " +
        "time; it is checked again here because a verifier that trusts an upstream invariant is " +
        "one refactor away from not checking it.",
      unsupportedFigures: none,
    };
  }

  if (input.confidence < 0 || input.confidence > 1) {
    return {
      status: "CONFIDENCE_OUT_OF_RANGE",
      detail: `confidence ${input.confidence} is outside [0, 1].`,
      unsupportedFigures: none,
    };
  }

  if (input.premises.length === 0) {
    return {
      status: "NO_PREMISES",
      detail:
        "An inference with no premises is an assertion. There is nothing for it to rest on and " +
        "nothing to check it against.",
      unsupportedFigures: none,
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
      unsupportedFigures: none,
    };
  }

  // The check a language model actually fails. Everything above is hygiene.
  const supported = new Set(
    input.premises.flatMap((p) => p.figures.map((f) => f.replace(/,/g, ""))),
  );
  const unsupportedFigures = figuresIn(input.claimText).filter((f) => !supported.has(f));

  if (unsupportedFigures.length > 0) {
    return {
      status: "UNSUPPORTED_FIGURE",
      detail:
        `The text contains ${unsupportedFigures.length} figure(s) no premise establishes: ` +
        `${unsupportedFigures.join(", ")}. A number that appears in an inference and in none of ` +
        "its premises was invented somewhere between them.",
      unsupportedFigures,
    };
  }

  return {
    status: "VERIFIED",
    detail:
      `${input.premises.length} premise(s) verified, every figure in the text traces to one of ` +
      "them, and confidence is present and in range. This says the inference is well-founded, " +
      "not that it is correct — no deterministic check establishes that.",
    unsupportedFigures: none,
  };
}
