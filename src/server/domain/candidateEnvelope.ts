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
import { resolveSourceIdentity } from "./sourceAuthority";
import { resolveRequestAuthority } from "./requestAuthority";
import { mentionsEachOther } from "./askMarket";
import {
  determinerOnlyFraming,
  regionIsExactlyFramingAndIdentity,
  resolveStoredSubject,
  resolveSubjectAuthority,
  variablesNamedIn,
  type AuthorizedOperation,
  type SubjectAuthorityStatus,
} from "./subjectAuthority";
import type { CanonicalPlannerRequest } from "./requestAuthority";

export interface CandidateEnvelope {
  /**
   * The request text, for AUDIT AND THE PLANNER PROMPT ONLY.
   *
   * On the canonical path this field decides nothing. It said "the authorized query the envelope
   * was derived from", which was true and is exactly the reading that has to stop: the canonical
   * envelope is derived from the carried `CanonicalPlannerRequest`, and the text is kept so a log
   * can show what was asked and so the planner has prose to read. A future caller reaching for it
   * to work out what the request meant would be reintroducing the second parser this unit removed.
   */
  query: string;
  /**
   * Exact / ambiguous / unresolved, from `./subjectAuthority`. Only `AUTHORIZED` may publish, and
   * the two failing states are kept apart because they mean different things: nothing stored is
   * about this, versus more than one thing is and the question did not choose.
   */
  status: SubjectAuthorityStatus;
  /** What kind of record the frame asks for. Absent when nothing is authorized. */
  operation?: AuthorizedOperation;
  /**
   * Series whose **FACT** claims may answer. Not "series that came up" — IR-104: retrieval
   * surfaced adjacent subjects by the dozen and every one of them was authentic.
   */
  seriesIds: readonly string[];
  /** Causal edges whose stored mechanism may answer, both endpoints named by the question. */
  causalEdgeIds: readonly string[];
  /** Resolved subject names, for logs and assertions. */
  subjects: readonly string[];
  detail: string;
}

/**
 * Nothing may be published for this question, whether because nothing was resolved or because too
 * much was. A planner is not consulted in either case.
 */
export function isEmptyEnvelope(envelope: CandidateEnvelope): boolean {
  return (
    envelope.status !== "AUTHORIZED" ||
    (envelope.seriesIds.length === 0 && envelope.causalEdgeIds.length === 0)
  );
}

/**
 * Derives the candidate envelope for an authorized query: discovery, then authority.
 *
 * Two stages with different jobs and different tolerances.
 *
 *  - **Discovery** is `mentionsEachOther`, unchanged and still shared with `askMarket`. It may
 *    over-produce; that is what a retrieval predicate is for, and it costs nothing here because
 *    nothing it finds is authorized by being found.
 *  - **Authority** is `resolveSubjectAuthority`, which may only subtract. Exact stored names
 *    occurring in the question, maximal specificity, both endpoints for a mechanism, and the
 *    frame's own operation.
 *
 * Deliberately takes only the query text. Passing the authorization result would invite the mistake
 * the guidance names — letting `eligible` stand in for relevance — and these are separate
 * authorities: one says the question may be asked, this says what could answer it.
 */
/**
 * Candidate authority for a request the CANONICAL parser recognised.
 *
 * IR-107 Unit 2 Phase B2. The sibling below takes raw text and works out afresh what the request
 * meant — it reconstructs the topic, discovers subjects and endpoints against the whole query, and
 * hands all of it to `resolveSubjectAuthority`, which reclassifies the frame and re-parses relation
 * syntax for direction, cardinality and polarity. Fourteen places in total. One sentence, two
 * parsers, and the lower one winning because it is the one holding the records.
 *
 * This one is handed the parse and does not repeat any of it. Its only job is the second question:
 * WHICH STORED RECORDS satisfy a meaning that is already settled. That is why `status` here means
 * repository identity resolution and nothing else — AUTHORIZED is one identity found, AMBIGUOUS is
 * several, UNRESOLVED is none — where the legacy status conflated that with whether the request had
 * been understood at all.
 *
 * `query` is carried into the envelope for audit and for the planner's prompt. It decides nothing.
 *
 * The operation mapping is exhaustive and has no default. Three canonical operations are
 * `plannerPermitted: false` and cannot arrive here: the type will not express them, because
 * `CanonicalPlannerRequest` is narrowed through a switch in `asPlannerRequest` rather than asserted.
 */
