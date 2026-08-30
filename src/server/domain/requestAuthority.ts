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
  PARTICLE_SURFACES,
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

/**
 * Whether a stored name may be found INSIDE the subject region or must be the whole of it.
 *
 * Decided by the grammar that produced the region, because only that grammar knows whether the
 * region is a phrase with internal structure or a single morpheme that happens to contain
 * characters a normalizer will split on.
 */
export type SubjectIdentityMode = "OCCURRENCE" | "WHOLE_REGION";

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

/**
 * The canonical parse of a request that WAS recognised, as a value that can travel.
 *
 * IR-107 Unit 2 Phase B2. `authorizeInference` already computes `resolveRequestAuthority` and then
 * throws it away, so `deriveCandidateEnvelope` re-derives operation and subject from the raw query
 * through the LEGACY frame classifier. One sentence, two parsers, and the lower one wins because it
 * is the one holding the records.
 *
 * Naming the positive case as its own type is what lets it be carried instead of recomputed. It is
 * deliberately the AUTHORIZED variant and nothing else: an unrecognised request has no canonical
 * parse to pass along, and a type that could represent one would invite a caller to synthesise it.
 */
export type CanonicalAuthorizedRequest = Extract<RequestAuthority, { status: "AUTHORIZED" }>;

/**
 * The subset of canonical parses a planner may ever be given, as a type rather than a check.
 *
 * IR-107 Unit 2 Phase B2. Three of the five operations are `plannerPermitted: false` — a current
 * level, a computed change and a definition are deterministic repository output, and a model can
 * only make a stored figure less true. `authorizeInference` already refuses them, so the candidate
 * path is unreachable for them today; this makes that unreachability a compiler fact instead of a
 * consequence of one caller's ordering.
 *
 * The point of narrowing `operation` AND `contract` together is that they were independent fields:
 * nothing stopped a value claiming `STORED_MECHANISM` while carrying the definition contract.
 * Correlating them means a function that accepts this type has been handed a parse whose contract
 * agrees with its operation, without asserting it.
 *
 * ## What this boundary does and does NOT guarantee
 *
 * It guarantees the operation is one of the two planner-permitted ones and that the contract agrees
 * with it. That is checked, and the switch is exhaustive so a sixth operation is a compile error.
 *
 * It does NOT guarantee the REGIONS came from a real construction, and an earlier version of this
 * comment claimed otherwise. Adversarial review built a value from a genuine parse with
 * `causeRegion` and `effectRegion` replaced by arbitrary strings, and `asPlannerRequest` accepted
 * it. The brand below narrows the hole to exactly that — a value must be DERIVED from something
 * this module produced, so it cannot be conjured from nothing — but a caller that deliberately
 * overwrites a field of a genuine parse is trusted, and no type can fix that without re-parsing,
 * which is the thing this whole unit removes.
 *
 * So the honest statement is: the constructor proves provenance and the operation/contract
 * correlation; region CONTENT is a caller obligation. The production caller passes
 * `authorization.request` untouched.
 */
declare const plannerRequestBrand: unique symbol;

export type CanonicalPlannerRequest = CanonicalAuthorizedRequest & {
  /**
   * Present only on values this module produced. Not readable or constructible elsewhere, because
   * the symbol is `declare const` and never exported — so a hand-built object literal cannot
   * satisfy the type, and `asPlannerRequest` is the only way in.
   */
  readonly [plannerRequestBrand]: true;
} & (
    | {
        operation: "ATTRIBUTED_REPORTED_OBSERVATION";
        contract: OperationContract & {
          operation: "ATTRIBUTED_REPORTED_OBSERVATION";
          plannerPermitted: true;
        };
      }
    | {
        operation: "STORED_MECHANISM";
        contract: OperationContract & { operation: "STORED_MECHANISM"; plannerPermitted: true };
      }
  );

/**
 * Narrows a canonical parse to the planner-permitted subset, or refuses.
 *
 * An exhaustive switch with no `default`, so adding a sixth operation is a compile error here rather
 * than a silent omission. The three refusals return null rather than throwing: reaching this
 * function with a deterministic operation means an earlier gate changed, which is a bug to surface
 * at the call site, not an exception to unwind through a request.
 */
export function asPlannerRequest(
  request: CanonicalAuthorizedRequest,
): CanonicalPlannerRequest | null {
  switch (request.operation) {
    case "ATTRIBUTED_REPORTED_OBSERVATION":
    case "STORED_MECHANISM":
      // The contract is looked up from `OPERATION_CONTRACTS` by the parser, so its `operation`
      // agrees with this one by construction; the guard states the correlation the type needs and
      // would catch a hand-built value that broke it.
      return request.contract.operation === request.operation && request.contract.plannerPermitted
        ? (request as CanonicalPlannerRequest)
        : null;
    case "CURRENT_OBSERVATION":
    case "OBSERVED_CHANGE":
    case "DEFINITION":
      return null;
  }
}

/**
 * Named separately so that `PROHIBITED` can carry one without the union referring to itself.
 *
 * `CanonicalAuthorizedRequest` remains `Extract<RequestAuthority, { status: "AUTHORIZED" }>` and is
 * the same type; extracting the member here is what lets a prohibited verdict hold an authorized
 * one as DATA. A type alias that referenced the union from inside the union would be circular.
 */
export type AuthorizedRequest = {
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
  /**
   * How the repository must match `subjectRegion` against the names it holds.
   *
   * `OCCURRENCE` is the English default and the established rule: a stored name counts when it
   * OCCURS in the region and is not nested inside a longer match. That works because an English
   * subject region is several tokens and a stored name occupying some of them is a real, whole
   * mention of that subject.
   *
   * `WHOLE_REGION` is what a single-morpheme subject requires, and it exists because the
   * difference produced a wrong answer. `USD-KRW는 얼마인가요?` parses to the one stem
   * `USD-KRW`; normalization turns the hyphen into a space; `KRW` then occurs as a whole token
   * and, with only `KRW` stored, the question about the pair was answered with one leg of it.
   * A grammar that produced its subject as ONE indivisible stem is entitled to say so, and the
   * repository is not entitled to find a smaller subject inside it.
   */
  subjectIdentity: SubjectIdentityMode;
  detail: string;
};

export type RequestAuthority =
  | AuthorizedRequest
  | {
      status: "PROHIBITED";
      detail: string;
    }
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
/**
 * The subset of framing that can stand CLAUSE-INITIALLY in an English question or instruction.
 *
 * A grammatical partition of a class this module already trusts, not new vocabulary. Membership
 * answers exactly one question: could this word begin a fresh clause? That is what makes it
 * evidence that a candidate boundary really ended a sentence.
 *
 * The exclusions are the whole point, and each was forced by a measured counterexample rather than
 * chosen for tidiness. Prepositions and determiners (`of`, `for`, `in`, `to`, `s`) continue a noun
 * phrase -- `the U.S. Bureau of Labor Statistics` is one source, and treating `of` as evidence of a
 * new clause refuses it. The measure nouns (`value`, `level`, `reading`, `figure`, `number`, `rate`,
 * `print`) are name TAILS -- `Acme Inc. rate`, `No. 10 index level` -- and only collide here at all
 * because abbreviation-bearing names carry internal terminator punctuation. Non-finite `be`, `been`,
 * `being` cannot open a clause; object pronouns `me`, `us` and quantifiers `much`, `many` cannot
 * either.
 *
 * Scanning ALL of `FRAMING_TOKENS` instead was tried and refuted in both directions: it refuses the
 * institutional names above, and it misses a Hangul tail entirely, which carries no English token.
 *
 * ## This set is NOT closed by any evidence in this repository, and that is a live limitation
 *
 * P1 review found `who` and `why` missing. Reproducing it found four more -- `Who said that?`,
 * `Compare it to Gamma.`, `List the Gamma figures.`, `Any Gamma figures?`, `Same for Gamma?` were
 * all being swallowed -- so the finding was wider than reported, and each instance was one absent
 * word. They are added below and each has a discriminator.
 *
 * The method is the part that is not fixed. Every mutant here asks whether the implemented set is
 * LOAD-BEARING; none can ask whether it is COMPLETE, and a mutation score cannot distinguish
 * "nothing is missing" from "nothing missing has been thought of". Deriving the set from
 * `FRAMING_TOKENS` by subtraction would not help either: `who`, `why`, `compare`, `list`, `any`
 * and `same` are not in `FRAMING_TOKENS` at all -- they reach an open-class region, where unread
 * content is not checked, which is the defect rather than a gap in the allowlist.
 *
 * Recorded as an open method question in `docs/REVIEW_DEBT.md` rather than declared solved.
 */
const CLAUSE_OPENING_TOKENS = new Set([
  // Interrogatives. The first three were here; the rest were the P1. `whose`, `whom`, `when` and
  // `where` happened to be refused already, each through some OTHER token in the same clause
  // (`is`, `did`, `was`), which is coverage by luck and is why they are named explicitly now.
  "what",
  "which",
  "how",
  "who",
  "whom",
  "whose",
  "why",
  "when",
  "where",
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
  "will",
  "would",
  "can",
  "could",
  "may",
  "might",
  "must",
  "there",
  // Imperatives. `compare` and `list` belong to exactly the class `tell`/`show`/`give` already
  // names, and were swallowing `Compare it to Gamma.` and `List the Gamma figures.`
  "please",
  "tell",
  "show",
  "give",
  "explain",
  "describe",
  "compare",
  "list",
]);

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

/**
 * Is every token of `region` a word this grammar already treats as framing?
 *
 * Exported for `canonicalRoleCover`, which has to ask whether the part of a role that is NOT the
 * stored identity is accounted for. There is a second framing vocabulary in `subjectAuthority`,
 * and the two are deliberately different rather than duplicated: that one describes what may
 * precede a RELATION clause (`explain how the`), this one what may precede an OBSERVATION subject
 * (`how much has`). Using the relation set for a subject role refused
 * `How much has <series> changed this year?`, which is how the difference was found.
 */
export function requestFramingIsRecognised(region: string): boolean {
  const tokens = normalizedTokens(normalize(region));
  return tokens.every((token) => FRAMING_TOKENS.has(token));
}

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
 * Coordination and comparison of OBJECTS, as opposed to of clauses.
 *
 * CORRECTED after structural review. This claimed to be "the same closed grammatical class as
 * `CLAUSE_CONNECTIVES`", and that is true of `and`/`or` and NOT true of the comparison forms.
 * `relative to`, `as opposed to`, `rather than` and `in comparison with` are productive multiword
 * constructions; this list cannot enumerate them and does not.
 *
 * So the honest statement is narrower: the coordination half is closed, the comparison half is a
 * partial list that catches the common forms and is not claimed to be complete. What limits the
 * damage is that it is not the only guard -- candidate-region validation refuses most of the rest
 * downstream -- and that failing to match here fails CLOSED at the next layer rather than
 * publishing.
 *
 * ESC-015's acceptance case is what forced this. `Explain how Alpha affects Beta and Gamma.`
 * already refused, because `and` is a clause connective. `Beta, Gamma`, `Beta versus Gamma` and
 * `Beta compared with Gamma` did NOT -- they authorized a stored mechanism whose effect region was
 * ` beta versus gamma `, publishing A->B while silently discarding C.
 *
 * The decisive point is that this must hold whether or not `C` is a name the repository knows.
 * Inventory cannot be the proof: a missing row is evidence about the repository and never evidence
 * about what the request meant. So the check is on the REQUEST TEXT, before any lookup.
 */
