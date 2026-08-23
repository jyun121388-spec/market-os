/**
 * The one place a future model could ever be called from, and the two gates around it.
 *
 * There is no provider and none is approved (HG-006). This exists so that when one arrives, the
 * safety boundary is already built, already tested, and already proven unreachable for the request
 * classes that must never see a model — rather than being designed under the pressure of a
 * credential that somebody has just paid for.
 *
 * ## What changed, and why the sink no longer returns text
 *
 * It used to return a string, and that string was the answer if a scanner could not find anything
 * wrong with it. IR-101 measured what "could not find anything wrong" is worth: advisory prose in
 * two languages published because no pattern anticipated it, a fabricated figure published because
 * the caller vouched for it, and a number that disagreed with the stored value published because
 * nothing compared them. One design produced all three — the model wrote the answer, and the
 * repository looked for reasons to stop it.
 *
 * So the sink returns a **plan** (`./outputPlan`): which stored records it wants shown. The
 * repository renders those records. There is no field in the contract through which a model's
 * sentence can become a user's answer, which is a stronger statement than "the scanner is good".
 *
 * ## Why the sink is still a parameter
 *
 * `InferenceSink` is injected, so tests can assert something a label-checking test cannot: **the
 * sink was not called.** A test proving `authorizeInference` returns `eligible: false` proves a
 * helper returns a value. A test proving `sink.calls === 0` proves the model was not reached.
 *
 * ## The order, and why every step is required
 *
 *     query
 *       -> authorizeInference      fail closed; only two proven frames continue
 *       -> sink.generatePlan       the future model, and the only call site there will be
 *       -> validateOutputPlan      every segment resolved against storage and verified
 *       -> renderValidatedPlan     repository text, from the state that was checked
 *       -> detectProhibited...     defence in depth over what is about to be shown
 *       -> caller renders
 *
 * A failure at any step returns a deterministic redirect or suppression, and nothing the planner
 * proposed survives it. Validation runs even for an authorized request, because authorisation is a
 * fact about the question and says nothing about the answer.
 */

import { authorizeInference, type InferenceAuthorization } from "./inferenceAuthorization";
import { detectProhibitedConstructions, type OutputFinding } from "./outputPolicy";
import {
  renderValidatedPlan,
  validateOutputPlan,
  type GeneratedOutputPlan,
  type PlanValidation,
} from "./outputPlan";
import {
  deriveCandidateEnvelope,
  isEmptyEnvelope,
  type CandidateEnvelope,
} from "./candidateEnvelope";

/**
 * The future provider, as a contract rather than a dependency.
 *
 * Deliberately minimal and deliberately not imported from anywhere: nothing in this repository
 * implements it, so there is no path from here to a network call, an API key, or a bill.
 *
 * It returns `unknown`, not `GeneratedOutputPlan`. A declared return type would describe what a
 * well-behaved provider sends, and the boundary exists for the other kind — every field is narrowed
 * by `validateOutputPlan`. `GeneratedOutputPlan` is exported for the callers who build plans, not
 * as a promise about what arrives.
 */
export interface InferenceSink {
  /**
   * The envelope is passed so a well-behaved planner can see what it may choose from. It is a
   * courtesy, not a channel: validation re-reads the envelope from this module's own variable, so
   * nothing the planner returns can widen it.
   */
  generatePlan(query: string, candidates: CandidateEnvelope): Promise<unknown>;
}

/** Re-exported so a stub sink can be written against the contract without a second import. */
export type { GeneratedOutputPlan };

/**
 * Why an answer is or is not publishable. Structural now, not the residue of a pattern sweep.
 *
 *  - `CLEAR` — every semantic segment resolved to repository authority, each one verified, and the
 *    rendered result carries no named prohibited construction.
 *  - `BLOCKED` — a named prohibited construction was found. Auditable, and takes precedence.
 *  - `UNVERIFIABLE` — something in the plan had no positive authority. The default for anything
 *    unrecognised, which is the whole point.
 */
export type OutputVerdict = "CLEAR" | "BLOCKED" | "UNVERIFIABLE";

export interface OutputAssessment {
  verdict: OutputVerdict;
  findings: OutputFinding[];
  reason: string;
  /** Present when a plan was rejected, so a reviewer sees which segment failed and why. */
  validation?: PlanValidation;
}

