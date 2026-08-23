/**
 * What a future model is allowed to hand us, and why it is not prose.
 *
 * IR-101 reproduced the previous boundary publishing advisory sentences it had no pattern for, a
 * fabricated figure a caller vouched for, and a number that disagreed with the stored value. Those
 * are three symptoms of one design: the model authored the user-facing text, and the repository
 * looked for reasons to stop it. An absence-based rule can only ever stop what somebody anticipated.
 *
 * So the direction is reversed. The model is an **untrusted planner**: it may say which stored
 * record it wants shown, and nothing else. The repository decides what that record says.
 *
 *     model proposes a plan  ->  validatePlan  ->  renderValidatedPlan  ->  user
 *                                ^^^^^^^^^^^^      ^^^^^^^^^^^^^^^^^^^
 *                                repository        repository
 *
 * Nothing in a plan reaches a reader. What reaches a reader is text this module produced from rows
 * this repository stores, and the two facts are independent — a plan can be perfectly formed and
 * still publish nothing, because every word is looked up rather than passed through.
 *
 * ## The closed list, and why there is no third entry
 *
 * A segment names authority or it is rejected. Two kinds of authority exist here, both of them
 * rows nothing at request time can write:
 *
 *  - `EVIDENCE_BOUND_CLAIM` — a Claim Ledger id. Rendered only if that exact stored state verifies
 *    (IR-100's `resolvePublishableClaim`), and rendered from the object that verified.
 *  - `REPOSITORY_EXPLANATION` — a `CausalEdge` id. These are seeded from `prisma/seedCausalEdges.ts`,
 *    checked into the repository, with no create path from a user, a request or a model. The
 *    mechanism text is ours; the model only chooses which of ours to show.
 *
 * There is deliberately **no** `SAFE_PROSE`, no `OTHER`, no `text` field anywhere in the contract
 * and no default branch. A single permissive fallback would restore IR-101 candidate P in one line,
 * which is roughly how it got there the first time.
 *
 * ## Structure is not trust
 *
 * A JSON object from a model is still model output. `{claimId: "abc"}` asserts that abc is worth
 * showing; it establishes nothing. Every field below is validated against storage before it means
 * anything, and a segment carrying an unexpected key is rejected rather than ignored — a model that
 * attaches its own sentence to a real claim id is IR-101 candidate R, and dropping the extra field
 * silently would publish the claim as though the paraphrase had been checked. It has not been:
 * verifying claim A says nothing about a sentence someone wrote next to A.
 */

import { detectProhibitedConstructions, type OutputFinding } from "./outputPolicy";
import { resolvePublishableClaim } from "./claimVerification";
import { quantitativeOccurrences } from "./inferenceClaim";
import { prisma } from "@/server/db/client";

/** The complete list. A `kind` outside it is not a segment, it is a rejection. */
export const OUTPUT_SEGMENT_KINDS = ["EVIDENCE_BOUND_CLAIM", "REPOSITORY_EXPLANATION"] as const;
export type OutputSegmentKind = (typeof OUTPUT_SEGMENT_KINDS)[number];

/** The exact key set each kind may carry. Anything else is malformed, never ignored. */
const SEGMENT_SHAPE: Record<OutputSegmentKind, readonly string[]> = {
  EVIDENCE_BOUND_CLAIM: ["kind", "claimId"],
  REPOSITORY_EXPLANATION: ["kind", "explanationId"],
};

/**
 * Key names that would carry model-authored prose, used only to give a rejection a better name.
 *
 * This list cannot cause a publication: an unexpected key is rejected whether or not it appears
 * here, and this only decides whether the reason reads `MODEL_AUTHORED_PROSE` or
 * `MALFORMED_SEGMENT`. Kept short deliberately — it is a label, and a label that starts making
 * decisions is the enumeration problem coming back through a side door.
 */
const PROSE_KEYS = ["text", "prose", "content", "sentence", "answer", "body", "message"];

export interface EvidenceBoundClaimSegment {
  kind: "EVIDENCE_BOUND_CLAIM";
  claimId: string;
}

export interface RepositoryExplanationSegment {
  kind: "REPOSITORY_EXPLANATION";
  explanationId: string;
}

export type OutputSegment = EvidenceBoundClaimSegment | RepositoryExplanationSegment;

/**
 * What the sink returns. `segments` is `unknown[]` on purpose.
 *
 * Typing it as `OutputSegment[]` would be a lie with a compiler behind it: the value arrives from
 * outside this repository, and TypeScript's guarantee stops at the boundary it was compiled
 * against. Every element is narrowed by `validateOutputPlan` and by nothing else.
 */