const OBJECT_COORDINATORS = ["versus", "vs", "compared", "comparing", "alongside", "besides"];

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
/** Kept with the source name when one directly precedes it -- see the source slot scan. */
const DETERMINERS = new Set(["the", "a", "an"]);

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
  /** How the subject region must be matched against stored names. See `SubjectIdentityMode`. */
  subjectIdentity?: SubjectIdentityMode;
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
      // A determiner IMMEDIATELY before the name is kept, because it may be part of the name.
      //
      // `the` is framing, so the scan used to drop it and hand the identity layer ` street ` for
      // both `What did The Street publish about X?` and `What did Street publish about X?`. Those
      // are different requests and after this point nothing could tell them apart -- which was
      // found the hard way: the repair for it stripped articles off STORED names instead, and that
      // made `Street` resolve to a stored `The Street`, and `Post` resolve to `An Post` where the
      // article is part of the name. Publication review called it a P1 and was right; the loss has
      // to be prevented here rather than guessed at downstream.
      //
      // Keeping it costs nothing when the article is NOT part of the name: `What did the analysts
      // publish about X?` yields ` the analysts `, and the source cover already tolerates recognised
      // framing in front of the identity, so a provider stored as `analysts` still resolves. The
      // tolerance runs one way only, which is the asymmetry that makes this safe -- an article the
      // request supplied can be ignored against a name that lacks it, and an article the request
      // never said cannot be invented against a name that has one.
      const article = opens > 0 && DETERMINERS.has(sourceTokens[opens - 1]) ? opens - 1 : opens;
      const source = sourceTokens.slice(article);
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
    // One eojeol, one stem, no internal constituent the repository may match separately.
    subjectIdentity: "WHOLE_REGION",
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

  /*
   * A zero-marked ACRONYM subject was admitted here, on the argument that an all-uppercase Latin
   * token cannot be an inflected Korean verb. Adversarial review falsified my claim that no such
   * lexicon-free rule existed, and it was right that one exists. It is deleted anyway, because
   * existing and being worth shipping are different questions and the measurement answers the
   * second one:
   *
   *   corpus value      zero. Coverage was 59/300 before it and 59/300 with it.
   *   false positives   `BUY 얼마인가요?`, `SELL 무엇인가요?` and `SHORT 얼마인가요?` all authorized
   *                     with a trading directive as the subject. In a product whose guardrail is
   *                     about trading advice, that is the wrong shape even while it is inert.
   *   false negatives   `S&P500 얼마인가요?` refused, because `&` is not in the shape.
   *
   * Uppercase is a fact about typography, not about category, and the repair on offer needs either
   * a lexicon or the inventory deciding grammar. This is the same call as `internalConjunction`,
   * measured the same way and for the same reason: a surface shape standing in for a category, with
   * unbounded error on both sides.
   *
   * `S&P500은 얼마인가요?` and `CPI는 무엇인가요?` are unaffected — they carry an overt marker, which
   * is evidence, and they never needed this branch.
   */

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

/**
 * Nouns that talk about words. The Korean counterpart of `METALINGUISTIC_HEADS`.
 *
 * Same argument, same failure direction: a head missing from here means a definitional request is
 * REFUSED, never that something else is admitted. `표현` is included because Korean cites a term
 * with it -- `X라는 표현은` is "the expression 'X'" -- which is metalinguistic in the strict sense.
 */
const KOREAN_METALINGUISTIC_HEADS = ["뜻", "의미", "정의", "개념", "용어", "표현"];

/**
 * The heads whose 하다 form still MEANS "to mean".
 *
 * The light-verb carveout was written for 의미하는 ("that means") and applied to every head, and
 * review answered `주가가 무엇을 정의하나요?` -- "what does the share price DEFINE" -- authorized,
 * with `표현하나요` ("what does it express") right behind it. Both are agentive: the subject is
 * doing the defining. 의미하다 and 뜻하다 are not -- the subject IS the meaning, which is the same
 * relation the noun expresses.
 *
 * So the carveout follows the semantics of the derived verb rather than the shape of the
 * derivation. 정의하다, 표현하다, 개념하다 and 용어하다 get no verbalised form here; the first two
 * because they name an act, the last two because they are not verbs at all.
 */
const KOREAN_MEANING_HEADS = ["의미", "뜻"];

/**
 * The interrogatives that ask what a thing IS.
 *
 * `무엇`/`뭐` are the closed pronoun class `koreanMorphology` already names; `뭔`/`뭘` are their
 * contracted forms before `-지`/`-을`, and `무슨` is the corresponding determiner. None of them asks
 * a quantity, a time or a source, which is what makes the frame positively definitional rather than
 * merely interrogative. `얼마` is deliberately absent: it asks HOW MUCH, and that is
 * CURRENT_OBSERVATION's question.
 */
const KOREAN_WHAT_INTERROGATIVES = ["무엇", "뭐", "뭔", "뭘", "무슨"];

/**
 * Determiners that make a following noun the QUESTION rather than the answer.
 *
 * `어떤 개념인지` is "what kind of concept", and it is what separates
 * `신용스프레드가 어떤 개념인지` -- a definitional request, and a corpus row -- from
 * `주가가 개념인가요?`, which asks whether the share price is one. They are otherwise the same
 * shape. Absorbed into the marker so the term does not end with one.
 *
 * Deliberately used ONLY in front of a metalinguistic head. `어떤 수준인지` is a current
 * observation, and 수준 is not a head, so it never reaches this.
 */
const KOREAN_INTERROGATIVE_DETERMINERS = ["어떤", "어떠한", "무슨"];

/**
 * Trailing eojeols that ask FOR the answer rather than adding to the question.
 *
 * `설명해 주세요`, `알려줘`, `궁금합니다`, `알고 싶어요`. These are politeness and request framing:
 * they say the speaker wants to be told, which every request already says.
 *
 * AN OPEN CLASS, and safe to keep as a list only because of which way it fails. A form missing from
 * here survives as an unconsumed eojeol, the term region then fails to parse, and the request is
 * REFUSED. Nothing is admitted by an omission. That is the property the English arithmetic list did
 * not have, which is why that one had to go and this one may stay.
 *
 * MATCHED WHOLE, and that qualifier is the whole of the property. Matching by PREFIX destroyed it:
 * review found `주가가 무엇을 설명하나요?` -- "what does the share price EXPLAIN" -- authorized,
 * because `설명하나요` starts with `설명` and was stripped as framing, leaving a bare interrogative
 * behind. A prefix test does not consume framing, it consumes any predicate that happens to begin
 * with a framing word, and that admits rather than refuses.
 */
const KOREAN_REQUEST_FRAME = [
  "설명",
  "설명해",
  "설명해줘",
  "설명해주세요",
  "설명해주십시오",
  "알려",
  "알려줘",
  "알려주세요",
  "알려주십시오",
  "주세요",
  "주십시오",
  "궁금",
  "궁금해",
  "궁금해요",
  "궁금합니다",
  "알고",
  "싶어",
  "싶어요",
  "싶습니다",
];
/**
 * Markers that give the term a complement, an adjunct or a second constituent.
 *
 * The Korean counterpart of `TERM_COMPLEMENT_PREPOSITIONS`, and it refuses the same requests for the
 * same reason: `국채 입찰에서 응찰률이란?` restricts the term to a setting, exactly as
 * `What is duration in bond mathematics?` does, so both are refused rather than half-read.
 *
 * TEMPORAL ADVERBS ARE NOT HERE, and were until review produced `내일 주가가 뭐야?`. 현재, 지금,
 * 오늘, 최근, 올해, 작년, 내년 were listed and 내일 was not, which is the subset-as-class mistake
 * again -- the class has no end, and `koreanCopularMatch`'s own comment says so. They are removed
 * rather than extended.
 *
 * WHAT REPLACES THEM IS NARROWER THAN THIS COMMENT TWICE CLAIMED, and both corrections came from
 * review. The borrowed two-eojeol proof refuses `내일 주가가 뭐야?`, where the marker is a bare
 * final interrogative. It does not reach `오늘 주가 하락의 의미가 무엇인가요?` -- that is refused by
 * the metalinguistic path's own one-eojeol rule instead.
 *
 * And it does not reach `오늘주가가 뭐야?` AT ALL, written without the space. That request never
 * arrives here: two eojeol is `koreanCopularMatch`'s own construction, it recognises the request
 * itself, and this recogniser is never consulted. Verified by disabling this function entirely and
 * re-running the string -- still DEFINITION. `koreanCopularMatch` is byte-identical to the base of
 * this unit, so the defect is PRE-EXISTING and is logged in `docs/REVIEW_DEBT.md` rather than
 * repaired here: 오늘주가 and 종합주가 are morphologically the same shape, and separating them needs
 * a lexicon or the adverb list that function already refused to keep.
 *
 * These, by contrast, are PARTICLES and postpositions -- a closed morphological class, the same
 * kind of inventory as `PARTICLE_SURFACES`. Closed, and NOT claimed finished: review named 처럼
 * after this comment said it was, which is the same mistake the English preposition list made
 * three times. An omission admits into the bounded residue described there, not into another
 * operation.
 */
const KOREAN_COMPLEMENT_MARKERS = [
  "에서",
  "에게",
  "에는",
  "에도",
  "에 대",
  "부터",
  "까지",
  "보다",
  "으로",
  "하고",
  "및",
  // Round seven named 처럼. The auxiliary particles are a closed morphological class like the case
  // particles, so the rest of the common inventory goes in with it rather than one per round.
  "처럼",
  "만큼",
  "대로",
  "밖에",
  "조차",
  "마저",
  "부터",
  "라도",
  "치고",
  "커녕",
  "따라",
  "관해",
  "대해",
  "위해",
  "비해",
];

/**
 * Syllables that can only be grammar, never lexical content.
 *
 * Case particles, the copula stem 이/인, and the interrogative and declarative endings. What makes
 * this list safe where the deleted arithmetic list was not is the direction again: a grammatical
 * syllable missing from here makes a real marker unrecognisable and REFUSES the request, and a
 * lexical syllable is not going to be added to it by accident.
 */
const KOREAN_GRAMMATICAL_SYLLABLES = [
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "란",
  "인",
  "지",
  "야",
  "죠",
  "요",
  "까",
  "니",
  "나",
  "다",
  "습",
  "입",
  "임",
  "네",
  "래",
];

/**
 * Endings that close a Korean question WITH THE COPULA.
 *
 * A definitional request asks what a term IS, so the predicate that closes it is a form of 이다.
 * The first version of this list took any question ending -- 지, 요, 까, 야, 죠, 니, 나, 다 -- and
 * review answered `주가가 의미가 있나요?`, "is the share price meaningful", which ends in 요 and is
 * an existential rather than a copula. Every form here carries 이/인 or is the contraction 예요.
 */
const KOREAN_COPULAR_ENDINGS = [
  "인가요",
  "인가",
  "인지",
  "인지요",
  "입니까",
  "입니다",
  "이죠",
  "이야",
  "이에요",
  "예요",
  "이다",
  "이란",
  "인",
];

/**
 * Coordinators, tested at the END of an eojeol and never as a substring.
 *
 * `ETF와 리츠의 차이는 무슨 뜻인가요?` asks about two terms, and adding 와 to the postposition list
 * would have refused it -- along with `통화스와프`, a currency swap, which contains 와 in the
 * middle of a compound. That is the exact false positive `koreanMorphology` removed
 * `internalConjunction` for, and it would have cost a corpus row this unit gains.
 *
 * Position is what separates them. 와 coordinates when it CLOSES an eojeol; inside one it is a
 * syllable of a word.
 */
const KOREAN_COORDINATOR_ENDINGS = ["와", "과", "랑", "이랑", "하고", "및"];

/**
 * Coordinating conjunctions that stand as a WHOLE eojeol rather than attaching to one.
 *
 * Review reported `채권 또는 주식은 무슨 뜻인가요?` as authorized, and it was not -- 또는 splits as
 * 또 plus a valid topic 는, so the one-marked-nominal rule already refuses it. The FINDING was still
 * right about the class: 그리고 and 아니면 end in nothing a particle rule can see and did get
 * through, as `채권 그리고 주식은 무슨 뜻인가요?` showed.
 *
 * These are matched whole, which is what makes them safe. A substring test for 및 or 또는 would
 * split compounds the way `internalConjunction` split 통화스와프; an eojeol that IS the conjunction
 * cannot be part of a word.
 */
const KOREAN_COORDINATOR_WORDS = ["또는", "혹은", "그리고", "및", "아니면", "내지", "또한"];

/**
 * `이라는` — the attributive quotative that cites a term: `X이라는 표현`, "the expression 'X'".
 *
 * BARE `라는` IS NOT HERE, and review is why. `떠나라는 뜻이야?` -- "does that mean [we should]
 * LEAVE?" -- was authorized as a definition of `떠나`, because `-(으)라는` is also the adnominal
 * form of a quoted IMPERATIVE, and stripping it leaves a verb stem. The citation path deliberately
 * waives the case-marker requirement, on the argument that the citation particle is itself the
 * evidence of nominality, and for bare `라는` that argument is simply false.
 *
 * `이라는` WAS KEPT ON AN ARGUMENT THAT DID NOT HOLD EITHER, and the next round said so: its 이 was
 * called the nominal copula, and 죽이다, 먹이다, 보이다, 높이다 are causatives whose stems END in
 * 이, so `죽이라는 뜻이야?` cites a verb stem too. The round after that made the same point about
 * `(이)란`, which had twice been called unaffected because `analyseNoun` checks allomorph
 * conditioning -- and conditioning proves SUFFIX COMPATIBILITY, never nominality. `가란 뜻이야?`
 * parses as 가 plus 란.
 *
 * So NOTHING in this list is evidence of anything on its own, and the earlier version of this
 * comment claiming otherwise was itself a review finding. What decides is `citationIsGoverned`: a
 * cited term must govern a definitional interrogative or a case-marked metalinguistic head. This
 * list only says which surfaces are STRIPPED once that holds.
 *
 * NAMED COST of dropping bare `라는`: a vowel-final noun cited with the contracted form --
 * `코스피라는 지수`, where 이 legitimately drops -- is refused. Safe direction, no corpus row.
 */