export type InferenceOutcome =
  /** The request never reached a model. `text` is absent because nothing was generated. */
  | { status: "REDIRECTED_BEFORE_MODEL"; authorization: InferenceAuthorization }
  /**
   * The request was allowed but the repository holds nothing that speaks to it, so no model was
   * consulted. Distinct from a redirect on purpose: the question was fine, the shelves are empty,
   * and an empty envelope must never read as permission to improvise.
   */
  | {
      status: "NO_CANDIDATE_EVIDENCE";
      authorization: InferenceAuthorization;
      envelope: CandidateEnvelope;
    }
  /** A model ran and its plan did not survive validation. Nothing it proposed is returned. */
  | { status: "OUTPUT_SUPPRESSED"; authorization: InferenceAuthorization; scan: OutputAssessment }
  /** A model ran, its plan validated, and the repository rendered the records it named. */
  | {
      status: "ANSWERED";
      authorization: InferenceAuthorization;
      scan: OutputAssessment;
      text: string;
    };

/**
 * Runs the full future-inference path for one query.
 *
 * Takes two arguments. It used to take three — the third was an `AttributionLookup` the caller
 * supplied to say which figures were attributable, which is IR-101 candidates Q and R: the party
 * asking for publication was also the party certifying it. There is no replacement parameter,
 * because the replacement is not a parameter. Numeric authority is the verified stored claim, and
 * `outputPlan` reads it from the database.
 */
export async function answerWithInference(
  query: string,
  sink: InferenceSink,
): Promise<InferenceOutcome> {
  const authorization = authorizeInference(query);

  if (!authorization.eligible) {
    // No model call. Not "a call that returns nothing" — no call.
    return { status: "REDIRECTED_BEFORE_MODEL", authorization };
  }

  // Derived from the query by the repository, before the planner is consulted. IR-103: without
  // this the planner chose which authentic record represented the answer, and a question about a
  // series we have never heard of still reached the model.
  const envelope = await deriveCandidateEnvelope(query);
  if (isEmptyEnvelope(envelope)) {
    // AMBIGUOUS and UNRESOLVED both stop here. IR-104: an ambiguous subject used to put every
    // near-match in the envelope and let the planner pick, which is candidate authority handed
    // back to the model in all but name.
    return { status: "NO_CANDIDATE_EVIDENCE", authorization, envelope };
  }

  const proposed = await sink.generatePlan(query, envelope);
  const validation = await validateOutputPlan(proposed, envelope);

  if (validation.status === "REJECTED") {
    // BLOCKED when the planner proposed something nameable, UNVERIFIABLE otherwise. Both withhold
    // the whole answer; the difference is only what gets reported, and a named reason is worth
    // more to whoever reads the log than "something was wrong".
    const blocked = validation.findings.length > 0;
    return {
      status: "OUTPUT_SUPPRESSED",
      authorization,
      scan: {
        verdict: blocked ? "BLOCKED" : "UNVERIFIABLE",
        findings: validation.findings,
        reason: validation.rejections.map((r) => `${r.reason}: ${r.detail}`).join(" "),
        validation,
      },
    };
  }

  const rendered = renderValidatedPlan(validation);

  // Defence in depth over repository-owned text. This should never fire — every word came from a
  // verified claim or a seeded explanation — and if it ever does, a stored record is the problem
  // and publishing it would be worse than suppressing a legitimate answer.
  const detection = detectProhibitedConstructions(rendered);
  if (detection.blocked) {
    return {
      status: "OUTPUT_SUPPRESSED",
      authorization,
      scan: {
        verdict: "BLOCKED",
        findings: detection.findings,
        reason: `Repository-rendered output carries a prohibited construction: ${detection.reason}`,
        validation,
      },
    };
  }

  return {
    status: "ANSWERED",
    authorization,
    scan: {
      verdict: "CLEAR",
      findings: [],
      reason: `Every segment resolved to repository authority (${validation.segments
        .map((s) => `${s.kind}:${s.authorityId}`)
        .join(", ")}) and the rendered result carries no named prohibited construction.`,
      validation,
    },
    text: rendered,
  };
}
