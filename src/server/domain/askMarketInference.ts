/**
 * The one place a future model could ever be called from, and the gate in front of it.
 *
 * There is no provider and none is approved (HG-006). This exists so that when one arrives, the
 * safety boundary is already built, already tested, and already proven unreachable for the request
 * classes that must never see a model — rather than being designed under the pressure of a
 * credential that somebody has just paid for.
 *
 * ## Why the sink is a parameter
 *
 * `InferenceSink` is injected, so every test in `tests/inferenceAuthorization.test.ts` can assert
 * something a label-checking test cannot: **the sink was not called.** A test proving
 * `authorizeInference` returns `eligible: false` proves a helper returns a value. A test proving
 * `sink.calls === 0` proves the model was not reached, which is the only claim worth making.
 *
 * The guidance behind this file (`[CHATGPT_ARCHITECT_GUIDANCE][ASK-HOLDOUT-20260823]`) is explicit
 * that a helper-only assertion is insufficient, and it is right: the holdout numbers exist because
 * a well-tested helper sat behind a path that did not consult it for most of its inputs.
 *
 * ## The order, and why every step is required
 *
 *     query
 *       -> authorizeInference        fail closed; only two proven frames continue
 *       -> sink.generate             the future model, and the only call site there will be
 *       -> scanGeneratedOutput       independent of the request, fail closed on unverifiable
 *       -> caller renders
 *
 * A failure at any step returns a deterministic redirect and the model's text is discarded. The
 * output scan runs even for an authorized request, because authorisation is a fact about the
 * question and says nothing about the answer.
 */

import { authorizeInference, type InferenceAuthorization } from "./inferenceAuthorization";
import { scanGeneratedOutput, type OutputContext, type OutputScan } from "./outputPolicy";

/**
 * The future provider, as a contract rather than a dependency.
 *
 * Deliberately minimal and deliberately not imported from anywhere: nothing in this repository
 * implements it, so there is no path from here to a network call, an API key, or a bill.
 */
export interface InferenceSink {
  generate(query: string): Promise<string>;
}

/** How the caller attributes figures. Supplied per request; see `./outputPolicy`. */
export type AttributionLookup = (generated: string) => OutputContext;

export type InferenceOutcome =
  /** The request never reached a model. `generated` is absent because nothing was generated. */
  | { status: "REDIRECTED_BEFORE_MODEL"; authorization: InferenceAuthorization }
  /** A model ran and its output failed the independent scan. The text is not returned. */
  | { status: "OUTPUT_SUPPRESSED"; authorization: InferenceAuthorization; scan: OutputScan }
  /** A model ran and its output passed. */
  | { status: "ANSWERED"; authorization: InferenceAuthorization; scan: OutputScan; text: string };

/**
 * Runs the full future-inference path for one query.
 *
 * The sink is only ever touched inside the `eligible` branch, and that is the property the tests
 * exist to hold. Written as an early return rather than a nested condition so the unreachable case
 * is visible at a glance and hard to accidentally widen.
 */
export async function answerWithInference(
  query: string,
  sink: InferenceSink,
  attribute: AttributionLookup,
): Promise<InferenceOutcome> {
  const authorization = authorizeInference(query);

  if (!authorization.eligible) {
    // No model call. Not "a call that returns nothing" — no call.
    return { status: "REDIRECTED_BEFORE_MODEL", authorization };
  }

  const generated = await sink.generate(query);
  const scan = scanGeneratedOutput(generated, attribute(generated));

  if (scan.verdict !== "CLEAR") {
    // The model ran and said something unpublishable. Its text does not leave this function, which
    // is why `text` is absent from this variant rather than present and ignored by convention.
    return { status: "OUTPUT_SUPPRESSED", authorization, scan };
  }

  return { status: "ANSWERED", authorization, scan, text: generated };
}
