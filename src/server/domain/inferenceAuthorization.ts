/**
 * The door a future free-text model sits behind, and the only way through it.
 *
 * Three independent measurements say the request guardrail cannot be the sole safety boundary for
 * a generation path. A fresh holdout, never tuned against, answered 82 of 112 prohibited requests
 * (IR-092). The regex list plus the frame discriminator is a good filter and a bad gate, and the
 * difference matters entirely because of which way each one fails:
 *
 *     a filter asks   "did anything match?"        and lets the unmatched through
 *     a gate asks     "was this proven safe?"      and holds the unproven back
 *
 * `detectPersonalizedAdviceRequest` is the first. This module is the second, and it exists as a
 * separate function precisely so the two questions cannot be confused by a caller in a hurry.
 *
 * ## Positive authorization, and what that rules out
 *
 * Eligibility is granted, never inferred from an absence. A query reaches generation only when it
 * is affirmatively classified as one of two narrow frames, and every other outcome — including
 * "nothing matched", which is 69 of the holdout's 82 misses — is ineligible.
 *
 * The rule this replaces, written out so nobody reintroduces it:
 *
 *     NOT detected as prohibited  =>  may reach the model        // never
 *     affirmatively proven safe   =>  may reach the model        // only this
 *
 * `DESCRIPTIVE_ANALYSIS` is deliberately not eligible either, though it is a perfectly reasonable
 * frame for a factual lookup. "What was the price target last year?" names no source, and a
 * deterministic lookup answering it from stored data is fine while a model answering it is a model
 * inventing a number. The permitted set is narrower for generation than for the redirect
 * guardrail, on purpose: the two paths can produce very different kinds of wrong.
 *
 * ## What this module does NOT claim
 *
 * It does not claim the model's OUTPUT will be safe. A request gate cannot establish that, and
 * pretending otherwise is the failure this whole layer is built to avoid. `./outputPolicy` is the
 * separate, independent boundary on the other side, and both are required.
 *
 * Nothing here calls a provider, and nothing here can. There is no provider.
 */

import { detectPersonalizedAdviceRequest } from "./askMarket";
import { classifyRequestFrame, type RequestFrame } from "./requestFrame";
import { resolveRequestAuthority } from "./requestAuthority";

/** The only frames a future inference producer may ever see. Narrow, and closed. */
export const INFERENCE_ELIGIBLE_FRAMES = [
  "FACTUAL_MECHANISM",
  "THIRD_PARTY_REPORTED_FACT",
] as const satisfies readonly RequestFrame[];

export type EligibleFrame = (typeof INFERENCE_ELIGIBLE_FRAMES)[number];

/**
 * Why a request may not reach a model.
 *
 * Distinct reasons rather than one boolean, because the operational responses differ: a prohibited
 * request is refused and logged as a guardrail hit, while an unprovable one is simply answered
 * deterministically and is not a compliance event.
 */
export type IneligibilityReason =
  /** The existing request guardrail refused it outright. */
  | "PROHIBITED_REQUEST"
  /** Asks the product to decide, choose, or act. */
  | "DIRECTIVE_FRAME"
  /** No frame could be established. The largest class, and the one that must fail closed. */
  | "FRAME_NOT_PROVEN"
  /** A recognised frame, and not one of the two that may reach generation. */
  | "FRAME_NOT_ELIGIBLE"
  /**
   * The canonical request authority calls this request prohibited, whatever the frame says.
   *
   * Distinct from `PROHIBITED_REQUEST`, which is the vocabulary guardrail's own verdict. This one
   * fires where that guardrail is silent and the operation parser is not -- a subject that belongs
   * to the reader, for instance, which no phrase list catches and a possessive determiner does.
   */
  | "CANONICAL_AUTHORITY_PROHIBITED"
  /**
   * The request IS recognised, and its operation is one repository code answers alone.
   *
   * `plannerPermitted` has been on the operation contract since IR-107 and nothing read it, which
   * made it documentation. A current level, a computed change and a definition are deterministic
   * output; a model adds nothing to them and can only add something to be wrong about. This is the
   * safe direction of convergence -- narrower than the deterministic path, never wider.
   */
  | "DETERMINISTIC_OPERATION";