export async function deriveCanonicalCandidateEnvelope(
  query: string,
  request: CanonicalPlannerRequest,
): Promise<CandidateEnvelope> {
  const refuse = (
    status: SubjectAuthorityStatus,
    operation: AuthorizedOperation,
    detail: string,
    subjects: readonly string[] = [],
  ): CandidateEnvelope => ({
    query,
    status,
    operation,
    seriesIds: [],
    causalEdgeIds: [],
    subjects,
    detail,
  });

  switch (request.operation) {
    case "ATTRIBUTED_REPORTED_OBSERVATION": {
      const operation = "REPORTED_OBSERVATION" as const;
      // Loaded whole and filtered by IDENTITY, rather than discovered by a similarity pass over the
      // raw query. Discovery narrowing is a performance stage and this path has no query to narrow
      // with; if the row count ever justifies one, it must be a repository-safe predicate over the
      // canonical region, never fuzzy matching over the request.
      //
      // SOURCE IDENTITY BEFORE SUBJECT. IR-107 B2-C, and the ordering is the repair.
      //
      // This branch resolved by subject alone and never read `request.sourceRegion`, which the
      // planner request has carried all along. Measured against real PostgreSQL: with only provider
      // Y publishing the subject, `What did <X> analysts publish about <subject>?` returned
      // AUTHORIZED carrying Y's series, and `answerWithInference` then called the planner with it.
      // The number was real, the subject was right, and the attribution was false.
      //
      // Attribution is therefore a candidate-authority dimension, not a label applied afterwards:
      // the requested provider is resolved to exactly one stored `Source` FIRST, and the subject is
      // then looked for only among that provider's series. A row belonging to anyone else cannot be
      // reached, rather than being reached and then filtered.
      const source = await resolveSourceIdentity(request.sourceRegion ?? "");
      if (source.status === "AMBIGUOUS") {
        return refuse(
          "AMBIGUOUS",
          operation,
          `The request names ${source.codes.length} stored providers ` +
            `(${source.codes.join(", ")}), and an attributed observation reports what ONE of them ` +
            "said. Choosing between them would invent the attribution.",
          source.codes,
        );
      }
      if (source.status === "RESIDUE") {
        return refuse(
          "UNRESOLVED",
          operation,
          "The source role names a stored provider and then says more. A provider name occurring " +
            "inside a longer role is not authority to attribute a reading to that provider.",
        );
      }
      if (source.status === "UNRESOLVED") {
        // FAIL CLOSED, and this is the throughput cost of the unit, named rather than discovered
        // later. `What did analysts publish about X?` names no stored provider, so there is no
        // attribution to make and nothing may be published as though there were. Quantified in
        // `scripts/legacy-bypass-readiness.ts` and the packet.
        return refuse(
          "UNRESOLVED",
          operation,
          `No stored provider is named by the authorized source region ` +
            `"${(request.sourceRegion ?? "").trim()}", so there is no attribution this repository ` +
            "can make.",
        );
      }
      const owned = await prisma.series.findMany({
        where: { sourceId: source.sourceId },
        select: { id: true, name: true },
      });
      const resolved = resolveStoredSubject(
        request.subjectRegion,
        request.subjectIdentity,
        owned,
        (series) => series.name,
      );
      if (resolved.length === 0) {
        return refuse(
          "UNRESOLVED",
          operation,
          `No series published by ${source.code} is named by the authorized subject region ` +
            `"${request.subjectRegion.trim()}". Another provider may publish it; that would be a ` +
            "different question.",
        );
      }
      if (resolved.length > 1) {
        return refuse(
          "AMBIGUOUS",
          operation,
          `The authorized subject region names ${resolved.length} materially distinct stored ` +
            "subjects, and this operation answers about one.",
          resolved.map((series) => series.name),
        );
      }
      return {
        query,
        status: "AUTHORIZED",
        operation,
        seriesIds: [resolved[0].id],
        causalEdgeIds: [],
        subjects: [resolved[0].name],
        detail: `Resolved to the stored series "${resolved[0].name}" from the canonical parse.`,
      };
    }

    case "STORED_MECHANISM": {
      const operation = "STORED_MECHANISM" as const;
      // Direction, polarity and one-clause cardinality were established by the canonical parser and
      // travel as two REGIONS. Nothing here re-reads the sentence; the remaining question is which
      // stored variable each region names, and whether an edge runs from the first to the second.
      const cause = request.causeRegion ?? "";
      const effect = request.effectRegion ?? "";
      if (!cause.trim() || !effect.trim()) {
        return refuse(
          "UNRESOLVED",
          operation,
          "The canonical mechanism parse carries no cause or effect region.",
        );
      }
      const edges = await prisma.causalEdge.findMany({
        select: { id: true, fromVariable: true, toVariable: true },
      });
      // Each role resolved against its OWN side's vocabulary, so a variable that only ever appears
      // as an effect cannot be read as the cause of something.
      const causes = variablesNamedIn(cause, [...new Set(edges.map((e) => e.fromVariable))]);
      const effects = variablesNamedIn(effect, [...new Set(edges.map((e) => e.toVariable))]);
      if (causes.length === 0 || effects.length === 0) {
        return refuse(
          "UNRESOLVED",
          operation,
          `The authorized regions name ${causes.length} stored cause(s) and ${effects.length} ` +
            "stored effect(s); a relation needs one of each.",
        );
      }
      if (causes.length > 1 || effects.length > 1) {
        return refuse(
          "AMBIGUOUS",
          operation,
          `The authorized regions name ${causes.length} cause(s) and ${effects.length} effect(s), ` +
            "and letting stored inventory choose the pair would answer a different question.",
          [...causes, ...effects],
        );
      }
      // The cause region must read as recognised framing, then the resolved subject, and nothing
      // else — IR-106's structural half of polarity, and the architecture round said to omit it
      // here on the grounds that upstream had already established an affirmed clause.
      //
      // It had not, and three existing tests caught it within a minute of the branch going in.
      // `mechanismMatch` checks `relationSyntax` polarity, which reads a negation MARKER; IR-106
      // added this because a denylist of ways to deny something cannot be finished. So
      // `Explain how it is false that A affects B.` parses as AFFIRMED, arrives here as a canonical
      // parse, and without this check resolves the stored A -> B edge and answers the opposite of
      // what was asked. The same hole exists on the deterministic serving path and is recorded.
      //
      // It stays in the candidate layer rather than moving upstream because it needs the RESOLVED
      // identity: the question is whether everything before the stored cause name is framing, and
      // the parser does not know where the name ends. That makes it identity validation, not a
      // second reading of the request.
      //
      // BOTH regions, and the effect side was missing. Adversarial review found it: the parser
      // hands back everything after the verb as the effect region, so
      // `Explain how A affects B only if C.` carries `effectRegion = "b only if something else"`.
      // Finding B inside that and authorizing A -> B answers an UNCONDITIONAL question when a
      // conditional one was asked — the same class of error as the denial, on the other side of
      // the verb, and the cause-only check could not see it.
      //
      // One rule serves both, which is why it was renamed: it asks whether a region is recognised
      // framing plus this identity and NOTHING ELSE. On the cause side the leftover qualifies the
      // verb ("may not", "never"); on the effect side it qualifies the proposition ("only if",
      // "unless"). Neither has been read, and unread is not affirmed.
      for (const [region, identity, side] of [
        [cause, causes[0], "cause"],
        [effect, effects[0], "effect"],
      ] as const) {
        if (regionIsExactlyFramingAndIdentity(region, identity, determinerOnlyFraming)) continue;
        return refuse(
          "UNRESOLVED",
          operation,
          `The authorized ${side} region "${region.trim().slice(-60)}" is not recognised framing ` +
            "followed by the subject. Something qualifies the relation that this grammar has not " +
            "read, and unread is not affirmed.",
          [causes[0], effects[0]],
        );
      }

      // Exact on BOTH endpoints and in the authorized direction. A reverse edge is a different
      // relation, and an edge sharing one endpoint is a different relation again.
      const exact = edges.filter(
        (e) => e.fromVariable === causes[0] && e.toVariable === effects[0],
      );
      if (exact.length === 0) {
        return refuse(
          "UNRESOLVED",
          operation,
          `No stored mechanism runs from "${causes[0]}" to "${effects[0]}". An edge running the ` +
            "other way, or sharing one endpoint, is a different relation.",
          [causes[0], effects[0]],
        );
      }
      if (exact.length > 1) {
        return refuse(
          "AMBIGUOUS",
          operation,
          `${exact.length} stored mechanisms run from "${causes[0]}" to "${effects[0]}".`,
          exact.map((e) => `${e.fromVariable} -> ${e.toVariable}`),
        );
      }
      return {
        query,
        status: "AUTHORIZED",
        operation,
        seriesIds: [],
        causalEdgeIds: [exact[0].id],
        subjects: [causes[0], effects[0]],
        detail: `Resolved to the stored mechanism "${causes[0]} -> ${effects[0]}".`,
      };
    }
  }
}

