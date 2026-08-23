/**
 * Which exact stored subject is this question about, and what may answer it — decided mechanically.
 *
 * IR-103 put candidate selection in the repository's hands and closed gross substitution: no
 * unrelated record entered an envelope. Its frozen holdout then measured what remained, and the
 * remainder was the dangerous half. `mentionsEachOther` — substring either way, else a 0.6 token
 * containment ratio — is a **retrieval** predicate. It is exactly right for "show me things that
 * might be relevant" and it is not an authority: ten adjacent subjects entered envelopes they had
 * no business in, and IR-104 reproduced three more families independently.
 *
 *     core producer prices asked        -> headline producer prices published
 *     seasonally adjusted asked         -> unadjusted published
 *     5 year yield asked                -> 15 year yield published
 *     an ambiguous subject asked        -> the planner picked one
 *     a mechanism between A and B asked -> A to C published, and B to A published
 *     a level asked                     -> a mechanism, a change or an observation, planner's choice
 *
 * Every record authentic, fresh, verified and publishable in class. Search may guess; authority may
 * not, and the difference is not a threshold. So this module is a second predicate rather than a
 * tuned first one — `mentionsEachOther` keeps doing retrieval in `askMarket.ts`, unchanged, and
 * nothing here can widen what it finds.
 *
 * ## Exact identity, not similarity
 *
 * A stored subject is resolved only when its **whole stored name occurs in the question**, at token
 * boundaries, after syntactic normalization: Unicode form, case, punctuation, hyphen-versus-space,
 * whitespace. No synonyms, no translations, no abbreviation tables, no concept vocabularies. That is
 * deliberately narrow, and the narrowness is the point — "core X" contains every token of "X", and
 * a similarity score cannot tell you that the missing word was the whole subject.
 *
 * ## Ambiguity is not the planner's to resolve
 *
 * Two materially distinct subjects both named, and nothing in the question choosing between them,
 * is `AMBIGUOUS`, and an ambiguous question reaches no model. Asking a planner which one the user
 * probably meant hands candidate authority straight back to it.
 *
 * `UNRESOLVED` and `AMBIGUOUS` are separate states because they mean different things to whoever
 * reads the log: nothing is stored about this, versus too much is.
 */

import { prisma } from "@/server/db/client";
import { classifyRequestFrame, type RequestFrame } from "./requestFrame";

/**
 * What kind of stored record answers what kind of question.
 *
 * Derived from the frames' own documented meanings in `./requestFrame` and the producers' own
 * output, not from what would be convenient:
 *
 *  - `FACTUAL_MECHANISM` asks "how something works, is processed, or is defined". The only record
 *    this repository holds of how something works is a `CausalEdge` — a stored transmission
 *    mechanism, seeded from `prisma/seedCausalEdges.ts`. An observation is a value, not a mechanism.
 *  - `THIRD_PARTY_REPORTED_FACT` asks "what somebody else published, said, or estimated". A FACT
 *    claim is exactly that: `buildFactClaimText` renders a figure a named provider published, on a
 *    date, with the source in the sentence.
 *
 * **CALCULATION has no eligible frame, and that is the honest answer rather than an oversight.**
 * `buildChangeClaimText` renders a change this repository computed. Nobody else published it, so it
 * is not a reported fact; it explains nothing, so it is not a mechanism. IR-102 established that a
 * CALCULATION is *safe to render when appropriately selected*; that is a different question from
 * whether any currently eligible question selects one. Until a frame exists whose meaning a
 * computed change actually answers, it is not a candidate — a real capability loss, recorded rather
 * than papered over by widening a list.
 */
export const FRAME_OPERATIONS = {
  FACTUAL_MECHANISM: "STORED_MECHANISM",
  THIRD_PARTY_REPORTED_FACT: "REPORTED_OBSERVATION",
} as const;

export type AuthorizedOperation = (typeof FRAME_OPERATIONS)[keyof typeof FRAME_OPERATIONS];

export type SubjectAuthorityStatus = "AUTHORIZED" | "AMBIGUOUS" | "UNRESOLVED";