const KOREAN_CITATION_SUFFIXES = ["이라는"];

/**
 * The Korean half of MARKET-DEFINITION-GRAMMAR-001, built on the same rule as the English half.
 *
 * `koreanCopularMatch` recognises `[TERM+marker] [무엇/뭐 + copula]` in exactly two eojeol, and of
 * the corpus's 30 Korean definitional requests it takes two. The rest are not different questions:
 * `장단기 금리 역전이 무슨 뜻이죠?` and `경상수지의 정의가 궁금합니다` ask what a term means, in four
 * eojeol and in three.
 *
 * ## Why this is not the two-eojeol rule relaxed
 *
 * That rule counts eojeol because the construction IS the whole request, so length is its proof that
 * nothing is left over. Simply allowing more would delete the proof, and the review history of this
 * file is what happens then -- `안 얼마인가요?` authorized with a negator as its subject.
 *
 * So the proof is rebuilt rather than dropped. A definitional marker must be POSITIVELY present, the
 * material before it must be nominal and carry no other operation's operand, and the material after
 * it must introduce no second subject. Length stops being the argument; constituency becomes it.
 *
 * ## What this grammar cannot see inside a nominal, and what that stopped excusing
 *
 * `koreanCopularMatch` says it first: `subjectCardinality: 1` is a claim about the CONSTRUCTION,
 * one marked subject slot, and not about the morphology inside it. That is still true.
 *
 * IT WAS ALSO USED AS A REASON NOT TO FIX TWO THINGS, and this comment argued that case at length
 * before review dismantled it. `오늘 주가 하락의 의미가 무엇인가요?` and
 * `기준금리은 수준이 무슨 뜻인가요?` were declared unfixable without a term lexicon, with
 * `물가` -- 물 plus a 가 its own conditioning declines, as is `소비자물가` -- offered as proof that
 * no suffix scan could work.
 *
 * The counter-example was real and the conclusion was not. Both are REFUSED now, by rules that
 * need no lexicon: a metalinguistic head licenses exactly one eojeol of term, and modifiers BEFORE
 * the final eojeol may not be particle-shaped-but-declined, the final eojeol exempt because that
 * is precisely where a lexical 가 lands. `물가란 무엇인가요?` still works.
 *
 * The limitation that remains is the honest one -- this grammar cannot analyse inside a single
 * marked nominal -- and it is no longer doing duty as an excuse. Declaring something unfixable is
 * itself a claim, and it gets reviewed like any other.
 *
 * ## Why the English narrowing applies here too
 *
 * Four review rounds killed the bare English `what is X` because X was unconstrained and could only
 * be filtered by listing what it must not contain. Korean is not exempt -- it is only luckier, in
 * that the language marks the distinction morphologically. `X가 뭐야` says "what IS X" with a
 * pronoun that cannot ask a quantity, and `X의 정의` says "the definition of X" with a noun that
 * cannot mean anything else. The marking is in the grammar, so no phrase list stands in for it.
 */
