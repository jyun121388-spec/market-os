/**
 * What kind of answer is being asked for, decided before anything is looked up.
 *
 * IR-107 measured the gate this replaces: 1 of 104 answerable requests admitted, and both labels
 * wrong at once — a definition reported as a legal prohibition, nine unmistakable personalized
 * directives reported as merely unsupported. A vocabulary list was standing in for a judgement
 * about purpose, and it failed in both directions simultaneously.
 *
 * ## Positive authority, and the reason it cannot be "not prohibited"
 *
 * The tempting replacement is `not prohibited + a candidate exists => answerable`. It is not
 * available. A prohibited request can name an exact stored subject and obtain a perfectly valid
 * candidate envelope: candidate authority proves *this record is about the named subject*, output
 * authority proves *this record may be rendered*, and neither proves *the asker wanted information
 * rather than a decision*. `docs/LEGAL_GUARDRAILS.md` requires a personalized request to be
 * redirected, and answering it with true evidence selected in response to it does not satisfy that.
 *
 * So a request is answerable only when it is positively recognised as ONE operation from a closed
 * set. Absence of a prohibition authorizes nothing.
 *
 * ## There are no halves
 *
 * "The unemployment rate rose; tell me which sectors I should short" must not be answered by
 * serving the factual half. The structural way to guarantee that is not to detect the directive —
 * detection is what has failed here three times — but to require the WHOLE request to parse as one
 * operation. Framing, one construction, one subject, an optional temporal operand, and nothing
 * left over. A second clause is unread text, and unread text refuses the request.
 *
 * That is the same rule IR-106 arrived at for relation clauses, applied to the request. It closes
 * mixed requests without knowing anything about what the second clause says.
 *
 * ## What this does not do
 *
 * It does not decide whether a matching record exists — that is candidate authority, downstream and
 * separate, and inventory must never decide what a sentence meant. It does not render anything. It
 * does not replace the prohibited screen, which keeps precedence over everything here.
 *
 * English only for now, deliberately. Korean marks grammatical role with particles that attach to
 * the preceding word, so space-delimited construction matching cannot separate them — the same
 * limitation IR-105 measured for relation direction. Korean requests resolve to UNSUPPORTED and
 * publish nothing, which is the fail-closed side of a gap that needs a morphology-aware identity
 * layer rather than a longer pattern list.
 */

import { detectPersonalizedAdviceRequest } from "./askMarket";
import {
  analyseCopularInterrogative,
  analyseNoun,
  containsHangul,
  eojeols,
  KOREAN_POSSESSIVE_DETERMINERS,
} from "./koreanMorphology";
import { classifyRequestFrame } from "./requestFrame";
import { relationSyntax } from "./subjectAuthority";

export const REQUEST_OPERATIONS = [
  "CURRENT_OBSERVATION",
  "OBSERVED_CHANGE",
  "STORED_MECHANISM",
  "ATTRIBUTED_REPORTED_OBSERVATION",
  "DEFINITION",
] as const;

export type RequestOperation = (typeof REQUEST_OPERATIONS)[number];

/**
 * What a stored record must be for an operation to be answerable by it.
 *
 * `OBSERVATION` deliberately spans two repository tables: an economic series' `Observation` rows and
 * a company's `FinancialFact` rows. Adversarial review flagged that as one operation quietly
 * meaning two unrelated classes, and it was right that it was quiet. Naming it here is the repair,
 * because the two are the same KIND of record -- a reading of one named subject, reported by one
 * named source, as of one date -- and the subject being a company rather than an index is not a
 * different question being asked. What would be a different question is a change, a mechanism, an
 * attributed report or a definition, and each of those has its own class.
 */
export type RecordClass =
  "OBSERVATION" | "COMPUTED_CHANGE" | "CAUSAL_EDGE" | "ATTRIBUTED_OBSERVATION" | "GLOSSARY_ENTRY";

export interface OperationContract {
  operation: RequestOperation;
  /** How many distinct stored subjects the request must name. A mechanism names two. */
  subjectCardinality: 1 | 2;
  recordClass: RecordClass;
  /** `LATEST` needs no operand; `INTERVAL` needs one and refuses without it. */
  temporalOperands: "LATEST" | "INTERVAL" | "NONE";
  /** True when the answer names who reported it, and the source must bind as well as the subject. */
  requiresAttribution: boolean;
  /** True when repository code can answer with no model at all. */
  deterministic: boolean;
  /**
   * Whether a planner may ever be consulted for this operation.
   *
   * A current level and a computed change are deterministic repository output. Capability does not
   * imply a model is needed, and the safest version of those answers calls no sink — so these
   * declare `false` and a test counts the calls rather than trusting the declaration.
   */
  plannerPermitted: boolean;
}