export interface SubjectAuthority {
  status: SubjectAuthorityStatus;
  frame: RequestFrame;
  /** The operation the frame asks for, absent when no eligible frame applies. */
  operation?: AuthorizedOperation;
  /** Series whose FACT claims may answer. Non-empty only for `REPORTED_OBSERVATION`. */
  factSeriesIds: readonly string[];
  /** Causal edges whose mechanism may answer. Non-empty only for `STORED_MECHANISM`. */
  mechanismEdgeIds: readonly string[];
  /** The resolved subject names, for the log and for tests to assert on. */
  subjects: readonly string[];
  detail: string;
}

/**
 * Syntactic normalization only. Every step here is a rewriting of characters, never of meaning.
 *
 * Punctuation becomes a space rather than nothing, so "10-year" and "10 year" agree while
 * "AB" and "A-B" do not silently become the same token.
 */
export function normalizeSubject(text: string): string {
  return ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Does this stored name occur in the question as a whole phrase, at token boundaries? */
export function nameOccursIn(storedName: string, query: string): boolean {
  const name = normalizeSubject(storedName).trim();
  if (!name) return false;
  return normalizeSubject(query).includes(` ${name} `);
}

/** Where a stored name sits in the normalized query. Half-open, over normalized characters. */
interface Occurrence {
  start: number;
  end: number;
}

/**
 * Every place this stored name occurs in the query, as spans over the NORMALIZED text.
 *
 * Offsets are computed here, from strings this repository normalized itself, and are verified by
 * slicing: a span is only recorded if the normalized query really does read that name at that
 * position. Nothing outside this module supplies an offset — IR-095 learned what producer-supplied
 * offsets are worth, and a planner's would be worth less.
 *
 * Normalization changes character counts, so these are not offsets into the original query and are
 * never used as such. Comparing spans to spans in one coordinate system is the whole job.
 */
function occurrencesOf(storedName: string, normalizedQuery: string): Occurrence[] {
  const name = normalizeSubject(storedName).trim();
  if (!name) return [];
  const needle = ` ${name} `;
  const found: Occurrence[] = [];
  for (let at = normalizedQuery.indexOf(needle); at !== -1;) {
    const start = at + 1;
    const end = start + name.length;
    // Verified, not assumed: the slice must be the name.
    if (normalizedQuery.slice(start, end) === name) found.push({ start, end });
    at = normalizedQuery.indexOf(needle, at + 1);
  }
  return found;
}

const inside = (inner: Occurrence, outer: Occurrence) =>
  outer.start <= inner.start &&
  inner.end <= outer.end &&
  !(outer.start === inner.start && outer.end === inner.end);

/**
 * Keeps the subjects the question actually names, by occurrence rather than by name containment.
 *
 * Maximal specificity was right about the incidental case and blind to the explicit one. "core
 * Vespucci wage index" contains the whole of "Vespucci wage index", so a question naming only the
 * longer one should not be ambiguous with its own family — that part was working. But the old test
 * was `is this name a substring of that name`, which is a fact about the two stored names and says
 * nothing about the question. IR-105 candidate Z2: "…about Vespucci wage index and core Vespucci
 * wage index?" names both, and the shorter one was dropped for being nestable, leaving the longer
 * authorized on its own.
 *
 * So the question is asked of the query instead. A subject survives if it occurs somewhere that is
 * not inside an occurrence of a longer matched subject. Two explicit subjects then reach the
 * ambiguity rule, which is where a question naming two things belongs.
 */
function explicitlyNamed<T>(matches: T[], nameOf: (m: T) => string, query: string): T[] {
  const normalized = normalizeSubject(query);
  const spans = matches.map((m) => occurrencesOf(nameOf(m), normalized));
  return matches.filter((_, i) =>
    spans[i].some((own) =>
      spans.every((otherSpans, j) => i === j || !otherSpans.some((other) => inside(own, other))),
    ),
  );
}

/**
 * The closed set of constructions from which a causal direction can be read off syntactically.
 *
 * Each entry is a sequence of literal markers: the cause lies between the first and second, the
 * effect between the second and the third (or after the second when there is no third). The
 * evidence is the named construction — a verb with its arguments, or `connects … to …` where the
 * preposition carries the orientation — never the order two names happen to appear in. "Whichever
 * name comes first is the cause" is word-order guessing with a rule's face on, and it is exactly
 * what the guidance forbids.
 *
 * **English only, and that is a stated limitation rather than an oversight.** Korean marks the
 * roles with particles that attach to the preceding word, so `가` is not separable by literal
 * marker splitting after normalization, and a Korean directional parser worth trusting is more than
 * this repair should contain. A Korean mechanism question is `DIRECTION_UNRESOLVED` and publishes
 * nothing — the fail-closed side, and a real capability gap.
 */
const DIRECTIONAL_CONSTRUCTIONS: readonly (readonly [string, string, string | null])[] = [
  ["connects", " to ", null],
  ["links", " to ", null],
  ["", " affects ", null],
  ["", " affect ", null],
  ["", " influences ", null],
  ["", " influence ", null],
  ["", " impacts ", null],
  ["", " impact ", null],
  ["", " drives ", null],
  ["", " drive ", null],
  ["", " feeds into ", null],
  ["", " feed into ", null],
  ["", " passes through to ", null],
  ["effect of ", " on ", null],
  ["impact of ", " on ", null],
  ["influence of ", " on ", null],
];

export interface DirectionEvidence {
  /** The normalized text in which the cause must be named. */
  cause: string;
  /** The normalized text in which the effect must be named. */
  effect: string;
  construction: string;
}

/**
 * Reads a cause and an effect region out of the query, or returns null if no construction applies.
 *
 * Null is the common case and the safe one: a question that names two variables without saying
 * which acts on which has not established a direction, and IR-105 candidate Z1 is what happens when
 * a sole stored edge is treated as the answer anyway.
 */
export function directionEvidence(query: string): DirectionEvidence | null {
  const normalized = normalizeSubject(query);
  for (const [before, split, after] of DIRECTIONAL_CONSTRUCTIONS) {
    const from = before ? normalized.indexOf(` ${before.trim()} `) : -1;
    if (before && from === -1) continue;
    const searchFrom = before ? from + before.length : 0;
    const at = normalized.indexOf(split, searchFrom);
    if (at === -1) continue;
    const causeEnd = at + 1;
    const causeStart = before ? from + before.length + 1 : 0;
    const effectStart = at + split.length - 1;
    const effectEnd = after ? normalized.indexOf(after, effectStart) : -1;
    if (after && effectEnd === -1) continue;
    return {
      cause: normalized.slice(causeStart, causeEnd),
      effect: normalized.slice(effectStart, effectEnd === -1 ? undefined : effectEnd),
      construction: [before, split.trim(), after].filter(Boolean).join(" … "),
    };
  }
  return null;
}

const NOT_ELIGIBLE = (frame: RequestFrame, detail: string): SubjectAuthority => ({
  status: "UNRESOLVED",
  frame,
  factSeriesIds: [],
  mechanismEdgeIds: [],
  subjects: [],
  detail,
});

/**
 * Resolves the exact stored subject a query is about, and what may answer it.
 *
 * `discovered` is the retrieval stage's opinion, and this function may only **subtract** from it:
 * an id that fuzzy matching did not surface cannot be authorized here, and an id it did surface is
 * authorized only if the exact rules above hold. That ordering is what keeps a similarity score
 * from becoming an authority by the back door.
 */
export async function resolveSubjectAuthority(
  query: string,
  discovered: { seriesIds: readonly string[]; causalEdgeIds: readonly string[] },
): Promise<SubjectAuthority> {
  const frame = classifyRequestFrame(query);

  if (frame === "THIRD_PARTY_REPORTED_FACT") {
    const series = await prisma.series.findMany({
      where: { id: { in: [...discovered.seriesIds] } },
      select: { id: true, name: true },
    });
    const occurring = series.filter((s) => nameOccursIn(s.name, query));
    const resolved = explicitlyNamed(occurring, (s) => s.name, query);

    if (resolved.length === 0) {
      return NOT_ELIGIBLE(
        frame,
        "No stored series name occurs in the question, so no subject is resolved. Retrieval " +
          `surfaced ${discovered.seriesIds.length}; similarity is not identity.`,
      );
    }
    if (resolved.length > 1) {
      return {
        status: "AMBIGUOUS",
        frame,
        operation: FRAME_OPERATIONS.THIRD_PARTY_REPORTED_FACT,
        factSeriesIds: [],
        mechanismEdgeIds: [],
        subjects: resolved.map((s) => s.name),
        detail:
          `The question names ${resolved.length} materially distinct stored subjects ` +
          `(${resolved.map((s) => s.name).join("; ")}) and does not choose between them.`,
      };
    }
    return {
      status: "AUTHORIZED",
      frame,
      operation: FRAME_OPERATIONS.THIRD_PARTY_REPORTED_FACT,
      factSeriesIds: [resolved[0].id],
      mechanismEdgeIds: [],
      subjects: [resolved[0].name],
      detail: `Resolved to the stored series "${resolved[0].name}".`,
    };
  }

  if (frame === "FACTUAL_MECHANISM") {
    const edges = await prisma.causalEdge.findMany({
      where: { id: { in: [...discovered.causalEdgeIds] } },
      select: { id: true, fromVariable: true, toVariable: true },
    });
    // BOTH endpoints, not either. IR-104 candidate Y4: an authentic edge sharing one endpoint with
    // the question and some other variable at the far end answers a question nobody asked.
    const complete = edges.filter(
      (e) => nameOccursIn(e.fromVariable, query) && nameOccursIn(e.toVariable, query),
    );

    if (complete.length === 0) {
      return NOT_ELIGIBLE(
        frame,
        "No stored mechanism has both of its endpoints named in the question. An edge sharing " +
          "one endpoint is a different relation.",
      );
    }

    // IR-105 candidate Z1. Both endpoints named establishes WHICH PAIR, and says nothing about
    // which way round. With exactly one stored edge the old code let the pair stand in for the
    // relation, so "what mechanism connects B to A" published the stored A -> B.
    const direction = directionEvidence(query);
    if (!direction) {
      return NOT_ELIGIBLE(
        frame,
        "The question names both variables but no construction in it establishes which acts on " +
          "which, so the direction is unproven. Reading it off word order would be a guess.",
      );
    }
    const oriented = complete.filter(
      (e) =>
        nameOccursIn(e.fromVariable, direction.cause) &&
        nameOccursIn(e.toVariable, direction.effect),
    );
    if (oriented.length === 0) {
      return NOT_ELIGIBLE(
        frame,
        `The question asks about a relation running the other way (${direction.construction}); ` +
          "no stored mechanism runs in the direction asked about.",
      );
    }
    complete.length = 0;
    complete.push(...oriented);
    if (complete.length > 1) {
      // Candidate Y5. Two stored relations over the same pair — typically A->B and B->A — and
      // nothing mechanical in the question settles which direction was asked about. Working it out
      // from word order would be a grammar guess dressed as a rule, and picking for the planner is
      // the thing this module exists to stop.
      return {
        status: "AMBIGUOUS",
        frame,
        operation: FRAME_OPERATIONS.FACTUAL_MECHANISM,
        factSeriesIds: [],
        mechanismEdgeIds: [],
        subjects: complete.map((e) => `${e.fromVariable} -> ${e.toVariable}`),
        detail:
          `${complete.length} stored mechanisms connect the named variables ` +
          `(${complete.map((e) => `${e.fromVariable} -> ${e.toVariable}`).join("; ")}); the ` +
          "question does not mechanically establish which direction it asks about.",
      };
    }
    return {
      status: "AUTHORIZED",
      frame,
      operation: FRAME_OPERATIONS.FACTUAL_MECHANISM,
      factSeriesIds: [],
      mechanismEdgeIds: [complete[0].id],
      subjects: [`${complete[0].fromVariable} -> ${complete[0].toVariable}`],
      detail: `Resolved to the stored mechanism "${complete[0].fromVariable} -> ${complete[0].toVariable}".`,
    };
  }

  return NOT_ELIGIBLE(
    frame,
    `The ${frame} frame has no operation this repository can mechanically satisfy.`,
  );
}