function koreanDefinitionalMatch(query: string): Recognised | null {
  const all = eojeols(query);

  // The request frame is stripped from the END only. A leading `설명해 주세요` is not a thing, and
  // consuming these anywhere would let one hide between the term and its marker.
  let body = all;
  while (body.length > 0 && KOREAN_REQUEST_FRAME.includes(body[body.length - 1])) {
    body = body.slice(0, -1);
  }
  if (body.length === 0) return null;

  const definiendumStem = (eojeol: string): string | null => {
    for (const analysis of analyseNoun(eojeol)) {
      if (analysis.role === "DEFINIENDUM") return analysis.stem;
    }
    for (const suffix of KOREAN_CITATION_SUFFIXES) {
      if (eojeol.endsWith(suffix) && eojeol.length > suffix.length) {
        return eojeol.slice(0, eojeol.length - suffix.length);
      }
    }
    return null;
  };
  // A CITATION SUFFIX PROVES NOTHING ON ITS OWN, IN ANY OF ITS FORMS. Three rounds to accept it.
  //
  // Bare `라는` went first: `-(으)라는` is the adnominal form of a quoted imperative, so
  // `떠나라는 뜻이야?` cited a verb stem. `이라는` was kept on the argument that its 이 is the
  // copula and attaches only to nouns -- and 죽이다, 먹이다, 보이다, 높이다 are causatives whose
  // stems END in 이, so `죽이라는 뜻이야?` cited one too. Then the same for `(이)란`, which was
  // called unaffected because `analyseNoun` checks allomorph conditioning: `가란 뜻이야?` parses as
  // 가 plus 란 and conditioning proves SUFFIX COMPATIBILITY, never nominality. `사란 뜻이야?` --
  // "do you mean BUY?" -- is the same collision in this product's own subject matter.
  //
  // So the test is not the suffix. A cited term GOVERNS something: it is the definiendum of a
  // question about it. That question takes one of two forms, and both are already inventories this
  // grammar owns.
  //
  //     통화스와프란 무슨 제도인지 ...      a definitional interrogative follows
  //     테이퍼링이란 용어의 뜻은?           a metalinguistic head follows, case-marked
  //     가란 뜻이야?                        neither -- 뜻이야 is the copular predicate itself
  //
  // Applied to EVERY citation now, particle-derived included.
  //
  // NAMED COST, one corpus row: `코스피200이란?` is the elliptical dictionary-headword question and
  // governs nothing, so it is refused. Allowing an ungoverned citation would admit `사란?` -- "buy?"
  // -- as a definition of 사, and this unit has already made that trade once, when the head 말 was
  // removed for coercing a PROHIBITED_ADVICE row. Coverage does not buy an advice-shaped admission.
  const citationIsGoverned = (index: number): boolean => {
    const next = body[index + 1];
    if (next === undefined) return false;
    if (KOREAN_WHAT_INTERROGATIVES.some((w) => isMarkedBy(next, w))) return true;
    if (
      !KOREAN_METALINGUISTIC_HEADS.some((h) =>
        isMarkedBy(next, h, KOREAN_MEANING_HEADS.includes(h)),
      )
    ) {
      return false;
    }
    return analyseNoun(next).some(
      (a) => a.role === "TOPIC" || a.role === "NOMINATIVE" || a.role === "GENITIVE",
    );
  };
  // A MARKER IS THE HEAD PLUS GRAMMATICAL MATERIAL, AND NOTHING ELSE.
  //
  // `startsWith` alone was the whole test, and review broke it with
  // `주가가 의미있게 상승하나요?` -- "does the share price rise MEANINGFULLY". 의미있게 is 의미 plus
  // a derivational suffix and an adverbial ending, and it was read as the metalinguistic head 의미.
  // Korean agglutinates, so a head must be allowed its particles and copular endings -- 뜻이죠,
  // 정의가, 무엇을, 뭔지 -- but everything following it has to be grammatical, not lexical. 있게
  // opens with 있, which is a verb stem and not a particle, so the eojeol is a predicate about
  // something rather than a citation of a term.
  const isMarkedBy = (eojeol: string, head: string, verbalisable = false): boolean => {
    if (!eojeol.startsWith(head)) return false;
    // The head may also be VERBALISED. 의미하는 is 의미 plus the light verb 하-, "that means", and
    // `PER이 뭘 의미하는 지표인가요` is a corpus row that needs it -- tightening this test to
    // grammatical syllables lost that row until 하- was allowed. 합 is the same morpheme contracted
    // with the formal ending, which `GDP디플레이터란 무엇을 말합니까` needs. It is the one
    // derivation permitted, because it makes a verb of the SAME noun rather than a different word:
    // 의미있게 opens with 있, a separate stem, and stays out.
    // ONLY A METALINGUISTIC HEAD MAY BE VERBALISED, and letting an interrogative do it was a defect.
    // 뭐하다 is "to do what", so `주가가 뭐하나요?` -- "what is the share price DOING" -- read 뭐하나요
    // as the interrogative 뭐 plus a light verb and became a definition of 주가. 의미하다 and
    // 말하다 make a verb OF the noun; 뭐하다 does not, because 뭐 is a pronoun and there is nothing
    // to verbalise.
    const tail = verbalisable
      ? eojeol.slice(head.length).replace(/^[하합]/, "")
      : eojeol.slice(head.length);
    return [...tail].every((syllable) => KOREAN_GRAMMATICAL_SYLLABLES.includes(syllable));
  };
  const isMarker = (eojeol: string): boolean =>
    KOREAN_WHAT_INTERROGATIVES.some((w) => isMarkedBy(eojeol, w)) ||
    KOREAN_METALINGUISTIC_HEADS.some((h) =>
      isMarkedBy(eojeol, h, KOREAN_MEANING_HEADS.includes(h)),
    );

  // The LEFTMOST marker, so that everything before it is the term and everything after it is
  // predicate. Taking the rightmost would let `X는 무슨 뜻` split at 뜻 and swallow 무슨 into the
  // term.
  let at = body.findIndex((eojeol) => isMarker(eojeol) || definiendumStem(eojeol) !== null);
  if (at === -1) return null;

  // AN INTERROGATIVE DETERMINER BELONGS TO THE MARKER, NOT TO THE TERM. `어떤 개념인지` is "what
  // kind of concept", and without absorbing 어떤 the term region would end with it and the subject
  // would read `신용스프레드가 어떤`. It also does the work of separating two requests that are
  // otherwise identical in shape -- see the copular-predicate rule further down.
  const determined = at > 0 && KOREAN_INTERROGATIVE_DETERMINERS.includes(body[at - 1]);
  const headAt = at;
  if (determined) at -= 1;

  // A cited term carries its marker on itself -- `양적완화란`, `X라는` -- so it belongs to the term
  // region rather than ending it. Everything after it must still be metalinguistic, which is what
  // separates `테이퍼링이란 용어의 뜻은?` from `양적완화란 어떻게 시작됐나요?`.
  let cited = definiendumStem(body[at]);
  if (cited !== null && !citationIsGoverned(at)) cited = null;
  // The marker index may already have stepped back over an absorbed determiner, so this asks about
  // the HEAD. Reached when a raw-suffix citation is rejected above and nothing else marked the
  // eojeol -- `findIndex` accepted it on the citation alone.
  if (cited === null && !isMarker(body[headAt])) return null;
  // NOTHING MARKED MAY STAND IN FRONT OF A CITED TERM. `주가가 100이라는 의미인가요?` -- "does it
  // mean the share price is 100" -- made a whole proposition the definiendum with a nominative
  // subject sitting in front of it.
  //
  // Requiring the citation to open the request was the first attempt and it was too strict: it
  // refused `기술적 반등이라는 표현은 무슨 뜻이야`, where 기술적 is an ordinary adnominal modifier
  // of 반등 and the whole compound is the cited term. What is wrong in the first is the CASE, not
  // the position -- 주가가 is a subject, and a citation does not take one.
  if (
    cited !== null &&
    body
      .slice(0, at)
      .some((eojeol) => analyseNoun(eojeol).some((a) => a.role !== null && a.role !== "GENITIVE"))
  ) {
    return null;
  }
  const term = cited === null ? body.slice(0, at) : [...body.slice(0, at), cited];
  if (cited !== null) {
    at += 1;
    if (at < body.length && !body.slice(at).some(isMarker)) return null;
  }
  if (term.length === 0) return null;

  // A COMPLEMENT IS NOT PART OF THE TERM, and neither is a currentness adverb. Same discriminator as
  // the English side, and it refuses the same shapes.
  const region = term.join(" ");
  if (KOREAN_COMPLEMENT_MARKERS.some((m) => region.includes(m))) return null;
  // A METALINGUISTIC HEAD LICENSES EXACTLY ONE EOJEOL OF TERM, which is that path's version of the
  // two-eojeol proof the interrogative path borrows from `koreanCopularMatch`.
  //
  // Review produced `오늘 주가 하락의 의미가 무엇인가요?` -- "what is the significance of TODAY's
  // share price fall" -- a question about a current event, admitted because a metalinguistic head
  // let the term run to three eojeol and nothing morphological separates 오늘 주가 하락 from
  // 장단기 금리 역전. It also produced `기준금리은 수준이 무슨 뜻인가요?`, where an ill-formed 은
  // sits on a non-final eojeol. I had declared both unfixable without a lexicon; review answered
  // with the rule below, and it is right. The cost is named and it is one corpus row:
  // `채권 듀레이션 개념 알려주세요` is refused, because its term is two eojeol.
  const metalinguisticMarker =
    !KOREAN_WHAT_INTERROGATIVES.some((w) => isMarkedBy(body[headAt], w)) &&
    KOREAN_METALINGUISTIC_HEADS.some((h) =>
      isMarkedBy(body[headAt], h, KOREAN_MEANING_HEADS.includes(h)),
    );
  if (metalinguisticMarker && term.length > 1) return null;

  // A HEAD USED AS THE COPULAR PREDICATE IS NOT CITING ANYTHING. `주가가 개념인가요?` asks whether
  // the share price IS a concept; `경상수지의 정의가 ...` asks for the definition OF the current
  // account. The difference is the case on the term: a genitive or a bare compound modifier gives
  // "the HEAD of X", a topic or nominative gives "X IS a HEAD".
  //
  // The exception is an interrogative determiner, which turns the predicate back into a question
  // about the term -- `신용스프레드가 어떤 개념인지` is "what kind of concept IS the credit
  // spread", and that is a definitional request. It is a corpus row, and this is why 어떤 is
  // absorbed above rather than refused.
  if (metalinguisticMarker && !determined) {
    const subjectCased = analyseNoun(term[term.length - 1]).some(
      (a) => a.role === "TOPIC" || a.role === "NOMINATIVE",
    );
    if (subjectCased) return null;
  }

  // A DECLINED MARKER ANYWHERE IN THE TERM, not only on its last eojeol. `기준금리은 수준이 무슨
  // 뜻인가요?` hides the ill-formed 은 in front of a validly marked 수준이.
  //
  // This is the check I argued was impossible, and the argument was half right. A naive scan does
  // refuse 물가 and 소비자물가 -- 물 and 소비자물 are consonant-final, so their 가 is declined by
  // its own conditioning. What makes it safe here is POSITION: the FINAL eojeol is exempt, because
  // that is where a lexical 가 actually lands, and only the modifiers in front of it are checked.
  // The residue is a compound modifier ending in a declined particle shape -- `소비자물가 상승률이
  // 무슨 뜻인가요?` is refused -- which is the safe direction and is named rather than absorbed.
  const declinedInModifier = term
    .slice(0, -1)
    .some((eojeol) =>
      PARTICLE_SURFACES.some(
        (surface) =>
          eojeol.endsWith(surface) &&
          eojeol.length > surface.length &&
          !analyseNoun(eojeol).some((a) => a.role !== null),
      ),
    );
  if (declinedInModifier) return null;

  // A COORDINATED PAIR IS NOT ONE TERM, and this is checked at the eojeol boundary rather than by
  // substring -- see `KOREAN_COORDINATOR_ENDINGS` for why the difference is a corpus row.
  if (term.some((eojeol) => KOREAN_COORDINATOR_ENDINGS.some((c) => eojeol.endsWith(c)))) {
    return null;
  }
  if (term.some((eojeol) => KOREAN_COORDINATOR_WORDS.includes(eojeol))) return null;

  // EXACTLY ONE MARKED NOMINAL in the term region, and the corpus produced this rule the same way
  // the English preposition rule was produced -- by coercing a row that is not a definition:
  //
  //     미국 고용지표가 연준 통화정책에 미치는 영향은 무엇인가요
  //     "what is the effect OF US employment data ON Fed policy"
  //
  // It ends in 무엇인가요 and is a relation between two subjects, which is STORED_MECHANISM. Its
  // shape is 고용지표가 (nominative) ... 영향은 (topic): two overtly marked nominals, which is a
  // clause and not a term. `장단기 금리 역전이` has one, and a compound noun spanning three eojeol
  // still has one, so this separates constituency from length without counting words.
  const markedInTerm = term.filter((eojeol) =>
    analyseNoun(eojeol).some((a) => a.role !== null && a.role !== "GENITIVE" && a.stem.length > 0),
  );
  if (markedInTerm.length > 1) return null;

  // WHERE THIS REDUCES TO THE TWO-EOJEOL CONSTRUCTION, IT MUST SATISFY THAT CONSTRUCTION'S PROOF.
  //
  // Review found `내일 주가가 뭐야?` -- "what is TOMORROW's share price" -- authorized as a
  // definition of `내일 주가`. The obvious repair is to add 내일 to a list of temporal adverbs, and
  // it is the wrong one twice over. `koreanCopularMatch` already refused to enumerate that class
  // because 현재, 최근, 지금, 오늘, 현시점 has no end; and no lexicon-free rule tells 내일 주가 from
  // 장단기 금리, where an unmarked eojeol before a marked one is a temporal adjunct in the first
  // and part of a compound in the second, with identical morphology.
  //
  // So the proof is borrowed instead of the list extended. When the marker is a BARE copular
  // interrogative in final position the request IS `koreanCopularMatch`'s construction, and that
  // grammar demands exactly two eojeol precisely so nothing can hide in front of the subject. A
  // longer term is admitted only where something FURTHER supplies the evidence: a metalinguistic
  // head, or a predicate that continues past the interrogative.
  const finalBareInterrogative =
    at === body.length - 1 && KOREAN_WHAT_INTERROGATIVES.some((w) => body[at].startsWith(w));
  if (finalBareInterrogative && term.length > 1) return null;

  // AFTER the marker, only predicate. `CPI가 뭔지 설명해주고 최신 미국 CPI 수치도 알려주세요` and
  // `ETF 정의랑 리츠 정의 둘 다 설명해줘` are both corpus rows the grammar must REFUSE as two
  // operations, and both slipped through a rule that only looked for a second case-marked subject:
  // the second question's subject is 수치도 in one and a bare 리츠 in the other.
  //
  // AFTER THE MARKER, ONLY A COPULAR PREDICATE. `CPI가 뭔지 설명해주고 최신 미국 CPI 수치도
  // 알려주세요` and `ETF 정의랑 리츠 정의 둘 다 설명해줘` are corpus rows the grammar must REFUSE as
  // two operations, and both slipped past a rule that looked only for a second case-marked subject.
  //
  // "Ends like a question" was the first replacement and it was too weak: review found
  // `주가가 의미가 있나요?` -- "IS the share price meaningful" -- recognised as a definition of
  // 주가, because 있나요 ends in 요. The request has to ask what the term IS, so the predicate must
  // carry the COPULA 이/인, and an existential or an ordinary verb does not. That also keeps out
  // the connective endings 고 and 며, which is what joins a second clause: 설명해주고 is
  // "explain, and".
  //
  // Failing here REFUSES, which is why a list is tolerable in this position at all.
  for (const eojeol of body.slice(at + (cited === null ? 1 : 0))) {
    if (isMarker(eojeol)) continue;
    if (!KOREAN_COPULAR_ENDINGS.some((e) => eojeol.endsWith(e))) return null;
  }

  // The term must END in evidence that it IS a noun phrase.
  //
  // An overt case marker is that evidence, and requiring one is the invariant `koreanCopularMatch`
  // paid for: without it, exactly two eojeol promoted a negator to a subject. The one alternative
  // allowed here is a bare metalinguistic HEAD taking the term as its modifier -- `채권 듀레이션
  // 개념` -- because Korean noun-noun compounding cannot contain a verb, so the head is itself the
  // proof that what precedes it is nominal.
  const last = term[term.length - 1];
  const roled = analyseNoun(last).find(
    (a) =>
      a.role === "TOPIC" ||
      a.role === "NOMINATIVE" ||
      a.role === "GENITIVE" ||
      a.role === "DEFINIENDUM",
  );
  // A DECLINED MARKER IS NOT AN ABSENT ONE, and the compound exception was letting one through.
  //
  // `기준금리은 뜻이 뭐야?` writes 은 after a vowel-final syllable, which is not a topic particle at
  // all, so `analyseNoun` refuses that split -- and the exception then admitted the whole unsplit
  // token as a compound modifier, because 뜻이 follows it. That is the second instance of the same
  // failure the possessive guard below fixed: evidence that was PRESENT and DECLINED falling
  // through to a weaker reading. The exception is for a term that carries NO marker, not for one
  // whose marker is ill-formed, so an ending that even looks like a particle disqualifies it.
  const particleShaped = PARTICLE_SURFACES.some(
    (surface) => last.endsWith(surface) && last.length > surface.length,
  );
  const compounded =
    cited === null &&
    !particleShaped &&
    KOREAN_METALINGUISTIC_HEADS.some((h) =>
      isMarkedBy(body[at], h, KOREAN_MEANING_HEADS.includes(h)),
    );
  // A CITED term needs no case marker of its own, and the REASON is not the one this comment used
  // to give. It said `(이)라는 IS the evidence`, which later rounds refuted: 죽이라는 and 가란 are
  // quoted imperatives, and no citation suffix proves nominality by itself.
  //
  // What licenses the waiver is `citationIsGoverned`, checked far above -- the citation must govern
  // a definitional interrogative or a case-marked metalinguistic head, and only a citation that
  // passed THAT reaches this line. So `죽이라는 표현은 무슨 뜻인가요?` is accepted on the strength
  // of 표현은, not of 라는, and `죽이라는 뜻이야?` never gets here. Requiring a second marker on the
  // stem as well would refuse `테이퍼링이라는 표현은 무슨 뜻인가요?`, which is how this waiver
  // arrived in the first place.
  if (roled === undefined && !compounded && cited === null) return null;

  const stem = roled === undefined ? last : roled.stem;
  if (stem.length === 0) return null;

  // A FIRST-PERSON POSSESSIVE SUBJECT, refused here for the same reason `koreanCopularMatch` refuses
  // it -- and this was a REGRESSION the suite caught, not a precaution.
  //
  // `제포트폴리오는 무엇인가요?` is "what is MY portfolio", a request about the speaker's holdings.
  // `koreanCopularMatch` drops that analysis, dropping it leaves `readings` empty, and an empty
  // `readings` is exactly the condition that invites this recogniser in. So the older grammar
  // declined the evidence and the newer one picked the request up anyway -- the precise failure that
  // "evidence which was present and declined never falls through to a weaker reading" exists to
  // prevent. A last-resort recogniser inherits every guard of the recognisers standing before it.
  if (KOREAN_POSSESSIVE_DETERMINERS.some((d) => stem.startsWith(d) && stem !== d)) return null;

  const subject = [...term.slice(0, -1), stem].join(" ");
  return {
    operation: "DEFINITION",
    subjectRegion: ` ${subject} `,
    residue: [],
    // One marked nominal, and this grammar cannot prove what is inside it -- the same claim
    // `koreanCopularMatch` makes, and for the reason its `internalConjunction` note gives.
    subjectIdentity: "WHOLE_REGION",
  };
}

/**
 * A definitional request: one term, asked about as a term, with no other operation's operand.
 *
 * MARKET-DEFINITION-GRAMMAR-001. `CONSTRUCTIONS` carried four DEFINITION rows -- ` definition of `,
 * ` what is a `, ` what is an `, ` what does … mean ` -- and the corpus shows what that costs: of 60
 * definitional requests it recognises 9. `What is real GDP?` fails on the missing article alone,
 * which is not a distinction anybody asking the question is making.
 *
 * The family is not nine phrases to memorise. What these requests share is structural: they name
 * exactly ONE term and carry NO operand belonging to any other operation -- no interval, no source
 * constituent, no relation between two subjects, no currentness marker. That is the definition of
 * DEFINITION in this product's own contract table, and it is what is checked here.
 *
 * ## Why this is a LAST-RESORT recogniser
 *
 * `recogniseSpanUncached` collects every reading and refuses when two disagree, so a rule that also
 * fired on `What is the current CPI?` would not steal that request -- it would make it AMBIGUOUS
 * and break it. This runs only when nothing else recognised the span, which gets the precedence
 * right by construction rather than by ordering a list carefully: every other operation wins, and
 * definitional recognition picks up only what would otherwise have been UNSUPPORTED.
 *
 * ## Why it still needs a positive frame
 *
 * Residual recognition -- "one term, no operands, therefore a definition" -- was considered and
 * rejected against the corpus's own negative controls. `Summarise today's market news.` and
 * `Rank all the world's economies by GDP.` name one thing and carry no operand either, and turning
 * those into DEFINITION would be exactly the silent coercion this unit is required to prevent. So a
 * definitional frame must be POSITIVELY present; absence of operands narrows, it does not decide.
 */
