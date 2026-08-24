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
 * The closed set of relation constructions, each with the polarity it asserts.
 *
 * An entry is a sequence of literal markers: the cause lies between the first and second, the
 * effect between the second and the third (or up to the next clause when there is no third). The
 * evidence is the named construction — a verb with its arguments, or `connects … to …` where the
 * preposition carries the orientation — never the order two names happen to appear in.
 *
 * **Polarity belongs to the table, not to an afterthought.** IR-106 candidate AB1: "explain how A
 * does not affect B" contains ` affect `, so A landed in the cause slice and B in the effect slice
 * and a stored `A -> B` was authorized — the query denying the relation published the relation. A
 * named pair and a verb establish which relation is under discussion; they do not establish that
 * the asker is asserting it holds.
 *
 * **Order in this list is not precedence.** Overlapping matches are reconciled by span, longest
 * first, so `impact of A on B` beats the bare ` impact ` inside it wherever both occur. Fixing that
 * collision by deleting the bare entries, or by shuffling this list, would make table order an
 * authority — and table order is not evidence about a sentence.
 *
 * **English only, and still a stated limitation.** Korean marks the roles with particles that
 * attach to the preceding word, so literal marker splitting cannot separate them after
 * normalization. IR-105 measured that; nothing here changes it.
 */
type Polarity = "AFFIRMED" | "NEGATED";

interface Construction {
  markers: readonly [string, string, string | null];
  polarity: Polarity;
}

const CONSTRUCTIONS: readonly Construction[] = [
  { markers: ["no impact of ", " on ", null], polarity: "NEGATED" },
  { markers: ["no effect of ", " on ", null], polarity: "NEGATED" },
  { markers: ["no influence of ", " on ", null], polarity: "NEGATED" },
  { markers: ["", " no impact on ", null], polarity: "NEGATED" },
  { markers: ["", " no effect on ", null], polarity: "NEGATED" },
  { markers: ["", " no influence on ", null], polarity: "NEGATED" },

  { markers: ["connects", " to ", null], polarity: "AFFIRMED" },
  { markers: ["links", " to ", null], polarity: "AFFIRMED" },
  { markers: ["", " affects ", null], polarity: "AFFIRMED" },
  { markers: ["", " affect ", null], polarity: "AFFIRMED" },
  { markers: ["", " impacts ", null], polarity: "AFFIRMED" },
  { markers: ["", " impact ", null], polarity: "AFFIRMED" },
  { markers: ["", " influences ", null], polarity: "AFFIRMED" },
  { markers: ["", " influence ", null], polarity: "AFFIRMED" },
  { markers: ["", " drives ", null], polarity: "AFFIRMED" },
  { markers: ["", " drive ", null], polarity: "AFFIRMED" },
  { markers: ["", " feeds into ", null], polarity: "AFFIRMED" },
  { markers: ["", " feed into ", null], polarity: "AFFIRMED" },
  { markers: ["", " passes through to ", null], polarity: "AFFIRMED" },
  { markers: ["effect of ", " on ", null], polarity: "AFFIRMED" },
  { markers: ["impact of ", " on ", null], polarity: "AFFIRMED" },
  { markers: ["influence of ", " on ", null], polarity: "AFFIRMED" },
];

/**
 * Negators that deny an affirmative construction when they sit at the end of its cause region,
 * immediately before the verb.
 *
 * Closed, tiny, and bounded to the clause on purpose. A global `query.includes("not")` would refuse
 * "explain how A affects B, not C", which denies nothing about the relation. Apostrophes normalize
 * to spaces, so "doesn't" arrives as "doesn t".
 */
const CLAUSE_NEGATORS = [
  "does not",
  "do not",
  "did not",
  "doesn t",
  "don t",
  "didn t",
  "cannot",
  "can not",
];