export async function deriveLegacyCandidateEnvelope(query: string): Promise<CandidateEnvelope> {
  const topic = query.trim();
  if (!topic) {
    return {
      query: topic,
      status: "UNRESOLVED",
      seriesIds: [],
      causalEdgeIds: [],
      subjects: [],
      detail: "An empty query resolves to nothing.",
    };
  }

  const [allSeries, allEdges] = await Promise.all([
    prisma.series.findMany({ select: { id: true, name: true } }),
    prisma.causalEdge.findMany({ select: { id: true, fromVariable: true, toVariable: true } }),
  ]);

  const discovered = {
    seriesIds: allSeries.filter((s) => mentionsEachOther(s.name, topic)).map((s) => s.id),
    causalEdgeIds: allEdges
      .filter(
        (e) => mentionsEachOther(e.fromVariable, topic) || mentionsEachOther(e.toVariable, topic),
      )
      .map((e) => e.id),
  };

  const authority = await resolveSubjectAuthority(topic, discovered);

  // ATTRIBUTED FACTS FAIL CLOSED ON THIS DOOR. IR-107 B2-C §4.
  //
  // Frame eligibility is not proof of a source. This path reached REPORTED_OBSERVATION through
  // subject authority alone and published whichever provider happened to hold the subject, which
  // reproduced as the same wrong-source substitution the canonical path had: with only Y stored, a
  // request naming X came back AUTHORIZED carrying Y's series.
  //
  // The source constituent is NOT re-derived here. Writing a second raw-query source parser is the
  // divergence this whole line of work exists to close, so the one parser is asked, and if it
  // cannot establish the constituent then this door has no structural basis for an attribution and
  // refuses. That is a throughput loss on the legacy door specifically, quantified in the packet
  // rather than absorbed quietly.
  if (authority.status === "AUTHORIZED" && authority.operation === "REPORTED_OBSERVATION") {
    const parsed = resolveRequestAuthority(topic);
    const sourceRegion =
      parsed.status === "AUTHORIZED" && parsed.operation === "ATTRIBUTED_REPORTED_OBSERVATION"
        ? (parsed.sourceRegion ?? "")
        : "";
    const source = await resolveSourceIdentity(sourceRegion);
    if (source.status !== "RESOLVED") {
      return {
        query: topic,
        status: source.status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED",
        operation: authority.operation,
        seriesIds: [],
        causalEdgeIds: [],
        subjects: source.status === "AMBIGUOUS" ? source.codes : [],
        detail:
          "An attributed reported observation names a provider, and this path cannot establish " +
          "which stored provider that is without re-deriving the source constituent from the raw " +
          "query. It refuses rather than attributing a reading to a provider it has not identified.",
      };
    }
    const owned = await prisma.series.findMany({
      where: { id: { in: [...authority.factSeriesIds] }, sourceId: source.sourceId },
      select: { id: true },
    });
    if (owned.length === 0) {
      return {
        query: topic,
        status: "UNRESOLVED",
        operation: authority.operation,
        seriesIds: [],
        causalEdgeIds: [],
        subjects: [],
        detail:
          `No series published by ${source.code} is named by this request. Another provider may ` +
          "publish it; that would be a different question.",
      };
    }
    return {
      query: topic,
      status: authority.status,
      operation: authority.operation,
      seriesIds: owned.map((s) => s.id),
      causalEdgeIds: authority.mechanismEdgeIds,
      subjects: authority.subjects,
      detail: authority.detail,
    };
  }

  return {
    query: topic,
    status: authority.status,
    operation: authority.operation,
    seriesIds: authority.factSeriesIds,
    causalEdgeIds: authority.mechanismEdgeIds,
    subjects: authority.subjects,
    detail: authority.detail,
  };
}

/**
 * Is the series behind this claim one the question was about?
 *
 * Reads the stored claim's own evidence, never a subject the plan asserted. A claim whose evidence
 * names no series is not a member: FACT and CALCULATION both carry `seriesId` by construction, so
 * the absence means something unexpected is being published and the fail-closed answer is no.
 */
export function claimIsCandidate(
  claimType: string,
  evidence: unknown,
  envelope: CandidateEnvelope,
): boolean {
  // Operation before subject. IR-104 candidate Y6: with one envelope holding both kinds for the
  // same subject, a mechanism, a change and an observation all published for one question, and the
  // planner decided which. A change answers no eligible frame today, so its type is checked here
  // rather than left to whichever record the planner liked.
  if (envelope.operation !== "REPORTED_OBSERVATION" || claimType !== "FACT") return false;
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
  if (envelope.operation !== "STORED_MECHANISM") return false;
  return envelope.causalEdgeIds.includes(explanationId);
}