function definitionalMatch(normalized: string, raw: string): Recognised | null {
  // Shape 1: a METALINGUISTICALLY MARKED term. `What is meant by X?`, `What is the meaning of X?`
  //
  // This began as the bare wh-copular -- `what is X` for any X, generalising the two rows that
  // required an article -- and four review rounds killed it. The generalisation admitted
  // `What is exposure via derivatives?`, `What is EBITDA modulo capex?`,
  // `What is protection without collateral?` and one more each time I extended a list. The problem
  // was never the missing words: an unconstrained X can only be filtered by enumerating what it may
  // NOT contain, every miss ADMITS a non-definition, and that is the unfinishable denylist this
  // repository has abandoned twice before.
  //
  // Positive marking inverts the failure direction. A request must SAY it is asking about a term,
  // and an unmarked one is UNSUPPORTED rather than guessed at. The cost is real and named:
  // `What is real GDP?` and `What is the Herfindahl-Hirschman Index?` are not recognised. Neither
  // was recognised before this unit either -- the previous family was four literals -- so this is a
  // smaller claim, not a regression.
  for (const head of METALINGUISTIC_HEADS) {
    const marker = ` ${head} `;
    const at = normalized.indexOf(marker);
    if (at === -1) continue;
    const term = normalized.slice(at + marker.length - 1);
    // THE CLAUSE MUST BE WH-COPULAR, and testing for "a form of `do` somewhere earlier" was not
    // that. Review found `How does the MEANING OF inflation change?` recognised as a definition of
    // `inflation change`: the head governed a complement, as now required, and the copula test was
    // satisfied by the `does` of `how does`. That request asks how a meaning CHANGES.
    //
    // So the frame is checked as a frame. `what` opens it, a copula follows, and only determiners
    // may stand between that and the head. `how does` is not this frame -- it is shape 2's, and
    // shape 2 has its own predicate and its own empty-tail rule.
    const prefix = normalizedTokens(normalized.slice(0, at + 1));
    if (prefix.length < 2 || prefix[0] !== "what") continue;
    if (prefix[1] !== "is" && prefix[1] !== "are" && prefix[1] !== "s") continue;
    if (!prefix.slice(2).every((token) => token === "the" || token === "a" || token === "an")) {
      continue;
    }
    // AND IT MUST TAKE A COMPLEMENT. Review found `How does the concept drift?` recognised as a
    // definition of `drift`: the copula test was satisfied by the `does` of `how does`, and the
    // bare head then took the rest of the clause as its term. A metalinguistic noun CITES a term
    // only when it governs one -- `the meaning OF x`, `meant BY x` -- and standing bare it is an
    // ordinary noun in a sentence about something else. The complement was optional and is now
    // required, which costs nothing measurable: the two corpus rows this shape recognises are
    // `What is meant BY 'basis risk'?` and `What is the meaning OF 'carry trade'?`.
    //
    // `behind` WAS in this set and is removed: `the meaning OF x` and `meant BY x` cite x as a
    // term, while `the meaning BEHIND x` asks the rationale of an event and cites nothing.
    //
    // AND THAT REMOVAL DID NOT CLOSE THE CLASS, which the next round said plainly.
    // `What is the meaning OF the Fed raising rates?` is the same request with a preposition that
    // survived, because `meaning of` governs event clauses as readily as terms and
    // `isSingleTermRegion` proves only the absence of other operations' operands -- never that a
    // region is a noun phrase. Deleting `behind` had patched one instance of an open class, which
    // is the exact mistake this unit spent five rounds learning not to make.
    //
    // QUOTATION IS THE PROOF, and it is the only one available here. Mentioning a term rather than
    // using it is marked in writing by quoting it, so a speaker who writes `the meaning of 'carry
    // trade'` has SAID that the complement is a term, where `the meaning of the Fed raising rates`
    // has not. No lexicon, no part-of-speech guess, and no list.
    //
    // Both corpus rows this shape recognises are quoted, and they are the only two the corpus has,
    // so the measured cost is zero. The unmeasured cost is real and named: an unquoted
    // `What is the meaning of carry trade?` is refused. That is the safe direction, and closing it
    // needs the noun-phrase proof this grammar does not have.
    const complement = /^\s(of|by)\s+/.exec(term);
    if (complement === null) continue;
    const stripped = ` ${term.slice(complement[0].length)}`;
    if (!quotedIn(raw, stripped)) continue;
    if (!isSingleTermRegion(` ${stripped.trim()} `, raw)) continue;
    return {
      operation: "DEFINITION",
      subjectRegion: ` ${stripped.trim()} `,
      residue: [],
      subjectIdentity: "OCCURRENCE",
    };
  }

  // Shape 2: how a single named thing WORKS. `How does X work?`, `How do X work?`,
  // `How does X operate?`. The corpus reaches this construction six times and it is the same
  // question as shape 1 asked from the other side -- what a term IS, phrased as what it DOES.
  //
  // Cardinality is the whole discriminator here, and it is why this is safe next to
  // STORED_MECHANISM. `How does A affect B?` names two subjects joined by a relation construction,
  // so `mechanismMatch` recognises it and this never runs; `How does X work?` names one and no
  // relation, so there is nothing for a mechanism to be between. Intransitive predicate, one term.
  // ` how is ` IS NOT ONE OF THESE, and including it was a real defect. `How is remote work?`
  // authorized as a definition of `remote`, because the rule found `work` in final position and
  // read it as the predicate -- where it is the head NOUN of the subject, and the request asks
  // about the state of remote work. `How is X work?` is not English; only `does` and `do` take a
  // bare infinitive here, and that is exactly what makes `work` a verb in the other two.
  for (const opener of [" how does ", " how do "]) {
    const at = normalized.indexOf(opener);
    if (at !== 0) continue;
    const rest = normalized.slice(opener.length - 1);
    // MATCHED AT A WORD BOUNDARY. `How does a network?` was a definition of `a net`, because
    // `network ` contains `work ` and the predicate was found by substring. Every region here is
    // space-padded, so requiring the leading space is the whole fix -- and it is the same class of
    // error as the Korean request frame matched by prefix, found two rounds earlier in this unit.
    const closer = INTRANSITIVE_PREDICATES.find((p) => rest.includes(delimited(p)));
    if (closer === undefined) continue;
    const boundary = rest.indexOf(delimited(closer));
    const term = ` ${rest.slice(0, boundary).trim()} `;
    // THE TAIL MUST BE EMPTY, and reaching that took one review round more than it should have.
    //
    // `How does the unemployment rate work WITH INFLATION?` is a negative control -- two terms and
    // no construction saying which acts on which -- and taking the subject before `work` while
    // discarding the rest turned a refusal into an AUTHORIZED definition of the first one. The
    // first fix tested the tail with the SAME single-term rule as the head, which reads as thorough
    // and is not: it inherited that rule's preposition list, and review produced
    // `How does a stop-loss order work AMID a market crash?`, admitted because `amid` was missing.
    //
    // Requiring the tail to be EMPTY needs no list at all. `How does X work?` is the construction;
    // anything after the predicate restricts the question to a circumstance, and nothing has to
    // decide which circumstances are harmless. The cost is what it already was --
    // `How does yield curve control operate IN GENERAL TERMS?` is refused -- and the rule is now
    // closed instead of sampled.
    const tail = rest.slice(boundary + delimited(closer).length - 1);
    if (normalizedTokens(tail).length > 0) continue;
    if (!isSingleTermRegion(term, raw)) continue;
    return {
      operation: "DEFINITION",
      subjectRegion: term,
      residue: [],
      subjectIdentity: "OCCURRENCE",
    };
  }
  return null;
}

/**
 * Predicates that describe a thing on its own, taking no object.
 *
 * `work`, `operate` and their inflections say what something does BY ITSELF. That is what separates
 * this from a relation: `affects`, `drives`, `influences` all need something on the far side, and a
 * request carrying one of those is recognised as a mechanism before this rule is ever consulted.
 * An intransitive predicate with one named subject is a request to explain that subject.
 */
const INTRANSITIVE_PREDICATES = ["work", "works", "operate", "operates", "function", "functions"];

/**
 * Was this region QUOTED in the request as written?
 *
 * The mention/use distinction, which is the only lexicon-free evidence that a complement is a term
 * rather than a clause. `the meaning of 'carry trade'` cites; `the meaning of the Fed raising
 * rates` describes an event.
 *
 * Read from the RAW span, because normalization deletes the quotes. Every quotation form the
 * product is likely to see is accepted -- straight, curly, and the Korean corner brackets -- and a
 * form missing from here REFUSES, which is the safe direction.
 */
function quotedIn(raw: string, region: string): boolean {
  const wanted = normalizedTokens(region).join(" ");
  if (wanted.length === 0) return false;
  for (const [open, close] of QUOTATION_PAIRS) {
    let from = 0;
    for (;;) {
      const start = raw.indexOf(open, from);
      if (start === -1) break;
      const end = raw.indexOf(close, start + open.length);
      if (end === -1) break;
      if (normalizedTokens(raw.slice(start + open.length, end)).join(" ") === wanted) return true;
      from = end + close.length;
    }
  }
  return false;
}

const QUOTATION_PAIRS: readonly (readonly [string, string])[] = [
  ["'", "'"],
  ['"', '"'],
  ["‘", "’"],
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
];

/**
 * A word, delimited, so a substring test finds the WORD and not the letters.
 *
 * `How does a network?` was recognised as a definition of `a net`, because `network ` contains
 * `work `. Every region tested here is space-padded, so the delimiters are just the spaces. It is
 * the same class of error as the Korean request frame matched by prefix, found two rounds earlier
 * in this unit -- a substring test does not find the word.
 *
 * A function rather than three inline template literals, because the mutation harness could not
 * attack it otherwise: with the boundary spelled out at each call site, reverting one of them left
 * the others disagreeing and the request refused for the wrong reason, so the mutant came back
 * MISSED and the repair looked untested. One place to say it, one place to break it.
 */
const delimited = (word: string) => ` ${word} `;

/**
 * Is this region one term being asked about, rather than a clause carrying something else?
 *
 * Structural and inventory-free: no clause connective, no coordinator, no operand of another
 * operation. It cannot ask the repository whether the term exists -- a missing row is evidence about
 * the repository and never evidence about what the request meant.
 */
function isSingleTermRegion(region: string, raw?: string): boolean {
  const tokens = normalizedTokens(region);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => CLAUSE_CONNECTIVES.includes(token))) return false;
  if (tokens.some((token) => OBJECT_COORDINATORS.includes(token))) return false;
  // A PRONOUN IS NOT A TERM. `How does he work?` asks how a person performs their work, and it was
  // authorized as a definition of `he` because shape 2 accepted any single token before the
  // predicate and nothing established the subject was a NAMED thing.
  //
  // Pronouns are a closed function-word class in the same sense the prepositions are, and unlike
  // that list this one has no financial vocabulary shading into it -- there is no term that is a
  // pronoun, so refusing the whole class costs nothing and needs no judgement about members.
  if (tokens.some((token) => PRONOUNS.has(token))) return false;
  // A CALCULATION IS NOT A TERM, and this has to be checked on the RAW text as well as the tokens.
  //
  // Review found `What is EBITDA minus capex?` becoming a definition, I added a five-word list, and
  // the class stayed open: normalization strips punctuation, so `EBITDA - capex` and
  // `EBITDA / revenue` reach here as two bare nouns indistinguishable from `real GDP`. The symbols
  // have to be read before they are destroyed.
  //
  // Symbolic operators ARE a closed class and are treated as one. A list of the WORD forms stood
  // beside them and is DELETED: `less` and `multiplied` were missing from the first attempt,
  // `modulo` and `subtract` from the second, `mod` from the third, and each round the list was
  // patched instead of abandoned. Five rounds is enough evidence that it has no last member.
  //
  // What is left is stated exactly rather than approximated. `How does EBITDA mod capex work?` is
  // recognised as a definitional request about a term named "EBITDA mod capex". That is a bounded
  // residue and not the one earlier rounds had: no other operation owns that request, no corpus
  // control expects it refused, the operation is deterministic with no planner, and the repository
  // has no such term, so it resolves to nothing. Rounds 1-4 admitted requests that BELONGED to
  // CURRENT_OBSERVATION and ATTRIBUTED_REPORTED_OBSERVATION and broke negative controls; this does
  // neither. Pinned executable in the tests so it stays visible.
  if (raw !== undefined && ARITHMETIC_SYMBOLS.test(raw)) return false;
  // An interval belongs to OBSERVED_CHANGE and a currentness marker to CURRENT_OBSERVATION. Either
  // one means the request was not asking what a term means.
  if (intervalConstituent(region) !== null) return false;

  // A NOUN PHRASE WITH A PREPOSITIONAL COMPLEMENT IS NOT A TERM.
  //
  // This is the discriminator, and the corpus is what produced it. Generalising `what is a X` to
  // `what is X` immediately coerced seven rows that are not definitions -- including four negative
  // controls, which then AUTHORIZED:
  //
  //     What's the going level of the VIX?                  a current observation
  //     What is the stored effect of drought on wheat?      a relation
  //     What is the published view on Brent crude?          an attribution, corpus says REFUSE
  //     What is the mechanism for the policy rate?          under-specified, corpus says REFUSE
  //     What is the weather in Seoul tomorrow?              not this product's subject at all
  //
  // Every one has the same shape: a head noun taking a prepositional complement. `the level OF x`
  // asks about a property of x; `real GDP` IS x. So a complement containing a preposition means the
  // request is about something the term has, not about the term.
  //
  // The exception is metalinguistic: `the meaning of x`, `meant by x`, `the definition of x`. Those
  // heads are words that talk about words, which is precisely a definitional request, and they are a
  // closed class rather than an open list of phrasings.
  const head =
    tokens[0] === "the" || tokens[0] === "a" || tokens[0] === "an" ? tokens[1] : tokens[0];
  const metalinguistic = head !== undefined && METALINGUISTIC_HEADS.has(head);
  if (!metalinguistic && tokens.some((token) => TERM_COMPLEMENT_PREPOSITIONS.has(token))) {
    return false;
  }
  return true;
}