/**
 * English negation particles, as tokens, looked for anywhere inside a clause's own span.
 *
 * A closed set of five words rather than a list of phrasings — that distinction is the whole point.
 * An adversarial review found `may not affect`, `never affects` and `there is not an impact of A on
 * B` all publishing a stored edge, because `CLAUSE_NEGATORS` enumerated *ways of saying* "does not"
 * and a way of saying it that nobody had thought of was read as an assertion. Chasing phrasings is
 * how the request guardrail came to fail 81% of a fresh holdout; this list can only grow if English
 * acquires a new negation particle.
 *
 * It is bounded to the clause span, not the query, so "A affects B" inside a sentence that negates
 * something else is unaffected. And it is deliberately **not** the main defence: the cause-anchor
 * rule below refuses anything sitting between the subject and the verb without consulting any list
 * at all, which is what catches the modal and adverbial cases. A mutation proves that separately.
 */
const NEGATION_MARKERS = ["not", "no", "never", "nor", "without"];

/**
 * The interrogatives a mechanism question is built on. Where the clause's own framing starts.
 *
 * `requestFrame.ts` already requires one of these to admit the question at all, so anchoring on the
 * last one before the relation is not a new rule — it is the same rule, read again to find where
 * the asker stopped writing preamble and started writing the question.
 */
const ANCHOR_TOKENS = ["explain", "what", "how", "describe"];

/**
 * Everything else a clause's framing may contain. An ALLOWLIST, and that is the whole point.
 *
 * The first repair refused a closed set of negation particles, and a second adversarial review got
 * four denials past it that contain none: "it is false that A affects B", "the absence of impact of
 * A on B", "the claim that A affects B is mistaken", "it is untrue that A affects B". A denylist of
 * ways to deny something cannot be finished, because denial is not a vocabulary.
 *
 * So the question is inverted. Between the interrogative and the subject there may be function
 * words and nothing else. `false`, `absence`, `claim`, `untrue`, `unlikely` are not in this list and
 * never need to be: anything unrecognised means the clause says something about the relation that
 * this grammar has not read, and unread is not affirmed.
 *
 * The cost is real and is the fail-closed side: "explain how exactly A affects B" is refused too.
 */
const FRAMING_TOKENS = new Set([
  "explain",
  "what",
  "which",
  "how",
  "describe",
  "mechanism",
  "process",
  "procedure",
  "the",
  "a",
  "an",
  "is",
  "are",
  "does",
  "do",
  "did",
]);

/**
 * Is everything between the question's framing and the relation a recognised function word?
 *
 * The scan starts at the LAST interrogative before the relation, not at the previous clause's end.
 * That distinction preserves "There is no shortage of gamma. Explain how alpha affects beta." —
 * where an unrelated sentence precedes a perfectly ordinary question — while still refusing an
 * interposed denial, because a denial sits AFTER the interrogative and unrelated prose sits before
 * it. Punctuation is gone by this point, so the interrogative is the only sentence boundary
 * available, and it is the one the frame gate already insisted on.
 */
export function framingIsRecognised(region: string): boolean {
  const tokens = normalizeSubject(region).trim().split(" ").filter(Boolean);
  let start = 0;
  for (const [i, token] of tokens.entries()) {
    if (ANCHOR_TOKENS.includes(token)) start = i;
  }
  return tokens.slice(start).every((token) => FRAMING_TOKENS.has(token));
}

/**
 * A cause region is well formed when it reads as recognised framing followed by the subject, and
 * nothing else — in that order.
 *
 * Two clauses that a mutation run showed are not the same rule wearing two hats, though they very
 * nearly are. Removing the trailing-subject clause left every test green, because the framing
 * allowlist happened to catch the same queries: with the subject no longer required at the end, its
 * own words fall into the framing half and subject names are not function words. That is a real
 * dependency, and one worth stating out loud rather than relying on by accident — a repository
 * whose series were named "the process" would lose it.
 *
 * So both clauses stay and both are exercised directly, because through the production path only
 * their conjunction is observable.
 */