export const OPERATION_CONTRACTS: Readonly<Record<RequestOperation, OperationContract>> = {
  CURRENT_OBSERVATION: {
    operation: "CURRENT_OBSERVATION",
    subjectCardinality: 1,
    recordClass: "OBSERVATION",
    temporalOperands: "LATEST",
    requiresAttribution: false,
    deterministic: true,
    plannerPermitted: false,
  },
  OBSERVED_CHANGE: {
    operation: "OBSERVED_CHANGE",
    subjectCardinality: 1,
    recordClass: "COMPUTED_CHANGE",
    temporalOperands: "INTERVAL",
    requiresAttribution: false,
    deterministic: true,
    plannerPermitted: false,
  },
  STORED_MECHANISM: {
    operation: "STORED_MECHANISM",
    subjectCardinality: 2,
    recordClass: "CAUSAL_EDGE",
    temporalOperands: "NONE",
    requiresAttribution: false,
    deterministic: false,
    plannerPermitted: true,
  },
  ATTRIBUTED_REPORTED_OBSERVATION: {
    operation: "ATTRIBUTED_REPORTED_OBSERVATION",
    subjectCardinality: 1,
    recordClass: "ATTRIBUTED_OBSERVATION",
    temporalOperands: "NONE",
    requiresAttribution: true,
    deterministic: false,
    plannerPermitted: true,
  },
  DEFINITION: {
    operation: "DEFINITION",
    subjectCardinality: 1,
    recordClass: "GLOSSARY_ENTRY",
    temporalOperands: "NONE",
    requiresAttribution: false,
    deterministic: true,
    plannerPermitted: false,
  },
};

export type RequestAuthority =
  | {
      status: "AUTHORIZED";
      operation: RequestOperation;
      contract: OperationContract;
      /** The span of the request the operation was read from, for the log and for tests. */
      subjectRegion: string;
      /**
       * The source constituent, as TEXT and nothing more.
       *
       * `attributionBound` recorded that a source existed and threw away which one, so the serving
       * path could not tell "what did source A report" from "what did anyone report" — and with two
       * providers publishing the same subject it answered with both. Carrying the span is not
       * carrying authority: it is unresolved until the repository matches it to a source it holds,
       * and a caller or model asserting an id is never a substitute for that.
       */
      sourceRegion?: string;
      /** The interval constituent, for the operation that requires one. Text, likewise. */
      interval?: string;
      /**
       * The two halves of a relation clause, kept apart.
       *
       * Merged into one subject region they prove a relation was asked about and lose which way
       * round it runs, and IR-105 established that reading direction off word order is a guess.
       * Serving needs them separate to return the edge that was asked for rather than an edge that
       * shares an endpoint with it.
       */
      causeRegion?: string;
      effectRegion?: string;
      detail: string;
    }
  | { status: "PROHIBITED"; detail: string }
  | { status: "UNSUPPORTED"; detail: string }
  | { status: "AMBIGUOUS"; detail: string };

/**
 * Syntactic normalization only, matching `subjectAuthority.normalizeSubject`'s rules so that a
 * subject span handed downstream is in the same coordinate system the candidate layer expects.
 */