export interface GeneratedOutputPlan {
  segments: unknown[];
  /**
   * What the planner would have said in its own words. **Audit channel only — never rendered.**
   *
   * It exists because a planner that proposes advice and a planner that proposes something
   * unrecognised are different problems, and the first deserves to be named. Two checks run over
   * it, and both can only ever REDUCE what publishes:
   *
   *  - the prohibited-construction detector, so obvious advice is reported as advice;
   *  - figure coverage, so a narration asserting a number the authorities do not contain rejects
   *    the plan. That is IR-101 candidate R: naming a real verified claim and stating a different
   *    number beside it.
   *
   * There is no path from this field to `renderValidatedPlan`, and a test asserts the rendered
   * answer never contains it. If that ever stops being true this is a `SAFE_PROSE` segment wearing
   * a different name.
   */
  proposedNarration?: string;
}

export type SegmentRejection =
  | "EMPTY_PLAN"
  | "MALFORMED_PLAN"
  | "MALFORMED_SEGMENT"
  | "UNKNOWN_SEGMENT_KIND"
  | "MODEL_AUTHORED_PROSE"
  | "MISSING_CLAIM_ID"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_NOT_VERIFIED"
  | "MISSING_EXPLANATION_ID"
  | "EXPLANATION_NOT_FOUND"
  | "STALE_EVIDENCE"
  | "FRESHNESS_UNKNOWN"
  | "CLAIM_TYPE_NOT_PUBLISHABLE"
  | "UNSUPPORTED_FIGURE"
  | "PROHIBITED_CONSTRUCTION";

export interface PlanRejection {
  /** Index in the proposed plan, so a reviewer can find the segment that failed. */
  index: number;
  reason: SegmentRejection;
  detail: string;
}

export interface ValidatedSegment {
  kind: OutputSegmentKind;
  /** The authority this segment resolved to: a claim id or a causal-edge id. */
  authorityId: string;
  /** Repository-rendered text. Produced here, from the same state that was checked. */
  renderedText: string;
}