export function causeRegionIsWellFormed(region: string, causeName: string): boolean {
  const tokens = normalizeSubject(region).trim().split(" ").filter(Boolean);
  const nameTokens = normalizeSubject(causeName).trim().split(" ").filter(Boolean);
  if (nameTokens.length === 0 || tokens.length < nameTokens.length) return false;

  const tail = tokens.slice(tokens.length - nameTokens.length);
  if (tail.join(" ") !== nameTokens.join(" ")) return false;

  return framingIsRecognised(tokens.slice(0, tokens.length - nameTokens.length).join(" "));
}

const containsNegationMarker = (region: string) =>
  NEGATION_MARKERS.some((marker) => normalizeSubject(region).includes(` ${marker} `));

export interface RelationClause {
  /** Normalized text in which the cause must be named. Bounded by this clause, not the query. */
  cause: string;
  /** Normalized text in which the effect must be named. */
  effect: string;
  construction: string;
  polarity: Polarity;
}

/**
 * Zero, exactly one, or several independently recognised relation clauses.
 *
 * The cardinality is the point. `directionEvidence` returned on the first construction it found,
 * which turned "explain how A affects B and how C affects D" into a question about A and B —
 * IR-106 candidates AA1 to AA3, where whichever clause came first became the whole request and the
 * other was dropped without a word. That is not a narrower answer, it is an answer to a different
 * question.
 */
export type RelationSyntax =
  | { status: "NONE" }
  | { status: "ONE"; clause: RelationClause }
  | { status: "MULTIPLE"; clauses: RelationClause[] };

interface ClauseMatch {
  construction: Construction;
  /** Span of the whole construction in the normalized query, for overlap reconciliation. */
  start: number;
  end: number;
  splitStart: number;
  splitEnd: number;
}

function matchesFor(construction: Construction, normalized: string): ClauseMatch[] {
  const [before, split, after] = construction.markers;
  const found: ClauseMatch[] = [];
  const prefix = before ? ` ${before.trim()} ` : null;
  let searchAt = 0;

  while (found.length <= 32) {
    let start = searchAt;
    if (prefix) {
      const at = normalized.indexOf(prefix, searchAt);
      if (at === -1) return found;
      start = at;
      searchAt = at + 1;
    }
    const splitStart = normalized.indexOf(split, prefix ? start + prefix.length - 1 : searchAt);
    if (splitStart === -1) return found;
    const splitEnd = splitStart + split.length;
    const end = after ? normalized.indexOf(after, splitEnd) : splitEnd;
    if (after && end === -1) return found;
    found.push({ construction, start: prefix ? start : splitStart, end, splitStart, splitEnd });
    if (!prefix) searchAt = splitEnd;
  }
  return found;
}

/**
 * Every relation clause the closed grammar recognises, with overlaps reconciled by span.
 *
 * Two entries can describe the same words — "no impact of A on B" contains "impact of A on B",
 * which contains a bare " impact " — so matches are sorted by position and then by length, and a
 * match overlapping one already accepted is discarded. The longest construction covering a span is
 * the one the asker wrote, and deciding that locally is what keeps list order from becoming
 * authority.
 *
 * Clause regions are bounded by their neighbours: a clause's effect ends where the next clause
 * begins. Before this, one construction consumed the rest of the query as its effect region, which
 * is how a later clause's variables ended up bound to an earlier clause's relation.
 */