function normalize(text: string): string {
  return ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Words a request may contain without saying anything about what is being asked.
 *
 * An allowlist, for the reason IR-106 settled: a denylist of ways to ask for something improper
 * cannot be finished, and an allowlist of function words can. Anything outside it is content this
 * grammar has not read, and unread content refuses the request rather than being ignored.
 */
const FRAMING_TOKENS = new Set([
  "what",
  "which",
  "how",
  "is",
  "are",
  "was",
  "were",
  "did",
  "do",
  "does",
  "has",
  "have",
  "had",
  // The auxiliary and modal chain. Closed functional classes, and their absence is what let
  // "What has been said about US inflation?" bind "been" as the name of a source.
  "be",
  "been",
  "being",
  "will",
  "would",
  "can",
  "could",
  "may",
  "might",
  "must",
  "there",
  "the",
  "a",
  "an",
  "of",
  "for",
  "in",
  "on",
  "at",
  "to",
  "s",
  "please",
  "tell",
  "show",
  "give",
  "me",
  "us",
  "explain",
  "describe",
  "much",
  "many",
  "value",
  "level",
  "reading",
  "figure",
  "number",
  "rate",
  "print",
]);

interface Construction {
  operation: RequestOperation;
  /** Ordered literal markers. The subject lies between the first and second, or after the first. */
  markers: readonly [string, string | null];
  /**
   * Where the subject sits relative to the opening marker.
   *
   * The first version assumed "after", always, and `"X changed this year"` therefore read its
   * subject as "this year" — the interval — and reported the actual subject as unread content. An
   * English verb takes its subject in front of it; only a preposition or a noun phrase puts it
   * behind. That is a property of the construction, so the construction has to say which it is.
   */
  subjectSide?: "AFTER" | "BEFORE";
}

/**
 * The closed set of shapes a request may take. Positive, small, and auditable.
 *
 * These are constructions, not vocabulary: each names where the subject sits relative to a literal
 * phrase. Adding to this list is how the product gains a way of being asked something; it is not a
 * place to accumulate synonyms, and an unrecognised phrasing is UNSUPPORTED rather than guessed at.
 */
const CONSTRUCTIONS: readonly Construction[] = [
  { operation: "CURRENT_OBSERVATION", markers: [" current ", null] },
  { operation: "CURRENT_OBSERVATION", markers: [" latest ", null] },
  { operation: "CURRENT_OBSERVATION", markers: [" most recent ", null] },
  { operation: "OBSERVED_CHANGE", markers: [" change in ", null] },
  { operation: "OBSERVED_CHANGE", markers: [" changed ", null], subjectSide: "BEFORE" },
  { operation: "OBSERVED_CHANGE", markers: [" moved ", null], subjectSide: "BEFORE" },
  { operation: "OBSERVED_CHANGE", markers: [" rose ", null], subjectSide: "BEFORE" },
  { operation: "OBSERVED_CHANGE", markers: [" fell ", null], subjectSide: "BEFORE" },
  { operation: "DEFINITION", markers: [" definition of ", null] },
  { operation: "DEFINITION", markers: [" what is a ", null] },
  { operation: "DEFINITION", markers: [" what is an ", null] },
  { operation: "DEFINITION", markers: [" what does ", " mean "] },
  // ATTRIBUTED_REPORTED_OBSERVATION is not here. It had eight rows — publish/report crossed with
  // about/for — and the ninth was always going to be "said about". It binds three roles instead;
  // see `attributionMatch`.
];

/**
 * English coordinators. A subject that contains one is not a subject, it is two clauses.
 *
 * The subject region of a trailing construction runs to the end of the sentence, so without this
 * `"the current gold price, then decide how many ounces I should buy"` has a subject of
 * "gold price then decide how many ounces i should buy" and no leftover content at all — the
 * "no halves" rule passing a request with two halves, because the second one hid inside the first.
 * Its own tests caught that.
 *
 * Coordinators are a closed grammatical class, which is why this can be a list without being the
 * kind of list this project keeps having to abandon.
 */
const CLAUSE_CONNECTIVES = ["and", "then", "but", "also", "plus", "while", "so", "or"];

/**
 * Pronouns that make a request about the reader.
 *
 * A stored subject identity is a thing — a series, a variable, a term. It is never "my portfolio"
 * or "the stock I should buy". A personal pronoun inside the subject means the question is about
 * the person asking, which is the definition of a personalized request, and closed classes of
 * pronouns do not grow.
 */
const PERSONAL_PRONOUNS = ["i", "me", "my", "mine", "we", "our", "ours", "you", "your", "yours"];

/**
 * First-person POSSESSIVE determiners, which is a different claim from first-person pronouns.
 *
 * The distinction is grammatical and it is the whole point. An accusative or dative first person
 * names who is being *told* — "show me CPI", "give us the figure" — and says nothing about whose
 * CPI it is. A possessive determiner attaches to a noun phrase and makes that noun the reader's:
 * "my brokerage account", "our allocation". Only the second makes the question personalized.
 *
 * Scanned over the WHOLE request rather than a subject region, because this exists for the case
 * where no operation was recognised and there is no subject region to scan. Architecture review
 * measured 14 of 40 personal-stake controls refused as UNSUPPORTED — refused, but for a reason that
 * says the product merely does not do that yet, when what is true is that it must not.
 *
 * Four words, a closed determiner class. It cannot grow into a list of things people own.
 */
const FIRST_PERSON_POSSESSIVES = ["my", "mine", "our", "ours"];

/**
 * The same judgement in either language, made on the same grammatical evidence.
 *
 * English marks the possessive with a word; Korean marks it with a determiner that stands as its
 * own eojeol and governs the noun after it. The rule is identical — a first person attached to a
 * noun phrase makes that noun the reader's — and only the surface differs, which is why this is one
 * function and not a Korean copy of an English one.
 *
 * The Korean side requires a FOLLOWING eojeol, because a determiner governs something. A trailing
 * 내 governs nothing and is not a claim about ownership.
 *
 * `저` and `우리` are absent from the determiner class on purpose (see `koreanMorphology`), so
 * `저에게 기준금리를 알려주세요` — "tell ME the policy rate" — is not touched by this. That is the
 * dative, it names who is being told, and prohibiting it would be the Korean instance of the
 * 44-case false-prohibition class this file already carries a note about.
 */
function firstPersonPossession(query: string, normalized: string): boolean {
  if (normalizedTokens(normalized).some((token) => FIRST_PERSON_POSSESSIVES.includes(token))) {
    return true;
  }
  const tokens = eojeols(query);
  return tokens.some(
    (token, index) => index < tokens.length - 1 && KOREAN_POSSESSIVE_DETERMINERS.includes(token),
  );
}

/** Closed set of interval operands. `OBSERVED_CHANGE` refuses without one. */
const INTERVAL_OPERANDS = [
  "this year",
  "last year",
  "this month",
  "last month",
  "this week",
  "last week",
  "this quarter",
  "last quarter",
  "year to date",
  "over the past year",
  "over the past month",
  // "since last year" was here and is deliberately gone. It has at least three readings -- since
  // 1 January last year, since this date last year, since last year's final observation -- and the
  // architecture round could not choose between them on any principle. An operand whose boundaries
  // cannot be stated is not a period; supporting it approximately would mean answering about a
  // period the request did not name. Deleting it makes those requests AMBIGUOUS, which is true.
];

/**
 * Reporting acts the product can serve a record for.
 *
 * This is a LEXICON, and the distinction from a grammar is the point of the whole unit. The
 * grammar below binds three roles — who reported, the act of reporting, what it was about — and
 * needs no vocabulary to do it. What this list bounds is a *capability*: the set of reporting acts
 * for which an `ATTRIBUTED_OBSERVATION` record can actually be produced. It is finite because the
 * record types are finite, not because English reporting verbs are.
 *
 * Naming that honestly is what stops it becoming the thing that has failed here three times. A
 * phrase table pretends a list of strings is a grammar and grows without limit; this says "these
 * are the acts we hold records of", and adding one is a product decision with a record type behind
 * it. If the product cannot serve "assessed", the parser should not authorize "assessed".
 */
const REPORTING_ACTS = [
  "said",
  "say",
  "published",
  "publish",
  "reported",
  "report",
  "forecast",
  "forecasted",
  "estimated",
  "estimate",
  "noted",
  "wrote",
  "flagged",
  "issued",
];

/** Complement prepositions that introduce what a report was about. A closed functional class. */
const REPORT_COMPLEMENTS = ["about", "on", "regarding", "for"];

/**
 * Words that occupy the source slot without naming a source.
 *
 * "What did they say about the labour market?" has a grammatical subject and no attribution: a
 * pronoun refers to a source established somewhere this request does not contain. "your forecast"
 * is worse — it asks the product for its own prediction, which is the thing it must never give.
 *
 * Pronouns and possessive determiners are closed classes, which is why this can be enumerated
 * without being the kind of list that grows.
 */
const SOURCE_DISQUALIFIERS = [
  "they",
  "them",
  "he",
  "she",
  "it",
  "someone",
  "anyone",
  "everyone",
  "people",
  "your",
  "yours",
  "my",
  "mine",
  "our",
  "ours",
  "their",
  "theirs",
  "its",
  "his",
  "her",
];

interface Recognised {
  operation: RequestOperation;
  subjectRegion: string;
  /** Everything not accounted for by the construction, its subject, or a temporal operand. */
  residue: string[];
  /**
   * Set when the grammar bound a source constituent, which is the only thing that satisfies
   * `requiresAttribution`. Previously a six-name list was searched anywhere in the request, so the
   * source did not have to be the source of anything — it merely had to appear.
   */
  attributionBound?: boolean;
  /** The source span, when one was bound. Unresolved text; see `RequestAuthority.sourceRegion`. */
  sourceRegion?: string;
  causeRegion?: string;
  effectRegion?: string;
}

/**
 * Attribution is three roles, and only one of them can be a list.
 *
 * SOURCE and SUBJECT are open classes — no closed set contains every organisation or every economic
 * series, and pretending otherwise is how `ATTRIBUTION_MARKERS` came to hold six names while the
 * live hole was `"What did analysts say about the Test Output freight index?"`. So the grammar
 * binds them by POSITION and reads whatever is there: the source is what sits before the reporting
 * act once framing is removed, the subject is what follows the complement preposition.
 *
 * That deletes the source list rather than extending it. A request with no source constituent —
 * `"What was published about US headline CPI?"` — leaves nothing but framing in front of the act,
 * so nothing binds and the request refuses, which is the same answer as before for a better reason.
 *
 * The reporting ACT stays a lexicon, deliberately, because it is the one role where being wrong
 * authorizes something: `"What did Goldman Sachs buy for the pension fund?"` binds a perfectly good
 * source and subject around a verb that reports nothing.
 */
function attributionMatch(normalized: string): Recognised | null {
  for (const act of REPORTING_ACTS) {
    const actAt = normalized.indexOf(" " + act + " ");
    if (actAt < 0) continue;
    const actEnd = actAt + act.length + 1;

    for (const prep of REPORT_COMPLEMENTS) {
      const prepAt = normalized.indexOf(" " + prep + " ", actEnd - 1);
      if (prepAt < 0) continue;

      // The source is the noun phrase IMMEDIATELY before the act, and everything in front of it
      // must be framing. Without that bound the slot swallowed whole clauses: "What has the IMF
      // published on global growth, and what did the OECD say about Korea?" bound the entire first
      // question as the name of a source and answered the second one alone.
      const sourceTokens = normalizedTokens(normalized.slice(0, actAt + 1));
      const opens = sourceTokens.findIndex((t) => !FRAMING_TOKENS.has(t));
      if (opens < 0) continue;
      const source = sourceTokens.slice(opens);
      // Internal function words belong to the name: "the Bank of Korea" is one source, and a rule
      // that stopped at "of" bound only "korea" and refused the rest as unread. What may NOT be
      // inside a source is a clause boundary or a second reporting act — that is not a long name,
      // it is another question. "What has the IMF published on global growth, and what did the
      // OECD say about Korea?" bound the entire first question as a source and answered the second.
      // A second reporting act inside the source was also blocked here, and mutation showed the
      // two guards never disagreed: with either one alone the corpus has no leak, and only with
      // both removed does the two-question case get through. Two rules deciding one thing is one
      // rule and a spare, so the spare is gone -- a clause boundary is the grammatical fact, and a
      // second act was only ever a proxy for one.
      if (source.some((t) => CLAUSE_CONNECTIVES.includes(t))) continue;
      if (source.every((t) => SOURCE_DISQUALIFIERS.includes(t))) continue;

      const subjectRegion = normalized.slice(prepAt + prep.length + 1);
      if (!subjectRegion.trim()) continue;

      return {
        operation: "ATTRIBUTED_REPORTED_OBSERVATION",
        subjectRegion,
        sourceRegion: source.join(" "),
        // Between the act and its complement is the only place unread content can hide here.
        residue: normalizedTokens(normalized.slice(actEnd, prepAt)),
        attributionBound: true,
      };
    }
  }
  return null;
}

/**
 * Two Korean operations, from one construction and no Korean vocabulary at all.
 *
 * `[NOUN + 은/는 | 이/가 | (이)란 | nothing] [무엇 | 뭐 | 얼마 + copula + present interrogative]`.
 * Which operation it is comes from WHICH closed interrogative pronoun is used — 무엇 and 뭐 ask what
 * a thing IS, 얼마 asks what quantity it is — and nothing else in the sentence is consulted. There
 * is no Korean word list here: the subject is whatever the particle is attached to, and the
 * repository decides later whether that names anything.
 *
 * ## Why exactly two eojeol
 *
 * The Korean form of "there are no halves". The English path reads a construction and then proves
 * nothing is left over; here the construction IS the whole request, so the proof is the length.
 * `현재 기준금리는 얼마인가요?` has three, and refuses.
 *
 * That refusal is a deliberate capability loss and worth being explicit about, because 현재 means
 * "current" and the request is obviously answerable. Admitting it costs one of two things: reading
 * 현재 as an operation marker, which is translating the English ` current ` construction into
 * Korean, or adding it to a framing list that would then need 최근, 지금, 오늘, 현시점 and has no
 * end. The construction is already sufficient without it — 기준금리는 얼마인가요 asks the same
 * question — so the honest answer is to refuse the adverb and keep the grammar.
 *
 * ## Why ambiguity refuses rather than resolving
 *
 * A parse is built from EVERY morphological reading of the subject eojeol, including the unsplit
 * one. Usually only one reading yields a complete parse, and then the reading is not a guess: the
 * name 신라 survives in `신라는 무엇인가요?` because 신 is not offered as a stem by any rule, not
 * because anything here knows 신라 is a name. Where two readings both parse to different subjects
 * the request is genuinely two questions on paper, and choosing between them would need either
 * inventory — which must never decide what a sentence meant — or a likelihood this repository has
 * no way to compute.
 */
type KoreanMatch =
  | { status: "ONE"; match: Recognised }
  | { status: "NONE" }
  | { status: "AMBIGUOUS"; readings: string[] };

function koreanCopularMatch(query: string): KoreanMatch {
  const tokens = eojeols(query);
  if (tokens.length !== 2) return { status: "NONE" };
  const [subjectEojeol, predicateEojeol] = tokens;

  const predicate = analyseCopularInterrogative(predicateEojeol);
  if (predicate === null) return { status: "NONE" };

  const operation = predicate.kind === "WHAT" ? "DEFINITION" : "CURRENT_OBSERVATION";
  const parse = (stem: string): Recognised => ({
    operation,
    subjectRegion: ` ${stem} `,
    residue: [],
  });

  const candidates: Recognised[] = [];
  for (const analysis of analyseNoun(subjectEojeol)) {
    // 은/는 marks a topic and 이/가 the grammatical subject of the copular clause; either is the
    // thing being asked about, and which one a speaker reaches for is information structure rather
    // than a different question. (이)란 cites a term AS a term, so it introduces a definiendum and
    // can only precede "what is it", never "how much is it".
    if (analysis.role === "DEFINIENDUM" && predicate.kind !== "WHAT") continue;
    if (
      analysis.role !== "TOPIC" &&
      analysis.role !== "NOMINATIVE" &&
      analysis.role !== "DEFINIENDUM"
    ) {
      continue;
    }
    // A subject that begins with a first-person possessive determiner. Handled by dropping the
    // analysis rather than by prohibiting, because 내수 and 내 수익률 are the same three syllables
    // with a space moved and no rule available here tells them apart -- prohibiting would accuse
    // "what is domestic demand" of asking for advice, which is the 44-case error in Korean.
    if (
      KOREAN_POSSESSIVE_DETERMINERS.some((d) => analysis.stem.startsWith(d) && analysis.stem !== d)
    ) {
      continue;
    }
    candidates.push(parse(analysis.stem));
  }

  // One zero-marked subject IS admitted, and it is the one shape that carries its own proof.
  //
  // I claimed no lexicon-free rule could admit a zero-marked nominal while still refusing 안, 사야
  // and 사는, and adversarial review falsified that with `CPI 얼마인가요?`. An all-uppercase Latin
  // token cannot be an inflected Korean verb — Korean inflection is written in Hangul — so the
  // script and the case ARE the category evidence that a bare Hangul token cannot supply. That is a
  // closed structural class, not a vocabulary: it admits every acronym the product will ever hold
  // and no Korean word at all.
  //
  // Deliberately narrow. `원달러환율 얼마야?` stays refused, because a bare Hangul stem still has no
  // evidence of being nominal. This does not reopen zero-marking; it recognises the one host shape
  // whose category is legible without a lexicon.
  if (candidates.length === 0 && /^[A-Z][A-Z0-9.-]*$/.test(subjectEojeol)) {
    candidates.push(parse(subjectEojeol));
  }

  // There is no zero-marked subject any more, and its removal is the largest thing this round did.
  //
  // It was added to lift Korean recall from one development case to three, and adversarial review
  // showed what it actually bought: `안 얼마인가요?` authorized with the NEGATOR as its subject, and
  // `사야 얼마인가요?` with an obligation form as its subject. Exactly two eojeol proves how many
  // whitespace tokens there are; it proves nothing about the first one being a noun phrase, so any
  // token at all was being promoted to a subject on the strength of the second one alone.
  //
  // Telling a Korean noun from an inflected verb needs a lexicon or a POS model, and this
  // repository has neither. So the grammar requires an OVERT case marker, and 원달러환율 얼마야 --
  // ordinary spoken Korean -- is refused with the rest. That is the capability this costs, stated
  // rather than absorbed.
  //
  // What survives is the rule underneath: evidence that was present and declined never falls
  // through to a weaker reading. A malformed marker is the same case — `기준금리은` carries 은 after
  // a vowel, which `analyseNoun` refuses, and a speaker who wrote a case marker meant one.
  //
  // A `DECLINED_MARKER` state stood here to say that in the refusal message, distinguishing "ended
  // in something shaped like a particle that cannot be one" from "no marker at all". Mutation
  // reported it MISSED, and the reason is structural: with the zero-marked reading gone, both cases
  // already reach UNSUPPORTED, because a subject with no surviving marked analysis has no way
  // through. It changed the wording and never the outcome, so it is deleted rather than kept — one
  // rule doing the work instead of one rule and a spare, the same call as the second guard removed
  // from `attributionMatch`. The invariant is enforced by requiring the marker, not by naming it.
  if (candidates.length === 0) return { status: "NONE" };

  const distinct = [...new Set(candidates.map((p) => `${p.operation}:${p.subjectRegion.trim()}`))];
  if (distinct.length > 1) return { status: "AMBIGUOUS", readings: distinct };
  return { status: "ONE", match: candidates[0] };
}

function recogniseAll(normalized: string): Recognised[] {
  const found: Recognised[] = [];

  for (const construction of CONSTRUCTIONS) {
    const [opening, closing] = construction.markers;
    const at = normalized.indexOf(opening);
    if (at === -1) continue;

    let subjectStart: number;
    let subjectEnd: number;
    let before: string;
    let after: string;

    if (construction.subjectSide === "BEFORE") {
      subjectStart = 0;
      subjectEnd = at + 1;
      before = " ";
      after = normalized.slice(at + opening.length - 1);
    } else {
      subjectStart = at + opening.length - 1;
      subjectEnd = closing ? normalized.indexOf(closing, subjectStart) : normalized.length;
      if (closing && subjectEnd === -1) continue;
      before = normalized.slice(0, at + 1);
      after = closing ? normalized.slice(subjectEnd + closing.length - 1) : " ";
    }

    const subjectRegion = normalized.slice(subjectStart, subjectEnd);
    if (!subjectRegion.trim()) continue;
    found.push({
      operation: construction.operation,
      subjectRegion,
      residue: `${before} ${after}`.trim().split(" ").filter(Boolean),
    });
  }

  return found;
}

/**
 * The mechanism operation is not recognised here, and the delegation target matters.
 *
 * `subjectAuthority.relationSyntax` already reads relation clauses — direction, polarity,
 * cardinality, all of it proven across IR-105 and IR-106 — and a second grammar for the same
 * sentences would be a second answer to one question.
 *
 * The first version of this asked `classifyRequestFrame` instead, which is the narrow pattern list
 * this unit exists to stop depending on: a request phrased "how does X affect Y" is a relation by
 * any reading and that classifier wants "how does X work". Asking the relation parser instead means
 * a mechanism request is one that contains exactly one affirmed relation clause — which is what the
 * words "mechanism request" mean, rather than which phrasebook entry it matched.
 */
function mechanismMatch(query: string): Recognised | null {
  const syntax = relationSyntax(query);
  // AFFIRMED as well as ONE. A denial is a recognised relation clause and not a request for the
  // relation — IR-106 established that the repository stores evidence relations exist and none
  // that one does not, so "how A does not affect B" is unanswerable rather than a mechanism ask.
  if (syntax.status !== "ONE" || syntax.clause.polarity !== "AFFIRMED") return null;
  // A `Recognised`, not a verdict.
  //
  // This returned an AUTHORIZED verdict directly, and adversarial review found the hole that made:
  // the mechanism branch returned before the pronoun rule, the coordinator bound and the unread
  // check ever ran, so `"Explain how inflation affects the right investment for my retirement."`
  // was authorized as a stored mechanism. Two variants were worse — one asked how much the reader
  // should hold in bonds, one appended "then pick my lender".
  //
  // The delegation was right and the early return was not. Recognising a relation says the request
  // has a relation in it; it does not say the relation is the whole request, and every other
  // operation already has to prove that. So this yields a candidate and rejoins the same path: one
  // discipline, no operation exempt from it.
  //
  // The subject region is the clause's own two regions, which is what the pronoun rule needs to
  // read — "the right investment for my retirement" is the effect region, and it names the reader.
  return {
    operation: "STORED_MECHANISM",
    subjectRegion: `${syntax.clause.cause} ${syntax.clause.effect}`,
    causeRegion: syntax.clause.cause,
    effectRegion: syntax.clause.effect,
    residue: [],
  };
}

/**
 * An interval is an ADJUNCT, and an adjunct sits at the edge of the clause.
 *
 * This was a substring search over the whole request, and architecture review showed what that
 * costs: `"What is the change in Last Year Holdings?"` was AUTHORIZED as OBSERVED_CHANGE, with
 * "last year" read out of the middle of the subject's own name as the required operand. A request
 * that states no period satisfied the rule that a period must be stated.
 *
 * The bound is positional and needs no new vocabulary. A temporal adjunct is either fronted or
 * trailing: everything on one side of it must be framing. Inside a noun phrase, with subject
 * material on both sides, it is part of the name and not an operand. "last year holdings" has
 * "holdings" after it, so it is not an adjunct; "us gdp last year" has nothing after it, so it is.
 *
 * Returns the span as well as the text, because the subject must not also contain it — one piece of
 * the request cannot be two constituents at once.
 */
interface IntervalConstituent {
  operand: string;
  /** Index in `normalized` of the space preceding the operand. */
  start: number;
  /** Index in `normalized` of the space following the operand. */
  end: number;
}

function normalizedTokens(normalized: string): string[] {
  return normalized.trim().split(" ").filter(Boolean);
}

/** Removes an edge-anchored interval from a subject region, leaving the name it was attached to. */
function withoutInterval(region: string, span: IntervalConstituent | null): string {
  if (!span) return region;
  const normalizedRegion = normalize(region);
  return normalizedRegion.slice(0, span.start) + " " + normalizedRegion.slice(span.end);
}

function allFraming(span: string): boolean {
  return span
    .trim()
    .split(" ")
    .filter(Boolean)
    .every((token) => FRAMING_TOKENS.has(token));
}

function intervalConstituent(normalized: string): IntervalConstituent | null {
  for (const operand of INTERVAL_OPERANDS) {
    const start = normalized.indexOf(" " + operand + " ");
    if (start < 0) continue;
    const end = start + operand.length + 1;
    const fronted = allFraming(normalized.slice(0, start));
    const trailing = allFraming(normalized.slice(end));
    if (fronted || trailing) return { operand, start, end };
  }
  return null;
}

/**
 * Decides what a request asks for, before anything is looked up.
 *
 * Order is load-bearing. The prohibited screen runs first and its precedence is absolute: a factual
 * clause never rescues a personalized directive, and this is the only check that may pre-empt the
 * others. Everything after it is positive recognition, and nothing recognised means UNSUPPORTED.
 */
export function resolveRequestAuthority(query: string): RequestAuthority {
  if (detectPersonalizedAdviceRequest(query)) {
    return {
      status: "PROHIBITED",
      detail:
        "The request asks the product to decide, choose or act on the reader's behalf. " +
        "docs/LEGAL_GUARDRAILS.md requires a redirect, and a factual clause alongside it does not " +
        "change that.",
    };
  }
  const directiveFramed = classifyRequestFrame(query) === "REQUEST_DIRECTIVE";
  const normalized = normalize(query);

  // `subjectAuthority` resolves the relation, its direction, its polarity and its cardinality, and
  // refuses when any of those is unproven. What it cannot say is whether the relation is all the
  // request asks for, so its answer is a candidate here and not a verdict.
  const mechanism = mechanismMatch(query);
  const attribution = attributionMatch(normalized);
  // The Korean grammar is consulted only for requests that contain Korean, and it is consulted
  // LAST among the special cases so that a mixed-script request keeps whatever the English path
  // made of it. Nothing above this line can match Korean — the constructions, the reporting acts
  // and the relation verbs are all English literals — so the guard is about intent rather than
  // necessity: two grammars must never both be allowed an opinion about one sentence.
  const korean = containsHangul(query) ? koreanCopularMatch(query) : { status: "NONE" as const };
  if (korean.status === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      detail:
        `The request has more than one morphological reading — ${korean.readings.join(", ")} — ` +
        "and choosing between them would need either the subject inventory, which must not decide " +
        "what a sentence meant, or a guess.",
    };
  }
  const recognised = mechanism
    ? [mechanism]
    : attribution
      ? [attribution]
      : korean.status === "ONE"
        ? [korean.match]
        : recogniseAll(normalized);
  if (recognised.length === 0) {
    // A personal stake still decides, even with nothing recognised. Placed here rather than at the
    // top so that a recognised request keeps being judged by its subject region, which is the
    // narrower and better evidence; this only covers the case where there is no subject region to
    // look at. Refusing these as UNSUPPORTED said "not yet" about something that must never be.
    if (firstPersonPossession(query, normalized)) {
      return {
        status: "PROHIBITED",
        detail:
          "The request is about something the reader owns. A possessive first person attaches to " +
          "a noun phrase and makes that noun theirs, which is a personalized request whatever " +
          "operation it would otherwise have been.",
      };
    }
    // Unrecognised, and that is all it is.
    //
    // This returned PROHIBITED whenever `classifyRequestFrame` called the request a directive, and
    // the development corpus measured what that costs: 44 ordinary requests accused of asking for
    // personalized advice, across all five operations. "Give me the figure for Korea's headline
    // consumer price index." is an imperative and is not a decision request. Request MOOD is not
    // evidence of prohibited PURPOSE — conflating them is the same substitution, one level up, that
    // this unit exists to remove. Nothing is authorized by the change: unrecognised still refuses.
    return {
      status: "UNSUPPORTED",
      detail:
        "The request matches no operation this repository can perform. Unrecognised is " +
        "unsupported, never permitted by default." +
        (directiveFramed ? " It is phrased as an instruction, which is not itself a reason." : ""),
    };
  }

  const operations = new Set(recognised.map((r) => r.operation));
  if (operations.size > 1) {
    return {
      status: "AMBIGUOUS",
      detail: `The request reads as ${[...operations].join(" and ")}, and one answer cannot be both.`,
    };
  }

  const [match] = recognised;
  const contract = OPERATION_CONTRACTS[match.operation];

  // A possessive anywhere in a RECOGNISED request, not only in an unrecognised one.
  //
  // This check used to run in the `nothing recognised` branch alone, and adversarial review said
  // that ordering was exploitable without giving a case that worked. It is:
  //
  //     "What did my bank publish about US headline CPI?"
  //
  // was AUTHORIZED as an attributed report with the source region "my bank". The subject region is
  // clean, so the pronoun rule below never sees the possessive, and `SOURCE_DISQUALIFIERS` only
  // rejects a source made ENTIRELY of pronouns — "my bank" has a noun in it, so it bound. The
  // reader's own bank became a publisher whose reporting the product would serve.
  //
  // Recognising an operation says what KIND of answer was asked for. It says nothing about whether
  // the request is about the reader, and the two questions were being answered by one branch.
  if (firstPersonPossession(query, normalized)) {
    return {
      status: "PROHIBITED",
      detail:
        "The request is about something the reader owns. A possessive first person attaches to a " +
        "noun phrase and makes that noun theirs, which is a personalized request whatever " +
        "operation it would otherwise have been.",
    };
  }

  // The subject cannot also be the interval. A trailing construction's subject region runs to the
  // end of the request, so "us gdp last year" arrives with the adjunct inside it; leaving it there
  // means the same words are counted twice, once as the thing asked about and once as the period.
  const subjectRegion = withoutInterval(
    match.subjectRegion,
    intervalConstituent(normalize(match.subjectRegion)),
  );
  const subjectTokens = subjectRegion.trim().split(" ").filter(Boolean);
  if (subjectTokens.some((token) => PERSONAL_PRONOUNS.includes(token))) {
    return {
      status: "PROHIBITED",
      detail:
        "The subject of the request is the reader rather than a stored subject. A question about " +
        "what I hold or what I should do is a personalized request however it is phrased.",
    };
  }
  if (subjectTokens.some((token) => CLAUSE_CONNECTIVES.includes(token))) {
    return {
      status: "UNSUPPORTED",
      detail:
        "The subject runs into another clause, so the request asks more than one thing. Answering " +
        "the first would answer a different question.",
    };
  }

  // There are no halves. Anything the grammar has not read is a second thing being asked, and a
  // request that asks two things cannot be satisfied by answering one of them.
  const intervalSpan = intervalConstituent(normalized);
  const interval = intervalSpan?.operand ?? null;
  const intervalTokens = new Set(interval ? interval.split(" ") : []);
  // An operation's own required operand is not leftover content. The attribution marker names the
  // source an attributed report must bind to, so it is part of the request being read, not a
  // second thing being asked.
  // Nothing to exempt any more: the source is a bound constituent rather than a name that had to
  // be forgiven for appearing.
  const operandTokens = new Set<string>();
  const unread = match.residue.filter(
    (token) =>
      !FRAMING_TOKENS.has(token) && !intervalTokens.has(token) && !operandTokens.has(token),
  );
  if (unread.length > 0) {
    return {
      status: "UNSUPPORTED",
      detail:
        `The request carries ${unread.map((t) => `"${t}"`).join(", ")} beyond the operation and ` +
        "its subject. Something else is being asked, and answering the part that was understood " +
        "would answer a different question.",
    };
  }

  if (contract.temporalOperands === "INTERVAL" && !interval) {
    return {
      status: "AMBIGUOUS",
      detail:
        "A change request must say over what period. Choosing one would be inventing the question.",
    };
  }

  // There is no attribution check here any more, and its absence is the point.
  //
  // It read `if (contract.requiresAttribution && !attributionBound) refuse`, and mutation showed
  // it could be deleted or forced true with nothing failing. That is not a missing test: since the
  // eight attributed construction rows were removed, `attributionMatch` is the only thing that
  // produces this operation and it returns null rather than a match when no source binds. The
  // requirement moved from being checked after the fact to being impossible to violate, which is
  // where a requirement should live. `requiresAttribution` stays on the contract as the statement
  // of what the operation needs -- if a construction row for it is ever added back, that row must
  // bind the role, because nothing downstream will catch it.

  return {
    status: "AUTHORIZED",
    operation: match.operation,
    contract,
    subjectRegion,
    sourceRegion: match.sourceRegion,
    causeRegion: match.causeRegion,
    effectRegion: match.effectRegion,
    interval: interval ?? undefined,
    detail: `Recognised as ${match.operation}.`,
  };
}

/**
 * Why a directive frame no longer prohibits on its own.
 *
 * `REQUEST_DIRECTIVE` fires on imperative phrasing, and asking for something politely is imperative:
 * IR-107 measured eleven ordinary requests refused as directives, `"Show me the current UK policy
 * rate."` among them, and Korean request forms end in 알려줘 or 알려주세요 almost invariably.
 * Treating every imperative as a decision request is the mirror of treating every "stop-loss" as
 * one.
 *
 * So the directive frame prohibits when the request does NOT parse as one complete operation.
 * A complete parse — recognised framing, one construction, one subject, nothing unread — is
 * positive evidence that what was asked for is information, which is exactly the proof of purpose
 * the absence of a prohibition cannot supply. `"Tell me today's gold price, then decide how many
 * ounces I should buy."` does not parse: its second clause is unread, so it stays prohibited
 * without anyone having to recognise what that clause says.
 *
 * The advice detector keeps absolute precedence above all of this and is unchanged.
 */