export type PlanValidation =
  | { status: "VALIDATED"; segments: ValidatedSegment[] }
  | {
      status: "REJECTED";
      rejections: PlanRejection[];
      /** Prohibited constructions found in whatever prose the plan tried to carry, if any. */
      findings: OutputFinding[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collects every string a rejected segment was carrying, so the prohibited-construction detector
 * can run over it.
 *
 * The strings are never published — the segment has already failed — but "the planner proposed
 * advice" is a materially different report from "the planner proposed something unrecognised", and
 * the first one is worth surfacing by name.
 */
function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap((v) => stringsIn(v, depth + 1));
  if (isRecord(value)) return Object.values(value).flatMap((v) => stringsIn(v, depth + 1));
  return [];
}

/**
 * Digit runs in a string, with ISO dates blanked.
 *
 * Reuses `quantitativeOccurrences` from the inference verifier rather than writing a second number
 * scanner — IR-095 already settled that dates must be blanked rather than removed, and two
 * definitions of "a figure" in one codebase is how the first one stops being true.
 */
function figuresIn(text: string): string[] {
  return quantitativeOccurrences(text).map((o) => o.surfaceText.replace(/[%,]/g, ""));
}

/**
 * Every figure the planner narrated must appear in the text the repository is about to publish.
 *
 * This is the replacement for `attributableFigures`, and the difference is where the list comes
 * from: the old one came from the caller asking for publication, this one is derived from the
 * verified claims themselves. A caller cannot widen it by asserting anything, which is IR-101
 * candidates Q and R closed at their root rather than at their symptoms.
 *
 * Coverage is one-directional on purpose. The rendered authority may contain figures the narration
 * never mentioned — that is the repository saying more than the planner asked for, which is fine.
 * The reverse is the planner asserting something unsourced, which is not.
 */
function uncoveredFigures(narration: string, renderedAuthority: string): string[] {
  const authorised = new Set(figuresIn(renderedAuthority));
  return [...new Set(figuresIn(narration))].filter((figure) => !authorised.has(figure));
}

/**
 * Validates one proposed segment against storage, returning either rendered text or a reason.
 *
 * Written as an exhaustive switch over the closed kind list with no default branch that produces a
 * segment — the only fallthrough is a rejection.
 */
async function validateSegment(
  raw: unknown,
  index: number,
): Promise<{ segment: ValidatedSegment } | { rejection: PlanRejection }> {
  const reject = (reason: SegmentRejection, detail: string) => ({
    rejection: { index, reason, detail },
  });

  if (!isRecord(raw)) {
    return reject("MALFORMED_SEGMENT", `Segment ${index} is not an object.`);
  }

  const kind = raw.kind;
  if (typeof kind !== "string" || !OUTPUT_SEGMENT_KINDS.includes(kind as OutputSegmentKind)) {
    // Includes the case that matters most: a `SAFE_PROSE`/`OTHER` segment carrying model text.
    const reason = Object.keys(raw).some((k) => PROSE_KEYS.includes(k))
      ? "MODEL_AUTHORED_PROSE"
      : "UNKNOWN_SEGMENT_KIND";
    return reject(
      reason,
      `Segment ${index} has kind ${JSON.stringify(kind)}, which names no repository authority. ` +
        `The publishable kinds are ${OUTPUT_SEGMENT_KINDS.join(", ")}.`,
    );
  }

  const allowed = SEGMENT_SHAPE[kind as OutputSegmentKind];
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    // A real claim id with a paraphrase attached — IR-101 candidate R. Verifying the claim says
    // nothing about the sentence, so the segment fails rather than the sentence being dropped.
    const reason = extra.some((k) => PROSE_KEYS.includes(k))
      ? "MODEL_AUTHORED_PROSE"
      : "MALFORMED_SEGMENT";
    return reject(
      reason,
      `Segment ${index} carries ${extra.map((k) => JSON.stringify(k)).join(", ")}, which this ` +
        "contract does not accept. A model may name repository authority; it may not supply content.",
    );
  }

  if (kind === "EVIDENCE_BOUND_CLAIM") {
    const claimId = raw.claimId;
    if (typeof claimId !== "string" || claimId.length === 0) {
      return reject("MISSING_CLAIM_ID", `Segment ${index} names no claim id.`);
    }

    const resolved = await resolvePublishableClaim(claimId);
    if (resolved.status === "NOT_FOUND") {
      return reject(
        "CLAIM_NOT_FOUND",
        `Segment ${index} names claim ${claimId}, which is not stored.`,
      );
    }
    if (resolved.status === "NOT_VERIFIED") {
      return reject(
        "CLAIM_NOT_VERIFIED",
        `Segment ${index} names claim ${claimId}, which did not verify ` +
          `(${resolved.verification.status}): ${resolved.verification.detail}`,
      );
    }
    if (resolved.status !== "PUBLISHABLE") {
      // Stale evidence, unknown freshness, or a claim type with no bounded meaning. The single
      // publication gate lives in `resolvePublishableClaim` so that this route and
      // `publishClaimForDisplay` cannot drift apart — IR-102 found them already apart.
      return reject(resolved.status, `Segment ${index}: ${resolved.detail}`);
    }

    return {
      segment: {
        kind: "EVIDENCE_BOUND_CLAIM",
        authorityId: claimId,
        // The text rendered by `resolvePublishableClaim` from the object it verified. Not re-read.
        renderedText: resolved.renderedText,
      },
    };
  }

  const explanationId = raw.explanationId;
  if (typeof explanationId !== "string" || explanationId.length === 0) {
    return reject("MISSING_EXPLANATION_ID", `Segment ${index} names no explanation id.`);
  }

  const edge = await prisma.causalEdge.findUnique({ where: { id: explanationId } });
  if (!edge) {
    return reject(
      "EXPLANATION_NOT_FOUND",
      `Segment ${index} names explanation ${explanationId}, which is not stored.`,
    );
  }

  return {
    segment: {
      kind: "REPOSITORY_EXPLANATION",
      authorityId: explanationId,
      renderedText: renderCausalEdge(edge),
    },
  };
}

/**
 * Renders a seeded causal edge. Every word comes from the stored row or from this function.
 *
 * The counterexample is not optional and not a footnote. `docs/LEGAL_GUARDRAILS.md` requires that
 * analytical output state its limitations rather than imply certainty, and a transmission mechanism
 * presented without its known exceptions is exactly the implication it prohibits. The column is
 * `NOT NULL` for the same reason, so there is no case where this is omitted.
 */
function renderCausalEdge(edge: {
  fromVariable: string;
  toVariable: string;
  direction: string;
  confidence: string;
  mechanism: string;
  lag: string;
  counterexamples: string;
}): string {
  return (
    `[MECHANISM] ${edge.fromVariable} → ${edge.toVariable} (${edge.direction}, ` +
    `confidence ${edge.confidence}, typical lag ${edge.lag}). ${edge.mechanism} ` +
    `Known limitation: ${edge.counterexamples}`
  );
}