/**
 * Heads that talk about WORDS rather than about the world.
 *
 * `말` -- "word", "speech" -- was ADDED here and REMOVED again in the same round, and the reason
 * is worth keeping. The copular tightening lost `GDP디플레이터란 무엇을 말합니까`, where 말하다
 * means "to say", and adding the head recovered it. It also coerced `달러 예금 지금 들까요 말까요`
 * -- "should I open a dollar deposit or NOT" -- a corpus row expecting PROHIBITED_ADVICE, because
 * 말까요 is the prohibitive auxiliary 말다 and the two are homographs.
 *
 * Nothing morphological separates them, the lost row is one, and the admitted row is a personalized
 * advice request. `docs/LEGAL_GUARDRAILS.md` decides that trade before coverage does. The whole
 * design of this unit is that a marker must be UNAMBIGUOUSLY metalinguistic, and 말 is not.
 *
 * These are the nouns and participles a speaker uses to cite a term AS a term, and they are the only
 * heads permitted a prepositional complement while still being a definitional request: `the meaning
 * of X` asks what X means, `the level of X` asks what X is currently at.
 *
 * NOT A CLOSED CLASS, and an earlier version of this comment claimed it was. Review named
 * `interpretation`, `explanation`, `significance` and `usage` as members it omits, and it is right —
 * this is a semantic inventory, so it will need feeding as constructions appear. What limits the
 * damage is the direction of the failure: a missing head means a definitional request is REFUSED,
 * never that something else is admitted.
 */
const METALINGUISTIC_HEADS = new Set(["meaning", "definition", "meant", "sense", "concept"]);

/**
 * Pronouns, which stand in for a thing instead of naming one.
 *
 * A term is a NAME. `How does he work?` is a question about a person, not a definitional request,
 * and it was authorized as a definition of `he`.
 *
 * THE INDEFINITES ARE GENERATED, NOT LISTED, and that is the fourth time in this unit that writing
 * out "the class" from memory produced a subset. I listed `nobody` and omitted `everybody`, and
 * review answered `How does everybody work?` -- after the same thing happened twice with the
 * prepositions. English indefinite pronouns are COMPOSITIONAL: a determiner morpheme crossed with
 * a head morpheme, and the cross product is the class. Enumerating a cross product by hand when
 * the two axes are three and four items long is how the omission happens, so the code does the
 * crossing.
 *
 * The personal and demonstrative pronouns below are small, genuinely fixed paradigms and are
 * written out. Nothing in financial vocabulary shades into any of this, so refusing the whole
 * class costs nothing and needs no judgement about members.
 */
const INDEFINITE_DETERMINERS = ["some", "any", "every", "no"];
const INDEFINITE_HEADS = ["one", "body", "thing", "where"];

const PRONOUNS = new Set([
  "i",
  "me",
  "my",
  "mine",
  "myself",
  "we",
  "us",
  "our",
  "ours",
  "ourselves",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
  "this",
  "that",
  "these",
  "those",
  "who",
  "whom",
  "whose",
  "which",
  "what",
  "one",
  "none",
  "each",
  "either",
  "neither",
  "both",
  "few",
  "many",
  "several",
  "all",
  ...INDEFINITE_DETERMINERS.flatMap((d) => INDEFINITE_HEADS.map((h) => `${d}${h}`)),
]);

/**
 * Prepositions that give a head noun its own complement.
 *
 * Their presence says the request is about a relation or property the term participates in, which
 * belongs to another operation.
 *
 * A CLOSED CLASS, AND THIS IS STILL NOT PROVABLY ALL OF IT. Both halves of that sentence are the
 * result of review, and the second half is the one I keep getting wrong.
 *
 * English prepositions ARE a closed function-word class, fixed by the grammar and not by usage, in
 * the sense `koreanMorphology`'s particle inventory is closed — so unlike `minus`/`modulo`/`mod`
 * this one HAS a last member, and it is the reason the arithmetic list was deleted while this one
 * was kept.
 *
 * SIX ROUNDS OF PATCHING IT ONE WORD AT A TIME. Rounds 2-5 added `at`, `per`, `via`, `without`,
 * `within`, `among`, `amid`. Round 5 declared it complete on the strength of the closed-class
 * argument, having written out the prepositions that came to mind; round 6 answered with `as`.
 * Round 6 then declared it complete again, from a reference this time; round 7 answered with `qua`.
 *
 * So the claim is retired rather than made a fourth time. A closed class is FINISHABLE; that a
 * particular transcription of it is FINISHED is a separate assertion, and nothing here establishes
 * it. An omission ADMITS, and what it admits is bounded to the residue class `isSingleTermRegion`
 * describes — a term-shaped subject no operation owns and the repository cannot resolve — because
 * every path reaching this function is already positively marked as definitional. That bound is
 * the actual safety argument. The list is a refinement on top of it.
 *
 * Arithmetic word forms are the opposite and were treated the opposite way. `minus`, `less`,
 * `multiplied`, `modulo`, `subtract`, `mod` are ordinary vocabulary with no last member, and no
 * amount of patching produces one.
 *
 * Membership cannot tell a complement from a LEXICALIZED TERM. `return on equity`, `proof of
 * stake` and `cash flow from operations` are single financial terms that happen to contain a
 * preposition, and this refuses all three. That is a real capability gap and it is NOT introduced
 * here: the previous grammar recognised DEFINITION through four literals — ` definition of `,
 * ` what is a `, ` what is an `, ` what does … mean ` — and matched none of them either. This unit
 * does not close it, and separating the two cases needs a term lexicon rather than a longer list.
 */
const TERM_COMPLEMENT_PREPOSITIONS = new Set([
  "of",
  "on",
  "for",
  "from",
  "to",
  "in",
  "about",
  "with",
  "at",
  "by",
  "per",
  "between",
  "through",
  "against",
  "under",
  // The rest of the class. Round five wrote out what it thought was the whole inventory and round
  // six answered with `as`, so this half is the standard list from a reference rather than the ones
  // that came to mind -- including the participial prepositions, which is where the gap was.
  "as",
  "like",
  "till",
  "unto",
  "save",
  "worth",
  "concerning",
  "regarding",
  "respecting",
  "including",
  "excluding",
  "following",
  "barring",
  "pending",
  "notwithstanding",
  "atop",
  "alongside",
  "amidst",
  "anti",
  "circa",
  "minus",
  "plus",
  "sans",
  "qua",
  "vis-a-vis",
  "betwixt",
  "ere",
  "pro",
  "re",
  "thru",
  "above",
  "across",
  "after",
  "along",
  "amid",
  "among",
  "amongst",
  "around",
  "before",
  "behind",
  "below",
  "beneath",
  "beside",
  "besides",
  "between",
  "beyond",
  "despite",
  "down",
  "during",
  "except",
  "inside",
  "into",
  "near",
  "off",
  "onto",
  "opposite",
  "outside",
  "over",
  "past",
  "since",
  "than",
  "throughout",
  "toward",
  "towards",
  "underneath",
  "unlike",
  "until",
  "up",
  "upon",
  "versus",
  "via",
  "within",
  "without",
]);

/**
 * Arithmetic symbols, read from the RAW request because normalization deletes them.
 *
 * FREE-STANDING ONLY, and that qualifier cost a real row before it was added. Matching the bare
 * character refused `What is the Herfindahl-Hirschman Index?` -- a hyphenated proper name is not a
 * subtraction, and reading raw punctuation without asking what it is attached to is the same
 * mistake the retired raw-comma test made. An operator has whitespace around it; a compound name
 * does not.
 *
 * The symbols are a genuinely closed class, unlike the word forms below. The residue is narrow and
 * named: `EBITDA-capex` written without spaces reads as a compound and is admitted.
 */
const ARITHMETIC_SYMBOLS = /(^|\s)[-+*/×÷=](\s|$)/;

/*
 * A list of the WORD forms -- minus, plus, times, over, divided, less, multiplied, versus -- stood
 * here and is DELETED. See `isSingleTermRegion` for what its absence admits and why that residue is
 * a different kind from the one rounds 1-4 found.
 */