export function relationSyntax(query: string): RelationSyntax {
  const normalized = normalizeSubject(query);
  const all = CONSTRUCTIONS.flatMap((c) => matchesFor(c, normalized));
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const accepted: ClauseMatch[] = [];
  for (const m of all) {
    if (accepted.some((k) => m.start < k.end && k.start < m.end)) continue;
    accepted.push(m);
  }
  if (accepted.length === 0) return { status: "NONE" };
  accepted.sort((a, b) => a.start - b.start);

  const clauses: RelationClause[] = accepted.map((m, i) => {
    const [before, split, after] = m.construction.markers;
    // `m.start` is the space before the prefix marker, so the cause begins one past it —
    // without the +1 the region opened with the marker's last letter ('s amber barge…').
    // Harmless while only `nameOccursIn` read it, and not harmless once the region's END and
    // its contents both carry meaning.
    const regionStart = accepted[i - 1]?.end ?? 0;
    const causeStart = before ? m.start + before.length + 1 : regionStart;
    const cause = normalized.slice(causeStart, m.splitStart + 1);
    const effectEnd = after ? m.end : (accepted[i + 1]?.start ?? normalized.length);
    const effect = normalized.slice(m.splitEnd - 1, effectEnd);
    const trimmed = cause.trim();
    // Where the marker scan looks, and why it is not the whole clause span.
    //
    // Widening it to the span was the obvious fix for the prefix case and it refused "There is no
    // shortage of gamma. Explain how alpha affects beta." — a denial about something else, two
    // sentences away, reaching a relation it has nothing to do with. Punctuation is gone by this
    // point, so a sentence boundary is not available to bound it.
    //
    // What can be bounded is where negation is able to attach:
    //  - between the subject and the verb, which the cause anchor below refuses structurally
    //    without consulting any list;
    //  - in front of a noun-phrase construction ("there is not an impact of A on B"), which the
    //    anchor cannot see because the cause region opens after the marker;
    //  - inside the effect region ("affects beta, not gamma").
    // So the scan covers the last two and leaves the first to the anchor.
    const preMarker = before ? normalized.slice(regionStart, m.start + 1) : "";
    // `containsNegationMarker(preMarker)` used to sit here and a mutation run proved it dead: the
    // framing allowlist refuses everything it refused, because a negation particle is not a
    // function word. Removed rather than kept as untestable insurance. The effect region keeps its
    // marker scan — there is no allowlist there, since effects legitimately trail into free words.
    const denied =
      m.construction.polarity === "AFFIRMED" &&
      (CLAUSE_NEGATORS.some((n) => trimmed === n || trimmed.endsWith(` ${n}`)) ||
        !framingIsRecognised(preMarker) ||
        containsNegationMarker(effect));
    return {
      cause,
      effect,
      construction: [before, split.trim(), after].filter(Boolean).join(" … "),
      polarity: denied ? "NEGATED" : m.construction.polarity,
    };
  });

  return clauses.length === 1
    ? { status: "ONE", clause: clauses[0] }
    : { status: "MULTIPLE", clauses };
}

/**
 * The distinct stored variable names explicitly occurring in one clause region.
 *
 * A clause has one cause and one effect. "A affects B and C" satisfies every check above — one
 * construction, one clause, affirmed — and its effect region names two stored variables, so which
 * relation was asked about is not established. Two stored edges would reach the duplicate-pair
 * ambiguity rule, but with only `A -> C` stored the request would have been answered by the half
 * of it the repository happens to hold. Roles have cardinality too, and this is where it is
 * checked; `explicitlyNamed` is reused so nesting behaves the same inside a region as outside it.
 */