/**
 * Validates a whole proposed plan, all or nothing.
 *
 * Every segment is checked even after one has failed, because a reviewer needs the whole list — but
 * one failure withholds the entire answer. Partial publication is the failure mode where the safe
 * half of a bad answer reaches a reader wearing the authority of the checked half, and IR-101's S1
 * is the only property the previous boundary already had. It is kept.
 */
export async function validateOutputPlan(plan: unknown): Promise<PlanValidation> {
  if (isRecord(plan)) {
    const extra = Object.keys(plan).filter((k) => !["segments", "proposedNarration"].includes(k));
    if (extra.length > 0) {
      // A legacy `{text: "..."}` response arrives here, and so does anything else a sink invents.
      const reason = extra.some((k) => PROSE_KEYS.includes(k))
        ? "MODEL_AUTHORED_PROSE"
        : "MALFORMED_PLAN";
      return {
        status: "REJECTED",
        rejections: [
          {
            index: -1,
            reason,
            detail:
              `A plan carries ${extra.map((k) => JSON.stringify(k)).join(", ")}, which this ` +
              "contract does not accept. A planner names repository authority; it does not supply text.",
          },
        ],
        findings: detectProhibitedConstructions(stringsIn(plan).join("\n")).findings,
      };
    }
  }

  if (!isRecord(plan) || !Array.isArray(plan.segments)) {
    return {
      status: "REJECTED",
      rejections: [
        {
          index: -1,
          reason: "MALFORMED_PLAN",
          detail: "A plan must be an object with a segments array.",
        },
      ],
      findings: detectProhibitedConstructions(stringsIn(plan).join("\n")).findings,
    };
  }

  if (plan.segments.length === 0) {
    return {
      status: "REJECTED",
      rejections: [
        { index: -1, reason: "EMPTY_PLAN", detail: "A plan with no segments publishes nothing." },
      ],
      findings: detectProhibitedConstructions(stringsIn(plan).join("\n")).findings,
    };
  }

  const segments: ValidatedSegment[] = [];
  const rejections: PlanRejection[] = [];
  const rejectedStrings: string[] =
    typeof plan.proposedNarration === "string" ? [plan.proposedNarration] : [];

  for (const [index, raw] of plan.segments.entries()) {
    const result = await validateSegment(raw, index);
    if ("segment" in result) {
      segments.push(result.segment);
    } else {
      rejections.push(result.rejection);
      rejectedStrings.push(...stringsIn(raw));
    }
  }

  if (rejections.length > 0) {
    return {
      status: "REJECTED",
      rejections,
      findings: detectProhibitedConstructions(rejectedStrings.join("\n")).findings,
    };
  }

  const narration = typeof plan.proposedNarration === "string" ? plan.proposedNarration : "";
  if (narration.length > 0) {
    const detection = detectProhibitedConstructions(narration);
    if (detection.blocked) {
      // Every segment validated and the answer is still withheld. Authorised evidence does not
      // launder the sentence the planner wanted to wrap around it.
      return {
        status: "REJECTED",
        rejections: [{ index: -1, reason: "PROHIBITED_CONSTRUCTION", detail: detection.reason }],
        findings: detection.findings,
      };
    }

    const uncovered = uncoveredFigures(narration, segments.map((s) => s.renderedText).join("\n"));
    if (uncovered.length > 0) {
      return {
        status: "REJECTED",
        rejections: [
          {
            index: -1,
            reason: "UNSUPPORTED_FIGURE",
            detail:
              `The narration asserts ${uncovered.slice(0, 5).join(", ")}, which the verified ` +
              "authorities do not contain. A figure is sourced by a stored claim or it is not sourced.",
          },
        ],
        findings: [],
      };
    }
  }

  return { status: "VALIDATED", segments };
}

/**
 * Joins validated segments with a fixed separator, and does nothing else.
 *
 * Takes the validation result rather than a string array so there is no way to call it with text
 * that did not come out of `validateOutputPlan`. The separator is a newline: connective prose
 * ("Therefore", "Clearly", "You should note that") changes what an answer asserts, so a model does
 * not get to write it and this function does not invent it either.
 */
export function renderValidatedPlan(validation: PlanValidation): string {
  if (validation.status !== "VALIDATED") {
    throw new Error("renderValidatedPlan received a rejected plan; this should be unreachable.");
  }
  return validation.segments.map((s) => s.renderedText).join("\n");
}