function recogniseAll(normalized: string): Recognised[] {
  const found: Recognised[] = [];

  for (const construction of CONSTRUCTIONS) {
    const [opening, closing] = construction.markers;
    // EVERY occurrence, not the first.
    //
    // `indexOf` alone found one match per construction, so two questions built from the SAME
    // construction collapsed into a single reading and the second hid inside the first's subject:
    //
    //     "What is the current Acme? What is the current Beta?"
    //     -> AUTHORIZED, subject "acme what is the current beta"
    //
    // Two DIFFERENT constructions already produced two readings and were caught. The same
    // construction twice produced one and was not -- the same defect, one line further down, and it
    // survived the repair that was written for it.
    const positions: number[] = [];
    for (
      let seen = normalized.indexOf(opening);
      seen !== -1;
      seen = normalized.indexOf(opening, seen + 1)
    ) {
      positions.push(seen);
    }
    for (const at of positions) {
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
  }

  return found;
}

/**
 * A subject region with same-operation construction markers removed, FOR COMPARISON ONLY.
 *
 * Enumerating every occurrence makes two readings out of one legitimate request as well as out of
 * two questions, and the two must be told apart without asking the repository what it holds:
 *
 *     "What is the current current account balance?"   ONE question. Readings differ only by
 *                                                      whether the second ` current ` is inside the
 *                                                      subject; both mean the same subject.
 *     "What is the current Acme? What is the current Beta?"
 *                                                      TWO questions. The readings disagree about
 *                                                      what the subject IS.
 *
 * Stripping the operation's own markers collapses the first pair and leaves the second pair
 * distinct. It is used ONLY as the comparison key: the subject actually served stays the raw region
 * of the first match, because `current account balance` is the stored name and canonicalising it to
 * `account balance` would delete a word the reader wrote.
 */
function canonicalSubjectKey(operation: RequestOperation, subjectRegion: string): string {
  let canonical = ` ${subjectRegion.trim()} `;
  for (const construction of CONSTRUCTIONS) {
    if (construction.operation !== operation) continue;
    const marker = construction.markers[0];
    while (canonical.includes(marker)) canonical = canonical.replace(marker, " ");
  }
  return canonical.trim().split(/\s+/).filter(Boolean).join(" ");
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
/**
 * Does either endpoint of a relation clause name more than one thing?
 *
 * STORED_MECHANISM is the only operation whose contract declares `subjectCardinality: 2`. That is a
 * claim about the REQUEST -- exactly one cause and exactly one effect -- and a coordinator or
 * comparator inside an endpoint region contradicts it. Refusing is the only honest answer, because
 * publishing `A -> B` while dropping `C` answers a question nobody asked.
 *
 * RETIRED: the raw comma test. It read the comma from the unnormalized query, because by the time
 * a region exists `Beta, Gamma` and `Beta Gamma` are the same string -- and it therefore refused
 * every relation naming a comma-bearing entity, `Alpha, Inc.` included. That was pinned as an open
 * availability defect for as long as nothing else could refuse `Beta, Gamma`.
 *
 * Something else can now. The endpoint roles are covered against stored identities in `askMarket`,
 * where `beta gamma` names `Beta` and then says more, and residue refuses. The comma was never the
 * evidence; it was a proxy for "this role says more than one thing", and the repository can answer
 * that question directly where the comma could only guess at it from punctuation.
 *
 * The refusal stays independent of inventory in the sense the pinned test demands: a KNOWN second
 * object and a COINED one both leave residue on the effect role, so both refuse identically. What
 * inventory changes is whether the request is a role-authority failure or an ordinary gap, and
 * those are different answers that deserve different statuses.
 *
 * CORRECTED: an earlier version of this called the placement "principled rather than fitted"
 * because STORED_MECHANISM is the only `subjectCardinality: 2` contract. Review pointed out that
 * the helper is invoked only from `mechanismMatch` and reads no contract, so a future
 * cardinality-2 operation gets no protection unless its author remembers this function. The
 * placement is currently correct and is NOT contract-driven.
 *
 * Cardinality-1 operations are deliberately NOT covered. Their subject is one region and a comma
 * inside it belongs to the name -- `What is the current Smith, Jones revenue?` is one issuer, and
 * that control is pinned.
 */
function relationEndpointNamesTwoThings(query: string, cause: string, effect: string): boolean {
  const tokens = [...normalizedTokens(normalize(cause)), ...normalizedTokens(normalize(effect))];
  return tokens.some((token) => OBJECT_COORDINATORS.includes(token));
}

function mechanismMatch(query: string): Recognised | null {
  const syntax = relationSyntax(query);
  // AFFIRMED as well as ONE. A denial is a recognised relation clause and not a request for the
  // relation — IR-106 established that the repository stores evidence relations exist and none
  // that one does not, so "how A does not affect B" is unanswerable rather than a mechanism ask.
  if (syntax.status !== "ONE" || syntax.clause.polarity !== "AFFIRMED") return null;
  // ESC-015 items 3 and 6: unconsumed second-object residue fails closed, and it must do so
  // whether or not the repository has ever heard of the second object.
  if (relationEndpointNamesTwoThings(query, syntax.clause.cause, syntax.clause.effect)) return null;
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
  // One span cache for exactly this request. Both boundaries below enumerate the same intervals,
  // and without sharing they parse every one of them twice over -- see `spanCache`. Re-entrancy is
  // checked rather than assumed: only the outermost call owns the cache, so a nested call cannot
  // clear it out from under its caller.
  const outermost = spanCache === null;
  if (outermost) spanCache = new Map();
  try {
    return resolveWithSharedSpans(query);
  } finally {
    if (outermost) spanCache = null;
  }
}

function resolveWithSharedSpans(query: string): RequestAuthority {
  // Recognition runs for EVERY request, including a prohibited one, and this is the only ordering
  // change: the screen used to return before recognition had happened, so a redirected request
  // carried no idea what — if anything — it had also asked for. `askMarket` filled that gap with a
  // wide search over the raw string, which is how a redirect came to publish records the neutral
  // form refuses.
  //
  // Precedence is unchanged and still absolute. The screen decides the STATUS; recognition only
  // supplies what the redirect is allowed to publish. Recognition is pure and consults no
  // repository, so running it first costs nothing and decides nothing.
  const recognised = recogniseOperation(query);
  if (detectPersonalizedAdviceRequest(query)) {
    // ESC-015 item 4: PROHIBITED DOMINATES THE WHOLE REQUEST, and nothing informational may be
    // materialized alongside it.
    //
    // This used to attach a recognised informational constituent so a redirect could still show
    // figures -- "refusing to advise is not refusing to inform". That contract is withdrawn by
    // decision, and the reason is in the record: every attempt to bound which text belongs to the
    // constituent leaked. The directive itself reached a served SOURCE region at `.`, then at `!`
    // and `;` after the period case was closed, and each repair moved the leak rather than ending
    // it. A payload that cannot be proven clean is not published.
    //
    // The cost is real and is not hidden: `Should I buy X? What is the current X revenue?` now
    // publishes no figures at all. That was a deliberate capability and it is deliberately gone.
    return {
      status: "PROHIBITED",
      detail:
        "The request asks the product to decide, choose or act on the reader's behalf. " +
        "docs/LEGAL_GUARDRAILS.md requires a redirect, and a factual clause alongside it does not " +
        "change that.",
    };
  }
  return recognised;
}

/**
 * CANDIDATE boundaries. Every one of them is a guess, and none is trusted on its own.
 *
 * Two attempts at a trustworthy punctuation set both failed on real inputs, and the second failure
 * is the useful one. `[.?!;]` cut `... Acme Inc. revenue?` after the company suffix. Removing the
 * period fixed that and I wrote that `?`, `!` and `;` "end a sentence and end nothing else" --
 * which review refuted with `Yahoo! Finance` and `Smith; Jones`. There is no punctuation that
 * cannot appear inside a name, so no boundary set can be correct by itself.
 *
 * So the period is back, deliberately, and the set is LIBERAL. Getting the boundaries right is no
 * longer the job of this regex; contiguous runs of fragments are re-joined and re-parsed, which
 * this over-splits.
 */
const CLAUSE_BOUNDARY_CANDIDATE = /(?<=[.?!;])\s+/g;

/** Fail-closed bound on constituent enumeration. See the cost note in the recogniser. */
const MAX_CANDIDATE_FRAGMENTS = 12;

/** Exact substrings between candidate boundaries, as offsets into the original query. */
function candidateFragments(query: string): { start: number; end: number }[] {
  const fragments: { start: number; end: number }[] = [];
  let start = 0;
  for (const match of query.matchAll(CLAUSE_BOUNDARY_CANDIDATE)) {
    fragments.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  fragments.push({ start, end: query.length });
  return fragments.filter((f) => query.slice(f.start, f.end).trim().length > 0);
}

/**
 * Positive recognition, with no prohibited pre-screen of its own.
 *
 * Split out of `resolveRequestAuthority` so that both a permitted request and a redirected one are
 * read by THE SAME pass over THE SAME text. It is deliberately not typed as excluding `PROHIBITED`:
 * the first-person-possessive and personal-pronoun checks below are inside recognition and return
 * it, and pretending otherwise in the signature would be a lie the compiler would then enforce.
 */
/**
 * The closed identity of a reading. Two recognizers seeing the same question is ONE reading.
 *
 * Exhaustive by operation and with no default: a relation keeps cause and effect apart, an
 * attribution keeps source and subject apart, and everything else is identified by its subject.
 * `operation + subjectRegion` was not enough -- it cannot tell `A -> B` from `B -> A`, and it cannot
 * tell two sources reporting one subject apart.
 */
function readingIdentity(r: Recognised): string {
  const key = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).join(" ");
  switch (r.operation) {
    case "STORED_MECHANISM":
      return `STORED_MECHANISM|${key(r.causeRegion)}|${key(r.effectRegion)}`;
    case "ATTRIBUTED_REPORTED_OBSERVATION":
      return `ATTRIBUTED_REPORTED_OBSERVATION|${key(r.sourceRegion)}|${key(r.subjectRegion)}`;
    case "CURRENT_OBSERVATION":
    case "OBSERVED_CHANGE":
    case "DEFINITION":
      return `${r.operation}|${canonicalSubjectKey(r.operation, r.subjectRegion)}`;
  }
}

/**
 * Every reading this grammar can offer for ONE exact span, with NO precedence between recognizers.
 *
 * `mechanism ? [mechanism] : attribution ? [attribution] : korean ? [korean] : recogniseAll(...)`
 * was the shape, and it let one recognizer silence the others -- which is why the readings rule and
 * the all-occurrences fix, both living in the construction branch, never ran for a relation or an
 * attribution request. Each recognizer now offers an opinion and none can suppress another.
 *
 * The span is the EXACT original substring. Recognizers normalize it themselves for parsing and
 * return the same region text they always did, so nothing here rewrites what is served.
 */
type SpanRecognition = { readings: Recognised[]; koreanAmbiguous: string[] | null };

/**
 * One parse per distinct span, for the whole of one request.
 *
 * The cover model made recognition enumerate intervals, and the constituent layer ALREADY enumerated
 * intervals and called recognition on each -- so the two composed. Twelve fragments give 78 runs at
 * the outer level, each re-parsing up to 78 inner spans with four recognizers at every leaf: on the
 * order of thousands of parses for a request somebody could type. The bound existed at each level
 * and not on their product.
 *
 * The fix needs no restructuring of either boundary, because both are asking about THE SAME
 * SUBSTRINGS: every span the constituent layer offers is a run of the same fragmentation, and every
 * sub-span recognition then considers is a run of it too. Keyed by exact span text, the cache
 * collapses the composition to one evaluation per interval -- n(n+1)/2 for n fragments -- and the
 * remaining enumeration is arithmetic over an already-computed table.
 *
 * Lifetime is ONE top-level `resolveRequestAuthority` call. It is not a persistent cache: a request
 * is parsed fresh, and nothing about one request may leak into the reading of another.
 */
let spanCache: Map<string, SpanRecognition> | null = null;

/**
 * Test-only instrumentation for the bound above, counted rather than timed.
 *
 * Wall-clock would make this a flaky performance test that passes on a fast machine while the
 * composition is still quadratic-on-quadratic. The invariant is a COUNT: no interval is offered to
 * the recognizer union twice.
 */
let spanEvaluations = 0;
export function __spanEvaluationsForTest(): number {
  return spanEvaluations;
}
export function __resetSpanEvaluationsForTest(): void {
  spanEvaluations = 0;
}

function recogniseSpan(span: string): SpanRecognition {
  const cached = spanCache?.get(span);
  if (cached) return cached;
  const computed = recogniseSpanUncached(span);
  spanCache?.set(span, computed);
  return computed;
}

function recogniseSpanUncached(span: string): SpanRecognition {
  spanEvaluations += 1;
  const normalized = normalize(span);
  const korean = containsHangul(span) ? koreanCopularMatch(span) : { status: "NONE" as const };
  if (korean.status === "AMBIGUOUS") return { readings: [], koreanAmbiguous: korean.readings };

  const mechanism = mechanismMatch(span);
  const attribution = attributionMatch(normalized);
  const readings = [
    ...(mechanism ? [mechanism] : []),
    ...(attribution ? [attribution] : []),
    ...(korean.status === "ONE" ? [korean.match] : []),
    ...recogniseAll(normalized),
  ];

  // Definitional recognition is LAST RESORT, and deliberately so. Adding it to the list above would
  // make `What is the current CPI?` two readings and therefore AMBIGUOUS; consulted only when
  // nothing else recognised the span, it cannot outrank another operation and cannot create a
  // conflict. See `definitionalMatch`.
  //
  // AND IT CURRENTLY DECIDES NOTHING, which is worth saying rather than leaving to be discovered.
  // A mutant replacing this condition with `true` was ISOLATED while the English shape was a bare
  // wh-copular. Every narrowing round since made it harder to catch, and after the eighth the
  // guard was removed by hand and the whole 500-row corpus re-run: CHANGED 0. The two surviving
  // shapes are narrow enough that nothing they match is matched by another construction.
  //
  // It stays because it enforces precedence by POSITION rather than by a rule someone has to
  // remember, it costs nothing, and it is load-bearing again the moment a shape widens. The mutant
  // is deleted, because a mutant that cannot be isolated is not coverage.
  if (readings.length === 0) {
    const definitional = containsHangul(span)
      ? koreanDefinitionalMatch(span)
      : definitionalMatch(normalized, span);
    if (definitional) readings.push(definitional);
  }

  const seen = new Set<string>();
  const distinct: Recognised[] = [];
  for (const reading of readings) {
    const id = readingIdentity(reading);
    if (seen.has(id)) continue;
    seen.add(id);
    distinct.push(reading);
  }
  return { readings: distinct, koreanAmbiguous: null };
}

/** One fragment run that carries exactly one reading. */
interface SpanReading {
  first: number;
  last: number;
  reading: Recognised;
}

/**
 * Does exactly one way of reading the whole request exist?
 *
 * Punctuation is PROVISIONAL. Rather than bounding a role span at a terminator -- which normalized
 * text cannot even see, since `normalize` turns every mark into a space -- every contiguous run of
 * fragments is offered to the grammar, and an interpretation is a set of non-overlapping runs that
 * tiles the request exactly.
 *
 * That is what stops a swallowing reading without refusing it directly. `What did Reuters publish
 * about Alpha? What is the current Gamma?` still produces the attribution whose subject ran to the
 * end -- but it ALSO produces the two-fragment cover, so two complete interpretations exist and
 * neither is unique. `What is the definition of Yahoo! Finance?` produces only the joined run,
 * because `Finance?` alone reads as nothing, so the name is reunited without any rule knowing it is
 * a name.
 */
function completeInterpretations(fragmentCount: number, readings: SpanReading[]): SpanReading[][] {
  const covers: SpanReading[][] = [];
  const walk = (next: number, chosen: SpanReading[]) => {
    if (next === fragmentCount) {
      covers.push([...chosen]);
      return;
    }
    for (const r of readings) {
      if (r.first !== next) continue;
      chosen.push(r);
      walk(r.last + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return covers;
}

function recogniseOperation(query: string): RequestAuthority {
  const directiveFramed = classifyRequestFrame(query) === "REQUEST_DIRECTIVE";
  const normalized = normalize(query);

  // Recognition over FRAGMENT COVERS, with no recognizer able to silence another.
  //
  // The whole span is still offered -- it is the run [0..n-1] -- so a single-sentence request is
  // decided exactly as before. What is new is that a request with candidate boundaries also offers
  // its pieces, and a reading that swallowed a following question now has to compete with the cover
  // that reads both. Two complete interpretations is not one answer.
  const fragments = candidateFragments(query);
  if (fragments.length > MAX_CANDIDATE_FRAGMENTS) {
    return {
      status: "UNSUPPORTED",
      detail:
        "The request has more sentence-like pieces than this grammar will consider at once, and " +
        "reading some of them would be choosing which parts of the request to answer.",
    };
  }

  // Which candidate boundaries are CONFIRMED as clause boundaries by what follows them.
  //
  // Cover competition alone does not stop a swallowing reading. It refuses one only by producing a
  // rival tiling, and a rival needs the swallowed tail to authorize ALONE. When the tail is not a
  // complete request -- `What about the Gamma level?`, `현재 기준금리는 얼마인가요?`, `What did they
  // say about Gamma?` -- no rival exists, the joined run is the sole interpretation, and it
  // authorized with the second question buried in an open-class region where no residue check can
  // see it. Reproduced, including a redirect that served `source "should i buy stock what did
  // reuters"` -- the directive itself inside published source text.
  //
  // At the cover level the bad case and the good one are the SAME OBJECT: fragment 0 reads,
  // fragment 1 does not, the join reads. That is true of `Yahoo! Finance` as much as of R1, so no
  // arithmetic over covers can separate them. The evidence is in the tail's TEXT.
  //
  // The tested class is deliberately narrow, and a wider one was tried and refuted by measurement:
  // scanning the tail for ANY framing token kills `What did the U.S. Bureau of Labor Statistics
  // publish about nonfarm payrolls?` (`of` is framing) and misses the Korean case entirely (no
  // English tokens at all). Only tokens that can stand CLAUSE-INITIALLY confirm a boundary, plus
  // Hangul, plus a determiner in the boundary-adjacent position -- a determiner there opens a noun
  // phrase rather than continuing one.
  //
  // Fragments, not regions, because fragment offsets are RAW-query coordinates while regions are
  // slices of NORMALIZED text; `normalize` changes character counts, so "does this region cross
  // that boundary" would need an offset map between two coordinate systems that does not exist. A
  // region can only cross a boundary if its run does, so the run-level statement is equivalent and
  // needs no mapping -- and it covers all four recognizers and all four open-class roles at once.
  const confirmedBoundary = fragments.map((fragment, index) => {
    if (index === 0) return false;
    // ESC-015 item 2: delimiter-local classification is NOT the authority mechanism, and the
    // terminator-shape rule that used to sit here is gone. It refused 10 of 31 ordinary entity
    // abbreviations (`Corp.`, `GmbH.`, `Dept.`) and no threshold could fix that, because `Inc`
    // must join at three letters while `CPI` must split at three. What follows is TAIL evidence
    // only, and it is provisional: it can suggest a boundary, never establish one.
    const text = query.slice(fragment.start, fragment.end);
    // Hangul used to confirm unconditionally, and that refused an ordinary Korean issuer name:
    // `What is the definition of Samsung Electronics Co. 삼성전자?` split at the abbreviation
    // because its tail happened to be in another script. Architect review graded that P1 -- the
    // product's own market -- and the head condition below did not reach it, because the head
    // `What is the definition of Samsung Electronics Co` genuinely does read alone.
    //
    // Script change is not clause evidence. A Korean CLAUSE is, and this grammar can already tell
    // the difference without any new vocabulary: `analyseCopularInterrogative` is the same
    // predicate analyser the Korean recognizer uses. `현재 기준금리는 얼마인가요?` carries a
    // predicate; `삼성전자?` is a bare nominal and continues the name it follows.
    if (containsHangul(text)) {
      return eojeols(text).some((eojeol) => analyseCopularInterrogative(eojeol) !== null);
    }
    const tokens = normalizedTokens(normalize(text));
    // Boundary-adjacent determiners, first position only: a determiner there OPENS a noun phrase,
    // while the same word later CONTINUES one. `any` and `same` were the P1's determiner half --
    // `Any Gamma figures?` and `Same for Gamma?` were being swallowed.
    if (tokens.length > 0 && ["the", "a", "an", "any", "same"].includes(tokens[0])) return true;
    return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));
  });

  const spanReadings: SpanReading[] = [];
  let koreanAmbiguous: string[] | null = null;
  let wholeSpanReadings: Recognised[] = [];
  for (let first = 0; first < fragments.length; first += 1) {
    // Accumulated across the run, not tested per boundary: a clean third fragment must not launder
    // a confirmed boundary sitting between the first two.
    let crossesConfirmed = false;
    // The run's HEAD, `[first .. last - 1]`, as the previous iteration read it. Evidence AFTER a
    // candidate boundary is only half the question; the other half is whether anything ended.
    //
    // Measured, not supposed: the one-sided rule refused `What is the definition of Samsung
    // Electronics Co. 삼성전자?` and `What did Samsung Electronics Co. 삼성전자 report about
    // revenue?`. A Hangul tail confirms unconditionally, and `<English legal name> Co. <Hangul
    // name>` is an ordinary way to write a Korean issuer -- the product's own market, refused.
    // Architect review called that P1 rather than recorded debt. `Mr. Show` is the same shape in
    // English and is P2.
    //
    // A period ends a sentence only if a sentence preceded it. `What is the definition of Samsung
    // Electronics Co` is not a request; `What is the current Gamma` is. So the head must stand
    // alone too -- and standing alone has to include a standalone PROHIBITED request, or the P1
    // case loses its protection: `Should I buy stock` is refused by the outer screen and is not an
    // informational reading of any span.
    let headReads = false;
    for (let last = first; last < fragments.length; last += 1) {
      // ESC-015 §20: exactly what confirmed-boundary authority still owns, measured rather than
      // asserted, now that full-role exactness carries publication authority underneath it.
      //
      // `python scripts/mutation/differential.py <dump> confirmed-boundary-suppression`, 2026-08-29,
      // over 99,072 generated requests: 12,980 discriminating inputs. Every single one is
      // UNSUPPORTED in the original and admitted in the mutant -- 11,960 AUTHORIZED, 924 PROHIBITED,
      // 96 AMBIGUOUS -- and ZERO go the other way. The suppression is purely restrictive, and what
      // it restricts is a run crossing a confirmed boundary being tiled, which otherwise swallows
      // the following question into the subject role:
      //
      //     What did Reuters publish about Alpha. What is the CPI? Alpha Corp?
      //       -> subject ` alpha what is the cpi alpha corp `
      //
      // So delimiter authority is NOT "fully gone" and nothing may describe it that way. What was
      // removed by ESC-015 item 2 is delimiter SHAPE as the classifier -- whether a period after an
      // abbreviation ends a sentence. What remains here is different and narrower: a boundary the
      // TAIL confirmed suppresses runs across it. The full-role cover does not subsume this,
      // because it decides which stored identity a role names and this decides what the role IS.
      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;
      const span = query.slice(fragments[first].start, fragments[last].end);
      const { readings, koreanAmbiguous: ambiguous } = recogniseSpan(span);
      // What this span will be as the NEXT iteration's head. `recogniseSpan` is cached on span
      // text, so re-reading it costs no evaluation and leaves the n(n+1)/2 contract alone.
      headReads = readings.length > 0 || detectPersonalizedAdviceRequest(span);
      if (first === 0 && last === fragments.length - 1) {
        wholeSpanReadings = readings;
        if (ambiguous) koreanAmbiguous = ambiguous;
      }
      // A span carrying more than one distinct reading is not a reading; it is a span that has to
      // be read some other way, or not at all.
      //
      // A blocked run is still EVALUATED above and only withheld from the tiling. That keeps the
      // whole-span two-reading diagnostics honest and keeps the span-evaluation count at exactly
      // n(n+1)/2 -- "optimising" by skipping the call would break the count test, correctly.
      if (readings.length === 1 && !crossesConfirmed) {
        spanReadings.push({ first, last, reading: readings[0] });
      }
    }
  }

  if (koreanAmbiguous) {
    return {
      status: "AMBIGUOUS",
      detail:
        `The request has more than one morphological reading — ${koreanAmbiguous.join(", ")} — ` +
        "and choosing between them would need either the subject inventory, which must not decide " +
        "what a sentence meant, or a guess.",
    };
  }

  // Two readings of one span was the old ambiguity check and is kept for its message: it is the
  // most specific thing that can be said about a request that reads two ways at once.
  if (wholeSpanReadings.length > 1) {
    const operations = new Set(wholeSpanReadings.map((r) => r.operation));
    return {
      status: "AMBIGUOUS",
      detail:
        operations.size > 1
          ? `The request reads as ${[...operations].join(" and ")}, and one answer cannot be both.`
          : `The request reads as more than one ${[...operations][0]}, and answering one would be ` +
            "choosing which was meant.",
    };
  }

  const interpretations = completeInterpretations(fragments.length, spanReadings);
  if (interpretations.length > 1) {
    return {
      status: "AMBIGUOUS",
      detail:
        "The request can be read as a different number of questions depending on where its " +
        "sentences are taken to end, and choosing one of those readings would be choosing what " +
        "was asked.",
    };
  }
  const cover = interpretations[0];
  if (cover && cover.length > 1) {
    return {
      status: "UNSUPPORTED",
      detail:
        `The request asks ${cover.length} separate questions, and this repository answers one ` +
        "operation at a time rather than choosing among them.",
    };
  }
  const recognised = cover ? [cover[0].reading] : [];
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

  // Two readings of the SAME operation are still two readings.
  //
  // This collapsed on operation alone and then took the first match, which let one question hide
  // inside another's subject region:
  //
  //     "What is the current Acme? What about latest Beta?"
  //     -> AUTHORIZED, CURRENT_OBSERVATION, subject "acme what about latest beta"
  //
  // ` current ` and ` latest ` are both CURRENT_OBSERVATION constructions, so the set had one
  // element, the first match won, and its trailing subject region swallowed the second question
  // whole. That is `there are no halves` failing on the case where both halves are the same kind of
  // half -- the coordinator list catches `and latest Beta`, and nothing caught `? What about`.
  //
  // The Korean path has always keyed on operation AND subject for exactly this reason. This is that
  // rule, applied where it was missing rather than invented here.
  const readings = new Set(
    recognised.map((r) => `${r.operation}:${canonicalSubjectKey(r.operation, r.subjectRegion)}`),
  );
  if (readings.size > 1) {
    return {
      status: "AMBIGUOUS",
      detail:
        `The request reads as more than one ${[...operations][0]} — ` +
        `${[...readings].map((r) => r.split(":")[1]).join(" and ")} — and answering one would be ` +
        `choosing which was meant.`,
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
  // Lowercased before every closed-class comparison, and the omission was exploitable.
  //
  // The English path arrives here already normalized, so nobody noticed that these two checks
  // compare against lowercase literals. The Korean grammar does NOT normalize — it must not, since
  // case and script are the only category evidence a Latin subject carries — so a case-preserving
  // subject reached a lowercase membership test. `AND 얼마인가요?` was AUTHORIZED with the
  // coordinator AND as its subject, walking straight through the check written to stop exactly that.
  const subjectTokens = subjectRegion
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => token.toLowerCase());
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
    subjectIdentity: match.subjectIdentity ?? "OCCURRENCE",
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
