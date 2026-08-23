/**
 * Which stored records could answer THIS question — decided by the repository, before any model.
 *
 * IR-101 stopped the planner writing the answer. IR-102 stopped it publishing propositions whose
 * meaning nothing bounds. Both left one thing in the planner's hands: **which** authentic record is
 * presented as the answer. A stop-loss question came back with a shipping-freight index, a
 * mechanism question with a cabbage-to-kimchi causal edge, and a question about a series the
 * repository has never heard of still called the model. Every record was real, verified, fresh and
 * rendered by this repository in its own words. The planner chose which truth to tell.
 *
 *     query
 *       -> authorizeInference          may this be asked at all
 *       -> deriveCandidateEnvelope     what could answer it, from OUR indexes
 *       -> (empty) stop here           an empty envelope is not planner permission
 *       -> sink.generatePlan           the planner ranks inside the envelope
 *       -> membership re-checked       against the envelope WE built, not what came back
 *       -> verify / freshness / class / render
 *
 * ## Why this reuses `askMarket`'s matcher instead of adding one
 *
 * `askMarket.ts` has answered "which series and which causal edges is this query about" since M07,
 * deterministically, from series names and causal-graph variable names, through
 * `mentionsEachOther` — substring either way, else a 0.6 containment ratio over the shared keyword
 * tokenizer. That is the repository's existing notion of subject relevance, and a second one would
 * mean two answers to one question and an eventual argument about which is right. If the matcher is
 * too loose or too tight, it is too loose or too tight in both places, which is the honest failure
 * mode.
 *
 * ## What an envelope is not
 *
 * It is not evidence that a record is true, current, or of a publishable kind — those are asked
 * afterwards and separately. It is not derived from anything the planner says: it is built before
 * the call and re-read from the repository's own variable afterwards, so a plan cannot widen it by
 * asserting an id, a subject, or a relevance score. And it is not a claim that the envelope is
 * complete: a record the matcher misses is simply unavailable, which is the fail-closed direction.
 */

import { prisma } from "@/server/db/client";
import { mentionsEachOther } from "./askMarket";

export interface CandidateEnvelope {
  /** The authorized query the envelope was derived from. */
  query: string;
  /** Series the repository judges this query to be about. */
  seriesIds: readonly string[];
  /** Causal edges naming a variable this query is about. */
  causalEdgeIds: readonly string[];
}

/** Nothing in the repository speaks to this question, so nothing may be published about it. */
export function isEmptyEnvelope(envelope: CandidateEnvelope): boolean {
  return envelope.seriesIds.length === 0 && envelope.causalEdgeIds.length === 0;
}

/**
 * Derives the candidate envelope for an authorized query.
 *
 * Deliberately takes only the query text. Passing the authorization result would invite the
 * mistake the guidance names — letting `eligible` stand in for relevance — and these are separate
 * authorities: one says the question may be asked, the other says what could answer it.
 */
export async function deriveCandidateEnvelope(query: string): Promise<CandidateEnvelope> {
  const topic = query.trim();
  if (!topic) {
    return { query: topic, seriesIds: [], causalEdgeIds: [] };
  }

  const [allSeries, allEdges] = await Promise.all([
    prisma.series.findMany({ select: { id: true, name: true } }),
    prisma.causalEdge.findMany({ select: { id: true, fromVariable: true, toVariable: true } }),
  ]);

  return {
    query: topic,
    seriesIds: allSeries.filter((s) => mentionsEachOther(s.name, topic)).map((s) => s.id),
    causalEdgeIds: allEdges
      .filter(
        (e) => mentionsEachOther(e.fromVariable, topic) || mentionsEachOther(e.toVariable, topic),
      )
      .map((e) => e.id),
  };
}

/**
 * Is the series behind this claim one the question was about?
 *
 * Reads the stored claim's own evidence, never a subject the plan asserted. A claim whose evidence
 * names no series is not a member: FACT and CALCULATION both carry `seriesId` by construction, so
 * the absence means something unexpected is being published and the fail-closed answer is no.
 */
export function claimIsCandidate(evidence: unknown, envelope: CandidateEnvelope): boolean {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) return false;
  const seriesId = (evidence as Record<string, unknown>).seriesId;
  if (typeof seriesId !== "string" || seriesId.length === 0) return false;
  return envelope.seriesIds.includes(seriesId);
}

/** Is this stored explanation one the question was about? */
export function explanationIsCandidate(
  explanationId: string,
  envelope: CandidateEnvelope,
): boolean {
  return envelope.causalEdgeIds.includes(explanationId);
}