export type InferenceAuthorization =
  | { eligible: true; frame: EligibleFrame; reason: string }
  | { eligible: false; blockedBy: IneligibilityReason; frame: RequestFrame; reason: string };

/**
 * Decides whether a request may ever reach a generation step. Pure, deterministic, no network.
 *
 * Order is deliberate. The existing guardrail runs FIRST, so anything it already refuses can never
 * be rescued by a frame that happens to look factual — a sentence can carry a mechanism question
 * and a prohibited request at once, and twenty gates of judgement live in that guardrail.
 */
export function authorizeInference(query: string): InferenceAuthorization {
  const frame = classifyRequestFrame(query);

  if (detectPersonalizedAdviceRequest(query)) {
    return {
      eligible: false,
      blockedBy: "PROHIBITED_REQUEST",
      frame,
      reason:
        "The request guardrail refuses this outright. A factual-looking frame does not overrule " +
        "it: a sentence can ask how something works and ask for a decision in the same breath.",
    };
  }

  if (frame === "REQUEST_DIRECTIVE") {
    return {
      eligible: false,
      blockedBy: "DIRECTIVE_FRAME",
      frame,
      reason:
        "Asks the product to decide, choose, or act. Answered deterministically or redirected.",
    };
  }

  if (frame === "UNKNOWN") {
    return {
      eligible: false,
      blockedBy: "FRAME_NOT_PROVEN",
      frame,
      reason:
        "No frame could be established, which is not the same as nothing being wrong. This is the " +
        "largest class of guardrail miss on a blind holdout — 69 of 82 — and it is exactly the " +
        "class an absence-based rule would send to a model.",
    };
  }

  if (!(INFERENCE_ELIGIBLE_FRAMES as readonly RequestFrame[]).includes(frame)) {
    return {
      eligible: false,
      blockedBy: "FRAME_NOT_ELIGIBLE",
      frame,
      reason:
        `${frame} is a recognised frame and not one generation may serve. A deterministic lookup ` +
        "may answer it from stored data; a model answering it would be inventing.",
    };
  }

  // ---------------------------------------------------------------------------------------------
  // The canonical authority, consulted last, and only where it is POSITIVE.
  //
  // `resolveRequestAuthority` is the operation parser that drives deterministic serving. Where the
  // two authorities disagreed, measurement showed thirteen divergences on the development corpus
  // and one reproduced HIGH exposure: a Korean attributed request that the parser refuses, the
  // legacy frame classifier admits, and whose candidate envelope resolves AUTHORIZED with a real
  // series -- the planner is called for a request nobody authorized.
  //
  // That case is NOT closed here. Closing it means refusing everything the parser calls
  // UNSUPPORTED, and that was measured: legitimate throughput went to zero, because the parser
  // recognises a fifth of written English and none of Korean. Recognition coverage first, then
  // bypass becomes impossible. This is the half that costs nothing: where the canonical authority
  // makes a POSITIVE statement -- prohibited, or recognised-and-deterministic -- it decides.
  //
  // Last, so that every refusal reason above keeps the meaning it had.
  const canonical = resolveRequestAuthority(query);
  if (canonical.status === "PROHIBITED") {
    return {
      eligible: false,
      blockedBy: "CANONICAL_AUTHORITY_PROHIBITED",
      frame,
      reason: canonical.detail,
    };
  }
  if (canonical.status === "AUTHORIZED" && !canonical.contract.plannerPermitted) {
    return {
      eligible: false,
      blockedBy: "DETERMINISTIC_OPERATION",
      frame,
      reason:
        `Recognised as ${canonical.operation}, which repository code answers on its own. A model ` +
        "cannot make a stored level more true and can only make it less so.",
    };
  }

  return {
    eligible: true,
    frame: frame as EligibleFrame,
    reason: `Affirmatively classified ${frame}, and not refused by the request guardrail.`,
  };
}