function variablesNamedIn(region: string, vocabulary: readonly string[]): string[] {
  const occurring = vocabulary.filter((name) => nameOccursIn(name, region));
  return [...new Set(explicitlyNamed(occurring, (n) => n, region))];
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
    // What the REQUEST asks is settled before what the repository holds, because the two are
    // independent facts and answering them in the wrong order makes inventory look like meaning.
    // Two of these controls failed when the edge lookup ran first: a two-relation question with
    // nothing stored was reported as "no mechanism has both endpoints named", and a denial with no
    // stored edge got the same message — which reads as "we could not find it" when the truth is
    // that the question was unanswerable either way. A missing row is not evidence of absence, so
    // nothing here consults one before deciding.
    //
    // IR-105 candidate Z1. Both endpoints named establishes WHICH PAIR, and says nothing about
    // which way round. With exactly one stored edge the old code let the pair stand in for the
    // relation, so "what mechanism connects B to A" published the stored A -> B.
    const syntax = relationSyntax(query);
    if (syntax.status === "NONE") {
      return NOT_ELIGIBLE(
        frame,
        "The question names both variables but no construction in it establishes which acts on " +
          "which, so the direction is unproven. Reading it off word order would be a guess.",
      );
    }
    if (syntax.status === "MULTIPLE") {
      // IR-106 candidates AA1-AA3. Several relations were asked about and this contract can prove
      // and publish one. Answering the first and dropping the rest is not a narrower answer, it is
      // an answer to a question nobody asked; and choosing between them belongs to the planner only
      // if candidate authority is being handed back to it.
      return {
        status: "AMBIGUOUS",
        frame,
        operation: FRAME_OPERATIONS.FACTUAL_MECHANISM,
        factSeriesIds: [],
        mechanismEdgeIds: [],
        subjects: syntax.clauses.map((c) => c.construction),
        detail:
          `The question asks about ${syntax.clauses.length} relations ` +
          `(${syntax.clauses.map((c) => c.construction).join("; ")}), and one answer cannot ` +
          "establish all of them. Publishing one of them would answer a different question.",
      };
    }

    const clause = syntax.clause;
    if (clause.polarity === "NEGATED") {
      // IR-106 candidates AB1-AB3. A stored edge is evidence that a relation EXISTS. This
      // repository has no evidence type for absence, and `CausalDirection.NEGATIVE` is an inverse
      // sign rather than a denial — publishing a stored edge in answer to "does A not affect B"
      // asserts the opposite of what was asked. Nor does a missing row prove absence: nothing here
      // even looks, because the question is unanswerable either way.
      return NOT_ELIGIBLE(
        frame,
        `The question denies the relation (${clause.construction}), and this repository stores ` +
          "evidence that relations exist, never evidence that one does not. A negative causal " +
          "sign is an inverse effect, not the absence of an effect.",
      );
    }

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

    // Roles have cardinality. One cause, one effect — "A affects B and C" names two effects, and
    // whichever of them the repository happens to hold would otherwise answer the whole request.
    const vocabulary = [...new Set(edges.flatMap((e) => [e.fromVariable, e.toVariable]))];
    const causes = variablesNamedIn(clause.cause, vocabulary);
    const effects = variablesNamedIn(clause.effect, vocabulary);
    if (causes.length !== 1 || effects.length !== 1) {
      return NOT_ELIGIBLE(
        frame,
        `The clause names ${causes.length} cause(s) and ${effects.length} effect(s); a relation ` +
          "has one of each, so which relation was asked about is not established.",
      );
    }

    // The cause must be the LAST thing in its region, and this is the structural half of polarity.
    // In English whatever qualifies the verb sits between the subject and it — "does not", "may
    // not", "never", "is unlikely to", "rarely" — so anything left over after the subject means the
    // clause says something about the relation that this grammar has not read. No list is consulted
    // and none can be outgrown: an adversarial review got three denials past the negator list, and
    // every one of them leaves a residue here.
    // The cause region must read as recognised framing, then the subject, and nothing else. The
    // trailing half catches whatever qualifies the VERB ("may not", "never", "is unlikely to"); the
    // framing half catches whatever qualifies the PROPOSITION ("it is false that", "the claim
    // that"), which sits in front of a subject that ends its region quite legitimately.
    if (!causeRegionIsWellFormed(clause.cause, causes[0])) {
      return NOT_ELIGIBLE(
        frame,
        `The clause reads "${normalizeSubject(clause.cause).trim().slice(-60)}", which is not ` +
          "recognised framing followed by the subject. Something qualifies the relation that this " +
          "grammar has not read, and unread is not affirmed.",
      );
    }

    const oriented = complete.filter(
      (e) =>
        nameOccursIn(e.fromVariable, clause.cause) && nameOccursIn(e.toVariable, clause.effect),
    );
    if (oriented.length === 0) {
      return NOT_ELIGIBLE(
        frame,
        `The question asks about a relation running the other way (${clause.construction}); ` +
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
