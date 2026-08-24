import { prisma } from "@/server/db/client";
import { computeChange, getRecentObservationPair } from "./seriesReadings";
import { resolveRequestAuthority } from "./requestAuthority";
import { explicitlyNamed, nameOccursIn } from "./subjectAuthority";
import { computeCalendarEntry } from "./economicCalendar";
import { evaluateStaleness } from "./staleness";
import { extractKeywords } from "./eventClustering";
import { asksWhetherAPersonShouldTrade } from "./subjectClassification";
import { frameExemptsProhibitedVocabulary, requestsAFinancialDecision } from "./requestFrame";

/**
 * Ask Market — deterministic safe-mode MVP (docs/ROADMAP.md M21).
 *
 * Full M21 per docs/PRODUCT_SPEC.md is "natural-language Q&A ... segmented into
 * FACT/CALCULATION/INFERENCE." That requires a live LLM call at product runtime to interpret
 * arbitrary free text and synthesize INFERENCE prose — a real per-request cost against whatever
 * provider serves it, categorically different from this development session's own Claude usage
 * (see docs/DECISIONS.md's original M21 entry). That remains BLOCKED_HUMAN_GATE: no provider/
 * funding/credential decision has been made, and this module does not route around that by
 * quietly calling a paid API.
 *
 * What IS buildable at zero runtime AI cost, and genuinely useful: a structured "explain the
 * factors" lookup over data already in the Claim Ledger / FinancialFact / CausalEdge tables, plus
 * a deterministic guardrail that intercepts personalized buy/sell/allocation-style requests
 * before they'd otherwise reach a factors response — enforcing docs/LEGAL_GUARDRAILS.md's
 * "삼성전자 지금 살까?" redirect requirement today, without waiting for the LLM decision. No
 * prose is synthesized here: every field returned is a direct read of already-verified FACT/
 * CALCULATION data, never an INFERENCE claim (there is no INFERENCE producer yet — M09/
 * REVIEW_DEBT.md).
 */

export type AskMarketResultStatus =
  | "PERSONALIZED_ADVICE_REDIRECTED"
  | "FACTORS_FOUND"
  | "NOT_FOUND"
  /**
   * The request was understood well enough to know this product cannot serve it.
   *
   * Distinct from `NOT_FOUND`, which means "we looked and found nothing". IR-107 measured why the
   * distinction matters: eighteen personalized requests escaped the redirect and seventeen of them
   * returned `NOT_FOUND` purely because no stored factor happened to match. That is not a refusal,
   * it is a miss whose consequence has not arrived — with the data ingested they would have been
   * answered. A status that says "we did not recognise what you asked for" cannot be produced by an
   * empty database, so it cannot be mistaken for safety.
   */
  | "REQUEST_NOT_SUPPORTED";

/**
 * What every series factor carries whatever operation asked for it: which series, whose figure it
 * is, and when it was observed. Provenance is not operation-specific — CLAUDE.md requires every
 * FACT shown to a user to trace to a stored source, regardless of what was asked.
 */
interface SeriesFactorBase {
  seriesId: string;
  seriesName: string;
  /**
   * The provider this figure came from.
   *
   * `Series` is unique on (sourceId, externalId) and never on name, so two providers publishing
   * their own CPI or policy rate is ordinary rather than exotic. Both would match one topic and
   * both would be listed, and without this field the reader sees two different numbers under
   * near-identical labels with nothing to tell them apart. It is also the plain requirement in
   * CLAUDE.md: every FACT shown to a user must trace to a stored source.
   */
  sourceCode: string;
  unit: string;
  asOfDate: string;
  value: number;
}

/**
 * A level, and nothing about how it got there.
 *
 * The two shapes are separate types rather than one type with optional fields, because optional
 * fields are a request to be ignored. One object carried `value`, `absoluteChange` and
 * `percentChange` together, so serving a CURRENT_OBSERVATION without also serving an
 * OBSERVED_CHANGE was not merely unenforced, it was unrepresentable — and the integration test
 * asserted the change fields on a current-level request, which is the defect written down as an
 * expectation.
 */
export interface ObservationFactor extends SeriesFactorBase {
  kind: "OBSERVATION";
}

/** A movement over a stated period, with the period it was measured over. */
export interface ChangeFactor extends SeriesFactorBase {
  kind: "COMPUTED_CHANGE";
  absoluteChange: number;
  percentChange: number | null;
  /** The interval the request named. A change with no period is not a change anyone asked for. */
  interval: string;
}

export type SeriesFactor = ObservationFactor | ChangeFactor;

export interface CausalFactor {
  fromVariable: string;
  toVariable: string;
  direction: string;
  confidence: string;
  mechanism: string;
  lag: string;
  counterexamples: string;
}

export interface CompanyFactFactor {
  concept: string;
  /** The provider that reported this figure — same obligation as `SeriesFactor.sourceCode`. */
  sourceCode: string;
  fiscalPeriod: string | null;
  fiscalYear: number | null;
  /**
   * The period the figure actually covers. Load-bearing, not decoration: one filing reports both
   * a year-to-date and a quarterly figure under the same fiscal label, so without these two
   * dates a reader sees "Revenue $364.4B (Q3 2026)" directly above "Revenue $109.4B (Q3 2026)"
   * and has no way to tell which is which. `periodStart` is null for instant concepts (Assets,
   * Liabilities, Cash), which are a balance at a date rather than a flow over a span.
   */
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  unit: string;
  value: number;
  form: string;
}

export interface AskMarketResult {
  status: AskMarketResultStatus;
  query: string;
  redirectMessage?: string;
  matchedTopic?: string;
  seriesFactors: SeriesFactor[];
  causalFactors: CausalFactor[];
  companyFacts: CompanyFactFactor[];
}

/**
 * Deterministic keyword/pattern match for personalized buy/sell/allocation-style requests, in
 * English and Korean. Intentionally broad (favors false positives over false negatives) — a
 * legitimate factual question incorrectly redirected is a much smaller harm than a personalized
 * trading instruction slipping through. Patterns come directly from docs/LEGAL_GUARDRAILS.md's
 * hard-prohibitions list.
 */
const ADVICE_REQUEST_PATTERNS: RegExp[] = [
  /\bshould i (buy|sell|purchase|invest in|allocate to)\b/i,
  /\b(buy|sell|purchase) (it|this|that|now|today)\b/i,
  // Same intent as the pattern above, but tolerating words between the verb and the timing word
  // ("Buy Tesla now" / "Sell my ETF right now") — a bypass the strict-adjacency version above
  // misses. Bounded lookahead (20 chars) keeps this from matching across unrelated sentences.
  /\b(buy|sell|purchase)\b[\s\S]{0,40}\b(now|today|right now|immediately|asap)\b/i,
  /\bbuy or sell\b/i,
  /\bis (it|this|that) a good (buy|time to buy|time to sell|sell)\b/i,
  /\bworth (buying|selling)\b/i,
  /\bwhat should i (buy|sell|invest in|allocate|purchase)\b/i,
  /\bhow much should i (invest|allocate|put)\b/i,
  // A bounded gap between the promise and the noun. The adjacent-words version missed "guaranteed
  // 10% annual return", which is not an exotic phrasing — it is how the request is normally made.
  // Found by the Gate A review; guaranteed returns are in LEGAL_GUARDRAILS' hard prohibitions.
  /\b(guaranteed|guarantee|guarantees|guaranteeing)\b[\s\S]{0,40}\b(return|profit|gain|yield)s?\b/i,
  // ...and the same words the other way round. "I want 12% returns guaranteed" states the promise
  // after the figure rather than before it, which is how people actually say it. Every other
  // reversal in this file — target price, price target — was found the same way.
  //
  // Scoped to a first-person frame, and for the same reason the promise noun form is. Reversed,
  // this pattern reads on any sentence ABOUT a guarantee, and finance is full of those: "Are
  // deposit returns guaranteed by the FDIC?", "The filing says returns are not guaranteed.",
  // "What yield is guaranteed under a government bond?". Somebody demanding a guaranteed return
  // says I, me, my, we or our; somebody asking whether one exists does not.
  /\b(i|me|my|we|us|our)\b[^?!]{0,25}\b(return|profit|gain|yield)s?\b[^?!]{0,25}\b(guaranteed|guarantee)\b/i,
  // "Promise" carries the same meaning as "guarantee" when it is promised TO SOMEONE — "Can you
  // promise my brother a 10% annual return?" — and an entirely ordinary one when it is not: "does
  // the new fab promise better returns for TSMC" is a research question. The personal object is
  // what separates them, so it is required here and not in the pattern above, where the word
  // "guaranteed" already carries the prohibited claim on its own.
  //
  // The pronoun list was, again, too narrow: "Can you promise John a 10% annual return?" walked
  // past it. What actually marks the prohibited sense is the SHAPE — promise <recipient> a <figure>
  // — so that is what this matches, with the recipient allowed to be a name, a role, or a
  // possessive phrase. The trailing `a|an|<digit>` is what keeps ordinary prose out: "does the
  // merger promise the kind of returns investors want" has a recipient-shaped word after "promise"
  // and no figure after it, and still answers.
  //
  // The recipient has to be PERSON-LIKE. Allowing any word there was the overshoot: "The
  // prospectus promises a 5 year lock-up, not a return" and "Analysts promise nothing about future
  // gains in this filing" were both refused, because "a" and "nothing" are words like any other.
  //
  // Three rounds were spent on the RECIPIENT — pronoun, then any word, then a capitalised name,
  // then a numeral to stand in for the capital — and each version traded one error for another.
  // The recipient was never the discriminator. WHO IS BEING ASKED TO PROMISE is.
  //
  //   "Can you promise John a 10% annual return?"     — the system is asked to promise. Prohibited.
  //   "Does this bond promise investors a 5% yield?"  — a bond promises. Contractual terms, and a
  //                                                     perfectly ordinary research question.
  //   "The acquisition promises shareholders a higher return on equity."   — prose.
  //   "Does the merger promise the kind of returns investors want?"        — prose.
  //
  // Every prohibited form has "you promise" in it or is an imperative; every innocent one has a
  // thing as the subject. So the subject is what this keys on, and the recipient goes back to
  // being anything at all — which is what finally makes lower case, capitals, names, roles and
  // "double-digit" all work without a fourth list.
  //
  // A short gap after "you", because the politeness a request like this is wrapped in sits exactly
  // there: "Would you BE ABLE TO promise me a 10% return?", "Can you PLEASE promise me…". Fifteen
  // characters covers those and not "Can you tell me if the bond promises investors a 5% yield?",
  // where twenty-four characters separate the two words and the subject is the bond.
  //
  // An article before it makes "promise" a noun, and the sentence a question ABOUT a document:
  // "Can you explain the promise of 5% returns in the prospectus?". The lookbehind is what keeps
  // the fifteen-character gap from turning every "you ... the promise" into a request.
  //
  // And a comma ends the gap, because it ends the clause. "As you note, bonds promise investors a
  // 5% yield" puts twelve characters between the two words and the subject of "promise" is bonds.
  /\byou\b[^?!,]{0,15}(?<!\b(?:the|a|an|no|any|its|this|that)\s)\bpromise\b[^?!]{0,40}\b(return|profit|gain|yield)s?\b/i,
  // The imperative, with room for an adverb — "JUST promise me a 10% return." The lead-in is a
  // closed list of adverbs rather than a character span, because a span admits a subject noun and
  // "Analysts promise nothing about future gains in this filing" is prose.
  //
  // A comma opens an imperative too: "For my retirement account, promise me a 10% annual return."
  // The adverb list is what keeps the boundary from admitting a subject, so widening the boundary
  // costs nothing — "Analysts promise nothing about future gains" has no comma before the verb,
  // and "The prospectus promises…" never matches `promise` followed by a space.
  /(^|[.?!]\s+)(just |please |now |kindly )?promise\s+(me|us|him|her|them|\w+)\b[^?!]{0,40}\b(return|profit|gain|yield)s?\b/i,
  // After a COMMA the recipient must be a pronoun. A full stop is strong evidence that what follows
  // is a new clause and that "promise" opens it; a comma is not, and with any word allowed after it
  // "In the filing, promise language around returns is boilerplate" was refused.
  /,\s+(just |please |now |kindly )?promise\s+(me|us|him|her|them)\b[^?!]{0,40}\b(return|profit|gain|yield)s?\b/i,
  // The noun form. "I want a promise of 10% returns" asks for the same thing without ever using
  // the verb.
  //
  // A figure alone was not enough of a filter, and the reason is instructive: "promise of <n>%
  // return" is how PROSPECTUSES talk. "The prospectus contains no promise of a 5% return", "Does
  // the indenture include a promise of 6% returns to holders?" and "Can you explain the promise of
  // 5% returns in the prospectus?" were all refused, and all three are the product's core subject
  // matter. What makes the noun form a request is someone WANTING one, so that is required.
  //
  // A verb list was the first attempt and it lasted one round: "Can I HAVE a promise of 10%
  // returns?", "I WOULD LIKE a promise of…", "I AM LOOKING FOR a promise of…" all walked past it,
  // and lengthening the list only moves the boundary. The feature that actually separates the two
  // populations is FIRST PERSON. Someone asking for a promise says I, me, my, we or our; a
  // document describing one does not.
  //
  // Second person is deliberately excluded. "Can YOU explain the promise of 5% returns in the
  // prospectus?" is a research question, and including "you" here would refuse it — which is the
  // exact over-block the previous round was fixing.
  //
  // And an INDEFINITE article, which is the other half of the same observation. A request asks for
  // "A promise of 10% returns"; prose refers to "THE promise of 8% returns" that a document already
  // contains — "Our analysts flagged the promise of 8% returns in that pitch deck" has a
  // first-person pronoun and is a description. Asking for one and describing one differ in the
  // article, reliably, and that costs nothing to check.
  /\b(i|me|my|we|us|our)\b[^?!]{0,25}\ba promise of\b[^?!]{0,25}\d[^?!]{0,25}\b(return|profit|gain|yield)s?\b/i,
  /\btarget (price|return)\b/i,
  // "price target" — the same prohibited concept with the words the other way round, which the
  // pattern above does not match. Price targets are named explicitly in LEGAL_GUARDRAILS.md's
  // hard-prohibitions list, so having only one word order covered was a real hole.
  /\bwill .* (hit|reach|go to) [\d,.]+\b/i,
  // A definitive price prediction asked with "what" and no numeral: "What will Apple trade at
  // next year?". The numeral pattern above cannot see it, and the `where … will … trade` pattern
  // further down requires "where". This is the third time the same shape has appeared — one
  // phrasing of a prohibited concept covered and the neighbouring one not, after target/price
  // target and the two Korean reversals.
  //
  // Scoped to price verbs deliberately. "What will unemployment be next year?" is a forecast
  // question about an indicator rather than a price prediction, and refusing ordinary macro
  // research would turn the guardrail into something users route around.
  //
  // "close" is not in that list on its own, and was, briefly. "What will happen if US markets
  // close tomorrow?" is a question about market mechanics and it was being refused. A closing
  // PRICE needs the preposition to mean anything — "close at", "close above" — so the preposition
  // is what the pattern keys on.
  //
  // Bare "hit" and "reach" came out for the same reason "close" did. "What will unemployment reach
  // next year?" and "What will trade volumes be next year?" are analytical forecasts, and both
  // were being refused — which contradicts the invariant stated two paragraphs up. A definitive
  // PRICE prediction needs the preposition ("trade at", "close above") or an explicit worth; a
  // numeric target is already covered by the `will … hit … 300` pattern above, which requires the
  // number that makes it a price.
  //
  // Dropping bare "hit" and "reach" reopened the form that asks for a price WITHOUT a number:
  // "What high will Apple hit next year?". The numeric pattern above cannot see it because there
  // is no numeral, and "trade at" is not how it is phrased. The price NOUN is what carries the
  // meaning here, so that is what this keys on.
  //
  // The SUBJECT has to look like an instrument, or this refuses macro forecasts: "What value will
  // unemployment reach next year?" was caught by an earlier version that keyed on the price noun
  // alone. A capital letter between "will" and the verb is the available signal — companies and
  // tickers carry one, indicators do not.
  /\b[Ww]hat\s+(high|low|price|worth)\b[^?!]{0,30}\bwill\b[^?!]{0,30}\b[A-Z][^?!]{0,25}\b(hit|reach|be)\b/,
  // The same question with the words the other way round: "What will Apple's price be next year?".
  // Neither the noun-first pattern above nor the numeric one sees it. Keyed on the possessive, so
  // "What will Korea's GDP be next year?" is untouched.
  /\bwhat will\b[^?!]{0,30}'s\s+(price|share price|value|worth)\b/i,
  // Index levels. This was left as an open gap for one round on the grounds that nothing separates
  // "What level will the S&P 500 reach?" from "What level will unemployment reach?" — but the
  // separation is the SUBJECT, and unlike personal names the major indices are a closed, stable
  // set. Naming them costs nothing: no economic indicator shares a name with one.
  // Case-sensitive, and refusing to match when a capitalised word follows the index name. Both
  // are there for the same reason: "Dow" is a company as well as an index, and the case-insensitive
  // version refused "What level will the Dow Chemical dividend reach next year?". An index name
  // followed by another proper noun is part of a longer name, not an index.
  // ...but "Nasdaq Composite" and "S&P 500 Index" ARE the index, so the lookahead lets through the
  // words that continue an index name and stops at the ones that start a company name.
  /\b[Ww]hat (level|value|number)\b[^?!]{0,30}\bwill\b[^?!]{0,30}\b(S&P( 500)?|Nasdaq|NASDAQ|Dow Jones Industrial Average|Dow( Jones)?|Russell|KOSPI|Kospi|KOSDAQ|Nikkei|FTSE|DAX|Hang Seng|STOXX|VIX)\b(?!\s+(?!Index|Composite|Average)[A-Z])[^?!]{0,25}\b(hit|reach|be|close)\b/,
  /\bwhat\b[\s\S]{0,40}\bwill\b[\s\S]{0,30}\btrade\b\s+(at|above|below|around|near)\b/i,
  /\bwhat\b[\s\S]{0,40}\bwill\b[\s\S]{0,30}\b(be worth|be priced)\b/i,
  /\bwhat\b[\s\S]{0,40}\bwill\b[\s\S]{0,30}\bclose\b\s+(at|above|below|higher|lower)\b/i,
  /\b(recommend|suggest|pick) (a stock|an etf|which stock|me a stock|me a pick)\b/i,
  // Advice requested ON BEHALF OF someone else, in English. The Korean third-party forms went in
  // as IR-034 and the English ones never did — the same asymmetry as the output scanner being
  // second-person only (GC-10). "Tell my brother to dump Apple" is a personalised recommendation;
  // naming a third party makes it worse rather than exempt.
  //
  // The possessive pronoun was doing too much work. The follow-up review walked straight past it
  // with "Tell John to sell Apple", "Advise your brother to liquidate his Tesla position" and
  // "Should Dad buy more Nvidia?" — a proper name, an unlisted pronoun and a kinship term with no
  // pronoun at all. WHO the third party is was never the point, so the instruction pattern no
  // longer asks.
  //
  // The span was `[^.?!]` for one round, to keep it inside a single sentence. A period is not a
  // sentence boundary in English: "Tell Mr. Smith to sell Apple." and "Tell Acme Inc. to sell its
  // Apple stake" both escaped, because the span stopped at the abbreviation. Distinguishing "Mr. "
  // from a real sentence end needs either an abbreviation list or a lookbehind thicket, and both
  // are worse than the thing they fix. The span excludes only `?` and `!` now, and the 40/25
  // bounds are what keep it local. The cost is a contrived over-block across two short sentences;
  // the alternative was a one-word bypass of an absolute prohibition.
  /\b(tell|advise|convince|instruct|persuade)\b[^?!]{0,40}\bto\b[^?!]{0,25}\b(buy|sell|dump|short|invest|divest|liquidate|offload)\b/i,
  // "hold" gets its own pattern because it has an innocent analytical sense the others do not:
  // "Advise my analyst to hold GDP constant when comparing the two scenarios" is methodology, not
  // a trading instruction, and was being refused.
  /\b(tell|advise|convince|instruct|persuade)\b[^?!]{0,40}\bto\b[^?!]{0,25}\bhold\b(?![^?!]{0,20}\b(constant|fixed|steady|equal|unchanged)\b)/i,
  // "Should <anyone> buy?" — the enumeration went the same way the possessive list did. A proper
  // name ("Should John buy Nvidia?") and a role ("Should the trustee buy Nvidia?", "Should the
  // desk sell Apple?") both walked past a kinship list, and a longer list would only move the
  // boundary rather than remove it.
  //
  // The generalisation `should <anything> <trading verb>` was tried here for one commit and it was
  // a bad trade — the widest change of that round, and the one that broke the most. A self-attack
  // with ten ordinary research questions refused all ten:
  //
  //   "Should the Fed hold rates steady at the next meeting?"
  //   "Why should the ECB buy government bonds under QE?"
  //   "How should a company hold treasury shares on its balance sheet?"
  //   "What should a 10-K disclose about short positions?"
  //   "Should short interest be reported semi-monthly?"
  //
  // The verb was supposed to be the discriminator and it is not one: "hold", "short" and "invest"
  // are ordinary words in central-bank policy, accounting and regulation. Gate B's original
  // objection was right and the reversal recorded against it was wrong — this reverses the
  // reversal, on evidence rather than on reflection.
  //
  // What Gate C actually proved missing was narrower than the generalisation used to fix it:
  // proper names and investor roles. Those are enumerated, and the enumeration is honest about
  // what it is. The subject has to be a PERSON or someone acting for one; "the Fed", "a company"
  // and "the index" are none of those, and "Should investors buy Nvidia?" stays answerable as
  // market commentary rather than personal advice.
  // Sixty characters rather than twenty-five, because the description of the person is exactly
  // where a request like this gets long: "Should my elderly retired father with a low risk
  // tolerance sell Apple?" is forty-eight characters between the possessive and the verb, and it
  // is the most personalised request in this whole file. The possessive already establishes that
  // a person is the subject, so the extra span costs nothing that the possessive was buying.
  // The analytical-hold exemption applies here too, and for the same reason it applies to the
  // instruction patterns: "Should my model hold the discount rate fixed across all three
  // scenarios?" is methodology. A possessive does not make the subject a person — "my model" and
  // "my analysis" take one as readily as "my father" does.
  // Commas end the span as well as `?` and `!`. Sixty characters is room enough for "my elderly
  // retired father with a low risk tolerance", which contains none, and not enough to walk from
  // "our independent central bank," through a subordinate clause into "buy government bonds under
  // QE" — a monetary-policy question the wider span was refusing.
  // A second possessive moves the subject again, and the same exclusion the kinship rule uses
  // applies here: "Should my brother's PROJECT MANAGER buy new software?", "Should my father's
  // ESTATE AGENT sell the house?" — neither is about investing, and both were refused. When the
  // second possessive belongs to a financial agent the kinship-agent rule below still catches it,
  // so nothing that matters is lost.
  // Kinship, with commas allowed on both sides of it — unlike the possessive rules above, where a
  // comma ends the span so that "our independent central bank, during a liquidity crisis, buy
  // government bonds" is not read as advice. A kinship term settles what the possessive rules can
  // only guess at: "Should my elderly retired father, given his low risk tolerance, sell Apple?"
  // is a person being advised, appositive or not, and the comma bound was letting it through.
  //
  // A possessive on the kinship term moves the subject off the person, though: "Should my
  // brother's COMPANY, given its strong cash balance, buy a competitor?" is corporate analysis,
  // and the wider span was reaching across the apostrophe to find the verb.
  // "Manager" and "agent" are generic, so they need a finance qualifier in front of them. Without
  // one, "Should my brother's PROJECT manager buy new software?", "Should my father's ESTATE agent
  // sell the house?" and "Should my sister's OFFICE manager invest in new desks?" were all
  // refused — none of which is about investing at all. A broker or a trustee needs no qualifier:
  // the title already says what the job is.
  //
  // A relative's AGENT is still the relative's decision. Excluding `'s` after a kinship term was
  // right for "my brother's company" and wrong for "Should Dad's broker sell Apple?" — a broker
  // acts for a person, and a company acts for itself. So the possessive is allowed back when what
  // follows it is one of the roles below.
  // NOTE — the five `should <subject> <verb>` patterns that used to sit here are gone.
  //
  // They tried, across five rounds, to decide whether the subject of a trading verb was a person:
  // by possessive pronoun, then by kinship list, then by capital letter, then by role list, then by
  // a second possessive. Each version was walked past from one side or refused ordinary research
  // from the other, because the difference between "Should John buy Nvidia?" and "Should Apple buy
  // Nvidia?" is not in the sentence. It is in what John and Apple ARE.
  //
  // `asksWhetherAPersonShouldTrade` in ./subjectClassification answers that question against
  // deterministic local registries, and returns UNRESOLVED-as-person for a name nothing
  // recognises. It runs in `detectPersonalizedAdviceRequest` below, alongside these patterns.

  // A relative's HOLDINGS are still the relative's. The second-possessive exclusion above is right
  // for "my brother's company" and wrong for "Should my father's shares in Apple be sold?" or
  // "Should my wife's ISA hold Samsung?" — those name what the person owns, not a separate actor.
  /\bshould\s+(my|his|her|their|our|your)\s+[^?!,]{0,25}['’]s\s+(\w+\s+)?(shares?|stake|holdings?|portfolio|position|account|isa|pension|401k|fund|savings)\b[^?!]{0,40}\b(buy|sell|sold|dump|short|hold|invest)\b/i,
  // ...and the holding can sit AFTER the verb instead. "Should my boss's assistant sell HIS APPLE
  // SHARES?" names an actor the role list does not have — assistant — but what is being sold is
  // plainly one person's holding, and that is enough on its own. "Sell the house" and "buy new
  // software" have no personal possessive in front of the object, which is what keeps them out.
  //
  // The possessive object has to belong to somebody the SENTENCE has already named as a person.
  // Unbound, "their" is what organisations take: "Should BlackRock sell their pension fund
  // business?", "Should banks hold their pension fund assets separately?", "Should the company
  // sell their portfolio management unit?" — all corporate questions, all refused. Requiring a
  // personal possessive after "should" keeps the boss's-assistant case and drops those.
  //
  // Split by which possessive it is, rather than by whether the sentence opens with "should".
  // Anchoring on "should" was too specific — "Can my father's broker sell his Apple shares?",
  // "Is it time for Dad to sell his Apple shares?" and "Would it make sense for my wife to sell
  // her Samsung shares?" are the same request in other grammar.
  //
  // "His" and "her" are singular and personal, so they need nothing else. "Their" and "our" are
  // what organisations take, so they still need a personal possessive earlier in the sentence —
  // which is what keeps "Should BlackRock sell their pension fund business?" answerable.
  /\b(buy|sell|dump|short|hold|invest)\b[^?!]{0,20}\b(his|her)\s+(\w+\s+)?(shares?|stake|holdings?|portfolio|position|account|isa|pension|401k|fund|savings)\b/i,
  /\b(my|his|her|your|our)\b[^?!]{0,40}\b(buy|sell|dump|short|hold|invest)\b[^?!]{0,20}\b(their|our|my|your)\s+(\w+\s+)?(shares?|stake|holdings?|portfolio|position|account|isa|pension|401k|fund|savings)\b/i,
  // NOTE — the investor-role pattern that sat here is gone. `classifySubject` recognises the
  // same roles and, unlike the pattern, reads the rest of the subject: "Should the trustee BANK
  // hold its pension fund assets separately?" is an institution, and the pattern refused it
  // because "trustee" appeared in it.
  /\bshould i (invest|get in|get out|hold|sell out|take profits?|cut (my )?losses)\b/i,
  /\b(good|right|bad) time to (get in|get out|enter|exit|buy in)\b/i,
  // Position-sizing intent regardless of how it is framed. `should i …` was too narrow: the
  // Codex packet itself listed "would now be a wise time to add to my position" as a known
  // bypass, and "thinking about adding to my position" reads the same way to a user. Anchoring
  // on the ACTION plus the possessive object catches the intent without needing the question
  // form.
  /\b(add to|adding to|increase|increasing|reduce|reducing|trim|trimming|exit|exiting|double down on)\b[\s\S]{0,20}\b(my|the)\s+(position|holding|stake|allocation)\b/i,
  // Third-person "is X a buy/sell" framing, which sidesteps every first-person pattern. The
  // packet listed this too; only the "…right now" variant happened to be caught, by the
  // proximity rule.
  /\bis\b[\s\S]{0,40}\ba (buy|sell|strong buy|strong sell)\b/i,
  // Long/short position vocabulary. The whole family was missing — "should I go long TSLA",
  // "should I short Apple", "I want to short the market" and the Korean 롱/숏 forms all passed
  // through, while the identical intent phrased as "buy" or "sell" was caught. A guardrail that
  // depends on the user choosing retail vocabulary over trading vocabulary is not a guardrail
  // (IR-031, `gpt-5.6-terra` A9/A12, reproduced).
  //
  // "long" is the dangerous word to pattern on — it is an ordinary English adjective — so it is
  // anchored to a position verb rather than matched bare. "short" is anchored the same way, for
  // the same reason: "short-term rates" must stay answerable.
  /\b(go|going|goes|went)\s+(long|short)\b/i,
  /\bshould i\b[\s\S]{0,20}\b(long|short)\b/i,
  /\b(want|wants|thinking about|planning)\b[\s\S]{0,20}\bto short\b/i,
  /\bshort (the market|this|it|that|stocks?|equities)\b/i,
  /\b(open|opening|take|taking|build|building)\s+a\s+(long|short)\b/i,
  // Korean: 롱/숏 as positions, plus 공매도 (short selling) in instruction form.
  /(롱|숏)\s*(잡을|잡아|칠|쳐야|진입|포지션)/,
  /공매도\s*(할까|해야|하면|해도)/,
  // Whole CONCEPTS that were never enumerated, found by probing concepts rather than phrasings
  // (IR-034). IR-031 closed long/short; this closes seven more families that were absent for the
  // same reason — the list covered phrasings of ideas someone had thought of, and nothing covered
  // an idea nobody had listed.
  //
  // Every pattern here is anchored to an INSTRUCTION frame, because each of these words is also
  // ordinary financial vocabulary. "margin" is an operating margin, "leverage" is a leverage
  // ratio, "average" is a moving average, "portfolio" is portfolio theory. Matching them bare
  // would break the analytical half of the product to protect the advisory half.
  /\bshould i\b[\s\S]{0,30}\b(margin|leverage|calls?|puts?|options?|average down)\b/i,
  /\bhow much (leverage|margin)\b/i,
  /\b(use|using|trade|trading|buy|buying)\b[\s\S]{0,12}\b(on )?(margin|\d+x leverage)\b/i,
  /\b(which|what) strike\b/i,
  /\b(write|writing|sell|selling|buy|buying) (naked )?(calls?|puts?)\b/i,
  /\baverage down\b/i,
  // Anchored to an instruction, not to the term. "How does dollar cost averaging work as a
  // concept?" is a question this product should answer, and the bare pattern blocked it — the
  // same over-block the `fair value` pattern produced, caught here by the negative controls
  // before it shipped rather than by a reviewer afterwards.
  /\b(should i|good idea to|worth|recommend)\b[\s\S]{0,30}\bdollar[-\s]?cost[-\s]?averag/i,
  /\bdollar[-\s]?cost[-\s]?averag\w*\b[\s\S]{0,15}\binto (this|it|that|my)\b/i,
  // Hypothetical and third-party framings, which sidestep every first-person pattern by design.
  /\bhypothetical(ly)?\b[\s\S]{0,80}\b(where should|what should|buy|sell|invest|put)\b/i,
  /\bfor a friend\b[\s\S]{0,40}\b(buy|sell|hold|invest)\b/i,
  /\bif someone had\b[\s\S]{0,40}\b(where|what|buy|invest|put)\b/i,
  /\bis now a good (entry|time|moment)\b/i,
  /\b(build|make|create) (me )?an? (portfolio|allocation|basket)\b/i,
  /\bwhat percentage in\b/i,
  // Korean counterparts. An English pattern with no Korean mirror is a hole, which this list has
  // now learned twice.
  /물타기/,
  /(친구|아버지|어머니|부모님?|형|누나|동생|와이프|아내|남편)(가|이|께서|은|는)?\s*[\s\S]{0,25}(사야|팔아야|뭘\s*사|어디에?\s*투자)/,
  /(가정해서|만약에?)\s*[\s\S]{0,30}(어디에?\s*(넣|투자)|뭘\s*사)/,
  /포트폴리오\s*(짜|구성|만들)/,
  /(들어갈|나올|진입할)\s*타이밍/,
  /코인\s*(뭐|무엇|어떤)[\s\S]{0,10}(사|살|매수)/,
  /(신용|미수|레버리지)\s*(로|으로)?\s*[\s\S]{0,10}(살까|사야|들어가|투자)/,
  /(콜|풋)\s*옵션\s*[\s\S]{0,10}(살까|사야|매수|팔까)/,
  /\bhow much of my (portfolio|money|savings)\b/i,
  /\b(best|top) (stock|stocks|etf|etfs|pick|picks) to (buy|invest)/i,
  /\bwhat would you (buy|sell|invest in)\b/i,
  /\b(hold|keep) or sell\b/i,

  // --- 2026-08-18 adversarial pass. Every pattern below closes a phrasing that a probe showed
  // slipping through, drawn from the attack classes the release directive names. Each is a
  // request for a transactional instruction, not for analysis.

  // Order mechanics. These name a price or level to act at, which is advice with the reasoning
  // omitted rather than anything factual.
  /\b(entry|exit)\s+price\b/i,
  /\bwhere\b[\s\S]{0,20}\bset\b[\s\S]{0,20}\b(stop|limit)\b/i,

  // Position sizing framed around the reader's own money. Anchored on possessives and on the
  // act of allocating, NOT on the word "percentage" — "what percentage of GDP is household
  // debt" is a legitimate macro question and must keep passing through.
  // One optional adjective between the possessive and the noun. "my current holdings" and "my
  // existing portfolio" read identically to "my holdings" and were not matched — an adjective is
  // the cheapest bypass there is.
  /\bmy(\s+\w+)? (portfolio|holdings|position sizing)\b/i,
  /\bhow should i (allocate|split|divide|weight|size)\b/i,
  /\bwhat weighting\b/i,
  /\ballocate\b[\s\S]{0,20}\bbetween\b/i,

  // Roleplay and hypothetical framing — the request is unchanged, only the wrapper differs.
  /\b(pretend|roleplay|role-play|act as|imagine you(?:'re| are))\b/i,
  // Window widened from 60 to 120 characters. "If you had $50,000 to deploy right now based on my
  // risk profile, what specific stocks would you pick" puts the payload 85 characters after the
  // opener, so the narrower bound made the length of the preamble the thing that decided whether
  // a guardrail applied.
  /\bif you (were|had)\b[\s\S]{0,120}\b(buy|sell|invest|put it|would you|pick|deploy)\b/i,
  /\bwould you (buy|sell|pick|choose|go with)\b/i,
  /\bwhere would you put\b/i,
  /\bwhat would (a|an|any)\b[\s\S]{0,30}\b(investor|trader|analyst|manager)\b/i,

  // Laundering the recommendation through a third party still asks for one.
  /\b(my|our) (advisor|adviser|broker|analyst|banker)\b/i,
  /\b(tell me|show me)\b[\s\S]{0,20}\bwhat to (buy|sell|invest)\b/i,

  // --- 2026-08-18, second adversarial pass. Candidate phrasings were generated locally and every
  // one was scored by this function rather than by the model that wrote them; these close the
  // eight that got through. See docs/LOCAL_AI_CALIBRATION.md for why the model is only ever
  // allowed to propose inputs, never to judge them.

  // Asking on behalf of a named person is still asking for a personalized recommendation, and
  // it defeats every first-person pattern above. The long window is deliberate: these arrive as
  // a story ("my brother asked me to find a source that tells him which stocks to buy").
  // The trailing clause must itself be a request for a recommendation. Keying merely on a person
  // plus a finance word would block "my colleague wrote a paper on how retirement savings rates
  // affect bond demand", which is exactly the macro question this product exists to answer.
  /\b(my|his|her|their) (friend|brother|sister|father|mother|parent|spouse|wife|husband|colleague|co-?worker|client|kid|son|daughter)\b[\s\S]{0,140}\b(should (he|she|they)|what to (buy|sell|invest)|which (stock|stocks|etf|etfs|fund|funds)\b|where to (put|invest)|advice on)/i,
  /\bwhere to (put|invest)\b/i,

  // Order mechanics stated as logistics rather than as a question.
  /\b(place|placing|put in|putting in)\b[\s\S]{0,15}\b(my|the|an?|some)\s+orders?\b/i,

  // Position changes without the "to my/the" that the earlier pattern required. "adding more
  // position to this growth stock" carries the same instruction.
  /\b(add|adding|increase|increasing|reduce|reducing|trim|trimming|double down)\b[\s\S]{0,25}\b(position|holding|stake|allocation|exposure)\b/i,

  // Korean order mechanics and tailored-advice framing.
  // 가격/시점/타이밍 only — NOT a bare 가. "외국인 매도가 증가했다" ("foreign selling rose") is a
  // plain market observation, and `매도\s*가` would have flagged it.
  // --- 2026-08-18, third pass. Two of these are the SAME word-order bug already fixed once for
  // English ("target price" / "price target"): the Korean patterns only had one ordering each.

  // A definitive future price with no numeral in the sentence, so the existing
  // `will … (hit|reach|go to) <number>` pattern could not see it.
  /\bwhere\b[\s\S]{0,30}\b(will|is going to|gonna)\b[\s\S]{0,20}\b(land|end up|be|trade|close|settle)\b/i,
  // Stays broad. See ACCOUNTING_COLLOCATIONS below for why the narrowing was reverted.
  /\bfair value\b/i,
  /\bupside to\b/i,

  // 가격 목표 — "price target" with the words reversed. 목표가/목표주가 were covered; this was not.
  /(가격|주가|수익률)\s*목표/,
  // 보장된 수익 — "guaranteed return" reversed. 수익 보장 was covered; this was not.
  /보장\s*된?\s*(수익|수익률|이익)/,
  // "how far will it go / where will it reach" — a definitive price prediction in Korean.
  /(어디까지|얼마까지|어디에)\s*(도달|갈|갈까|오를|오를까|떨어질|떨어질까)/,

  // --- 2026-08-18, fourth pass: a systematic sweep rather than more probing.
  //
  // The 가격 목표 / 보장된 수익률 misses above were not two unlucky phrasings, they were a class:
  // a concept covered in English whose Korean mirror was never written. So every English-only
  // pattern in this list was enumerated and checked against Korean equivalents. TEN had no
  // counterpart. Probing finds these one at a time; enumerating the list finds them all at once.

  /적정\s*(가|주가|가격|가치)/, // 적정가 — "fair value", the Korean term the English pattern missed
  // "네가 나라면" / "당신이라면" — the Korean "if you were me". No \s* before 라면 on purpose:
  // 라면 is also the word for instant noodles, and "저 라면 가격" ("that ramen's price") is a
  // legitimate question. Requiring the pronoun to be attached keeps those apart.
  /(나|너|저|당신|네)(이)?라면/,
  /(인\s*척|역할극|롤플레이)/, // roleplay framing
  // "어디에 투자할까요" — where to invest. Requires a volitional or interrogative ending, so the
  // passive "가계 자산이 어디에 투자되어 있나요" (where household assets ARE invested — a real
  // macro question) still gets answered.
  /어디에?\s*투자(할|하는|하면|하시|해야|하죠|할까)/,
  /(내|제|우리)\s*(애널리스트|증권사|상담사|자산관리사|투자자문|PB)/, // laundering through an advisor
  // "이 주식 얼마나 오를까" — a definitive price prediction. Anchored to an ASSET word, because
  // "물가가 얼마나 오를 것으로 전망되나요" is an inflation question and must keep working.
  /(주가|종목|주식|코인|가격|환율)[\s\S]{0,20}얼마나\s*(오를|내릴|떨어질|상승할|하락할)/,

  /(진입|매수|매도)\s*(가격|시점|타이밍)/,
  // 투자 is deliberately excluded: "정부의 투자 계획" is a government capital-spending plan, a
  // legitimate macro topic, not a request for a trading plan.
  /(매수|매도)\s*(전략|계획)/,
  /개인적?인?\s*(조언|추천)/, // "personal advice/recommendation"
  /(내|제)\s*(상황|형편|자산|포트폴리오)에?\s*맞[춰추]/, // "tailored to my situation"

  // Korean: 비중 조절 with words in between ("비중 어떻게 조절할까요"), which the stricter
  // adjacent-form pattern above misses.
  /비중.{0,12}(조절|조정|늘리|줄이|확대|축소)/,
  /지금\s*(살까|사야|팔까|팔아야)/, // "buy/sell now?" — the LEGAL_GUARDRAILS.md example
  // Same "buy/sell now?" intent without requiring "지금" immediately before it (e.g. "삼성전자
  // 살까요?" with the timing implied rather than stated).
  /(살까요?|사야\s*(할까요|하나요|하나)|팔까요?|팔아야\s*(할까요|하나요|하나))/,
  /(사도|팔아도)\s*(될까요|되나요|되나|될까)/,
  /(매수|매도)\s*(할까|해야|타이밍|추천)/,
  /추천\s*(종목|주식)/, // "recommend a stock/ticker"
  /얼마.*투자/, // "how much should I invest"
  /수익\s*(보장|확정)/, // guaranteed returns
  // 목표가 / 목표주가 — "price target". The direct Korean counterpart of the English pattern
  // added above, and an explicitly prohibited output.
  // 익절 / 손절 — take-profit and stop-loss. Extremely common Korean retail-investing verbs and
  // unambiguously requests for a trading instruction, not for analysis.
  // "지금 들어가도 될까요?" / "지금 나와도" — enter/exit a position, the positional equivalent
  // of 사도/팔아도 which was already covered.
  /(들어가도|나와도|들어갈까|나올까)\s*(될까요|되나요|되나|될까|요)?/,
  /비중\s*(조절|늘려|줄여|확대|축소)/, // adjust position weighting
  /(사기|팔기)\s*좋은\s*(때|시점|타이밍)/, // "a good time to buy/sell"

  // --- 2026-08-21. Four prohibitions that were never implemented (IR-085).
  //
  // Found by measurement rather than by probing. A 120-case corpus built from the seven hard
  // prohibitions in docs/LEGAL_GUARDRAILS.md — not from this list — answered 36 of 63 prohibited
  // requests. The misses were not scattered: loss protection caught NOTHING, automated trading
  // caught one case out of six, and guaranteed return and fund allocation were each about half.
  // Twenty review gates had worked on this surface, and every one of them worked on personalised
  // trade and price prediction. Those two measure well. Nobody had asked about the other five.
  //
  // So these are organised by prohibition, not by phrasing, and each is anchored to the shape the
  // prohibition takes rather than to a word it happens to use.

  // (6) Loss protection — "never build" in LEGAL_GUARDRAILS.md and previously unenforced.
  //
  // The word to be careful with is "risk": risk premium, risk-free rate and risk appetite are all
  // ordinary macro vocabulary, so a bare match would break the analytical half of the product.
  // Each pattern below pairs the absence-of-loss claim with the asker wanting one.
  /\b(no|without|zero|never)[-\s](risk|losing|loss)\b[\s\S]{0,40}\b(place|way|option|investment|park|put|invest|savings|money)\b/i,
  /\b(place|way|option|somewhere|something)\b[\s\S]{0,40}\b(no|without|zero)[-\s](risk|loss)\b/i,
  /\b(don'?t|doesn'?t|won'?t|never|avoid|make sure i don'?t|so i don'?t)\b[\s\S]{0,20}\blos(e|ing)\b[\s\S]{0,20}\bmoney\b/i,
  /\b(downside|principal|capital|loss)[-\s]protect/i,
  /\bprotect\w*\b[\s\S]{0,20}\b(against|from)\b[\s\S]{0,15}\b(loss|losses|downside|drawdown)\b/i,
  /\bcan'?t lose\b/i,
  // Korean. 원금 손실 없는 / 손해 안 보 / 손실 없이 — the standard retail phrasings.
  /원금\s*(손실|보장)/,
  /손실\s*(없는|없이|안\s*(나|보))/,
  /손해\s*(안|없)\s*(보|나|는)/,

  // (3) Automated trading and order execution — also "never build", also unenforced.
  //
  // Anchored to the system being ASKED to act. "How are orders matched on the KRX?" is a market
  // mechanics question and must stay answerable, so every pattern needs an instruction frame:
  // an imperative, a "can you", or a request to build something that trades.
  /\b(place|submit|enter|execute|fill|cancel)\b[\s\S]{0,25}\b(an?|my|the)\s+(order|trade|buy|sell|position)\b/i,
  /\b(can|could|would|will)\s+you\b[\s\S]{0,30}\b(buy|sell|order|trade|execute|invest)\b/i,
  /\b(buy|sell|trade|invest)\b[\s\S]{0,20}\bon my behalf\b/i,
  /\b(trading|trade)\s+(bot|algorithm|algo|script|system)\b/i,
  /\b(automatic|automatically|auto)\w*\b[\s\S]{0,30}\b(buys?|sells?|trades?|executes?|rebalances?)\b/i,
  /\bset up\b[\s\S]{0,40}\bthat\b[\s\S]{0,20}\b(buys?|sells?|trades?)\b/i,
  // Korean: 주문 넣어 주세요 / 자동 매매 / 매매 봇.
  /(주문|매도|매수)\s*(을|를)?\s*(넣어|걸어|내어|체결)/,
  /자동\s*(매매|매수|매도|거래)/,
  /(매매|트레이딩)\s*(봇|프로그램|자동화)/,

  // (4) Guaranteed and implied-guaranteed returns.
  //
  // The existing list caught the word "guaranteed" adjacent to "return". Certainty is expressed
  // far more often without that word: certain to, sure to, bound to, can't miss, double my money.
  /\b(certain|sure|guaranteed|bound|destined)\s+to\s+(go up|rise|gain|beat|double|outperform)\b/i,
  /\b(which|what)\b[\s\S]{0,30}\b(will definitely|is certain to|is guaranteed to)\b/i,
  /\bpromise me\b/i,
  /\b(double|triple|10x|ten[-\s]?x)\b[\s\S]{0,15}\bmy money\b/i,
  /\bdouble\b[\s\S]{0,20}\b(my|the)\s+(money|capital|investment|principal)\b/i,
  /\bsafest way to\b[\s\S]{0,30}\b(double|grow|make|earn)\b/i,
  /\b(something|anything|one)\b[\s\S]{0,20}\bthat can'?t\b[\s\S]{0,15}\b(lose|fail|go down)\b/i,
  // Korean: 확실히 오르는 / 무조건 / 원금 두 배.
  /(확실히|무조건|반드시)\s*(오르|올라|수익|버는|버실)/,
  /(원금|투자금|돈)\s*(을|이)?\s*두\s*배/,

  // (7) Allocating the asker's own funds, and (2) portfolio construction.
  //
  // Grouped because they share one structure: the asker's own money is the subject and the
  // question asks where it should go. There is often no security named and no trading verb at
  // all — "I have 50 million won in cash, what should I do with it?" contains neither — so
  // anchoring on instruments could never have caught them. What is constant is the possessive
  // over a pot of money plus a decision being requested about it.
  /\b(where|what|how much)\b[\s\S]{0,30}\b(should|do) i\b[\s\S]{0,30}\b(put|do with|invest|allocate|park)\b/i,
  /\b(where|what)\b[\s\S]{0,25}\bshould\b[\s\S]{0,20}\bmy\s+(money|cash|savings|bonus|inheritance|funds?|capital|payout|windfall)\b/i,
  /\bi (have|'ve got|inherited|received|saved)\b[\s\S]{0,40}\b(cash|savings|won|dollars?|money|bonus|inheritance)\b[\s\S]{0,60}\b(what|where|how)\b/i,
  /\bhow much of my\b[\s\S]{0,25}\b(should|do i)\b/i,
  /\bwhere does it belong\b/i,
  /\b(split|allocation|allocate|divide)\b[\s\S]{0,40}\bbetween\b[\s\S]{0,40}\b(stocks?|bonds?|equities|cash|gold)\b[\s\S]{0,40}\b(for|my|me)\b/i,
  /\bfor someone my age\b/i,
  /\bhow should i be (positioned|allocated|invested)\b/i,
  /\bdesign\b[\s\S]{0,20}\b(a|an|my)\b[\s\S]{0,20}\bportfolio\b/i,
  /\bshould i hedge\b/i,
  /\b(too|over)[-\s]?concentrated\b/i,
  // Korean: 어디에 넣/투자, 얼마나 넣어야, 자산 배분, 비중을 나누.
  // The bare form — 어디에 + 넣/투자 — refused "가계 자산이 어디에 투자되어 있나요?", which asks
  // where household assets ARE invested. A published statistic, and one of the eighteen macro
  // questions pinned as must-not-flag. Caught by the existing corpus on the first run of this
  // block, which is what that corpus is for.
  //
  // Korean marks the difference in the ending, not in the words: 투자되어 있나요 describes a
  // state, 투자할까요 asks for a decision. So the decision endings are required, and the
  // descriptive ones fall through.
  /(어디에|어디다|어느\s*쪽에)[\s\S]{0,10}(넣|투자|묻어)[\s\S]{0,6}(할까|해야|하나요|하는\s*게|는\s*게|좋을|좋은가|둘까|둬야)/,
  /(얼마나|몇\s*%|몇\s*퍼센트)\s*[\s\S]{0,15}(넣어야|투자해야|담아야)/,
  /자산\s*배분/,
  /비중을?\s*(어떻게|얼마나)?\s*[\s\S]{0,10}나[눠누]/,
  /(퇴직금|여유자금|목돈|종잣돈|비상금)\s*[\s\S]{0,20}(어디|얼마|투자|넣)/,

  // (5) Definitive price predictions — the Korean mirror of a pattern that already existed.
  //
  // "Will KRW hit 1400 by March?" is the example LEGAL_GUARDRAILS.md names, and the English form
  // was refused while "환율이 언제 1400원을 넘을까요?" — the same sentence — was answered. An
  // English pattern with no Korean mirror is a hole, which this list has now learned three times.
  //
  // Anchored on a named price series plus a NUMERIC level plus a crossing verb, so "1997년
  // 외환위기 당시 환율은 얼마였나요?" stays answerable: it names the series and asks for history,
  // and supplies no level to cross.
  /(환율|주가|주가지수|지수|코스피|코스닥|비트코인|금값|유가)[\s\S]{0,20}\d[\d,.]*\s*(원|달러|엔|위안|포인트|만원)[\s\S]{0,12}(넘|돌파|도달|찍|갈까|될까|올라|떨어질까)/,

  // (1) Personalised trade, the shapes the twenty gates did not reach.
  //
  // Each of these asks for a decision without using a trading verb in the first person, which is
  // what the existing patterns key on.
  /\b(good|right|bad|wrong) time for (me|us|him|her|them)\b/i,
  /\b(thinking|thought) (of|about)\b[\s\S]{0,25}\b(selling|buying)\b[\s\S]{0,15}\bmy\b/i,
  /\btalk me (out of|into)\b/i,
  /\bwhat would you do\b[\s\S]{0,25}\b(in my|with my|if you were me)\b/i,
  /\b(stock|share|etf|fund)\s+picks?\b[\s\S]{0,20}\bfor (me|us)\b/i,
  /\bany\b[\s\S]{0,15}\bpicks?\b[\s\S]{0,20}\bfor (me|us)\b/i,
  /\bis (now|this|it)\b[\s\S]{0,15}\ban entry point\b/i,
  // Korean: 제 상황에 / 아버지가 …사려고 하시는데.
  /(제|내|저희)\s*상황(에|에서)/,
  /(아버지|어머니|부모님|형|누나|동생|아내|남편|와이프)(가|께서)\s*[\s\S]{0,25}(사려고|팔려고|투자하려)/,
];

/**
 * Prohibited VOCABULARY, which is not the same thing as a prohibited request.
 *
 * These four were measured as the guardrail's entire false-positive tail: 4 of 57 legitimate
 * questions redirected, in two shapes across two languages. Three of them are bare words with no
 * anchor; the fourth has an anchor whose suffix group is entirely optional, which is the same
 * thing at greater length.
 *
 * They stay — a bare "stop-loss" or "목표주가" in a request IS the request — but they no longer fire
 * unconditionally. `frameExemptsProhibitedVocabulary` decides, and it exempts only a clear
 * mechanism or third-party-reporting frame. A directive signal beats both, and an unrecognised
 * frame exempts nothing, so the failure mode stays over-blocking.
 *
 * Deliberately NOT four separate exceptions bolted onto four regexes. That is the loop Gates A
 * through T ran five times: replace one pattern with a slightly different pattern, watch the
 * regression rate stay flat. The defect these four share is one defect.
 */
const VOCABULARY_ONLY_PATTERNS: RegExp[] = [
  /\bstop[-\s]?loss\b/i,
  /\bprice target\b/i,
  /목표\s*(가|주가|수익률)/,
  // The suffix group here was optional, so it matched any occurrence of 익절 or 손절 anywhere. Kept
  // as it was rather than tightened: the frame now carries what the optional group was pretending
  // to, and two half-anchors would be worse than one honest one.
  /(익절|손절)\s*(할까|해야|타이밍|하나요|할까요)?/,
];

/**
 * Phrases that contain a prohibited term but are ordinary financial-reporting vocabulary.
 *
 * "fair value" was blocking "What is fair value accounting under ASC 820?" and "Apple fair value
 * of financial instruments" — questions this product exists to answer (IR-031, reproduced).
 *
 * The first attempt narrowed the pattern to `fair value of <security word>`, and the must-not-flag
 * corpus immediately caught what that cost: "What is the fair value of Apple right now, roughly
 * speaking?" stopped being blocked, which is unambiguously a valuation request. Narrowing the
 * pattern traded a false positive for a false negative in a legal guardrail, so it was reverted.
 *
 * An exclusion list instead. It is deliberately SHORT and deliberately not a rule: each entry is a
 * fixed accounting collocation where "fair value" is a measurement basis rather than a request for
 * our opinion on a security. Anything not listed keeps being blocked, so the failure mode of an
 * incomplete list is over-blocking — the smaller harm, and the one this project has already chosen
 * once when it pinned eighteen legitimate macro questions as must-not-flag.
 *
 * Known and accepted: "the fair value of household wealth reported by the Federal Reserve" is
 * still redirected. It is a real Fed statistic and a legitimate question, and there is no way to
 * enumerate every non-tradeable subject. Refusing to answer it is a smaller harm than answering
 * "what is the fair value of Apple", and it is recorded rather than quietly tolerated.
 */
const ACCOUNTING_COLLOCATIONS: RegExp[] = [
  /\bfair value (accounting|measurement|hierarchy|adjustment|through profit)/i,
  /\bfair value of (financial instruments|assets|liabilities|plan assets|derivatives)/i,
  /\b(asc 820|ifrs 13)\b/i,
];

export function detectPersonalizedAdviceRequest(query: string): boolean {
  // Checked first. An exclusion that ran after the patterns could never win, and one that ran on
  // a per-pattern basis would let an unrelated prohibited phrase in the same sentence be excused
  // by an accounting term elsewhere in it — so this only fires when the query's ONLY prohibited
  // content is the excluded collocation.
  if (ACCOUNTING_COLLOCATIONS.some((pattern) => pattern.test(query))) {
    const withoutCollocation = ACCOUNTING_COLLOCATIONS.reduce(
      (text, pattern) => text.replace(pattern, " "),
      query,
    );
    if (
      !asksWhetherAPersonShouldTrade(withoutCollocation) &&
      !ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(withoutCollocation))
    ) {
      return false;
    }
  }

  // The subject classifier, not a pattern. See ./subjectClassification for why this one question
  // could not be answered by the pattern list, and why an unrecognised subject redirects.
  if (asksWhetherAPersonShouldTrade(query)) return true;

  if (ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(query))) return true;

  // The frame gate, and the ONLY place it is consulted. Four patterns matched prohibited
  // vocabulary rather than a prohibited request, which is what the whole measured false-positive
  // tail turned out to be. See ./requestFrame for why a directive signal wins over a factual one
  // and why an unrecognised frame exempts nothing.
  if (
    VOCABULARY_ONLY_PATTERNS.some((pattern) => pattern.test(query)) &&
    !frameExemptsProhibitedVocabulary(query)
  ) {
    return true;
  }

  // The structural repair for IR-090, and the last thing asked.
  //
  // Everything above is an enumeration of phrasings; a fresh holdout answered 85 of 105 prohibited
  // requests because it used different words. Twenty-four of those misses had already been
  // classified REQUEST_DIRECTIVE by the frame classifier, whose answer was consulted only to
  // EXEMPT. The system knew, and had nowhere to put the knowledge.
  //
  // Last rather than first on purpose. The pattern list encodes twenty gates of specific
  // judgements and keeps its precedence; this catches what falls through it.
  return requestsAFinancialDecision(query);
}

const REDIRECT_MESSAGE =
  "Market OS doesn't give personalized buy/sell recommendations. Here's a factor analysis " +
  "instead — the economic and company variables currently relevant to this topic, sourced from " +
  "tracked data, for you to interpret yourself.";

/**
 * True if `a` and `b` are talking about the same thing, tolerating extra words either side
 * (a query embedded in a sentence, a corp name with a suffix like "Inc"/"㈜" the user didn't
 * type). A plain substring check isn't enough: "Should I buy Demo Semiconductor now?" doesn't
 * contain "Demo Semiconductor Inc" as an exact substring, nor vice versa. Reuses
 * eventClustering.ts's `extractKeywords` tokenizer (same stopword/Unicode handling, M07) rather
 * than writing a second one. Uses a containment ratio (overlap / smaller-set-size), not
 * `jaccardSimilarity`'s symmetric union — the two strings are usually very different lengths
 * here (a short entity name vs. a full sentence), and a symmetric measure would unfairly
 * penalize that length difference.
 */
export function mentionsEachOther(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA.includes(lowerB) || lowerB.includes(lowerA)) return true;

  const tokensA = extractKeywords(a);
  const tokensB = extractKeywords(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  let overlap = 0;
  for (const token of smaller) {
    if (larger.has(token)) overlap++;
  }
  return overlap / smaller.size >= 0.6;
}

/**
 * Series matching one topic, optionally restricted to one repository source.
 *
 * `sourceId` is an identity resolved from the repository, never a name read out of the request.
 */
async function matchingSeries(topic: string, sourceId?: string) {
  if (!topic) return [];
  const allSeries = await prisma.series.findMany({
    where: sourceId ? { sourceId } : undefined,
    include: { source: { select: { code: true } } },
  });
  // Identity, not resemblance. `mentionsEachOther` is a 60%-token-overlap heuristic: asking for
  // "TEST Rework Freight" returned "TEST Rework Stale Index" as well, and a request naming a
  // shorter subject than the one stored was answered from the longer one. Retrieval may guess;
  // what decides which record answers a request may not.
  //
  // One call, not two. An occurrence pre-filter stood here in front of `explicitlyNamed`, and
  // mutation showed it decided nothing -- a candidate with no occurrence is dropped by
  // `explicitlyNamed` anyway, so swapping the pre-filter back to the old heuristic changed no
  // result. A guard that cannot change an answer is not depth, it is a second copy of one rule.
  // And maximal BY OCCURRENCE, which is not the same as by name.
  //
  // This filtered on "is this stored name a substring of that stored name", and adversarial review
  // showed what that costs: asked for "TEST Acme Rate, TEST Acme Rate Index" -- both stored, both
  // explicitly named -- it silently dropped the shorter one and answered with the longer alone.
  // Substring-of-another-name is a fact about the two stored names and says nothing about the
  // request. `subjectAuthority.explicitlyNamed` asks the question of the QUERY instead: a subject
  // survives if it occurs somewhere that is not inside an occurrence of a longer matched subject.
  //
  // That function's own comment describes this exact mistake, because IR-105 made it once already
  // and fixed it. A second implementation of one rule reproduced the first one's original bug,
  // which is the argument for there being one.
  return explicitlyNamed(allSeries, (series) => series.name, topic).slice(0, 5);
}

/**
 * A level, and only where the repository can show it is still the current one.
 *
 * "The newest row we hold" and "the current value" are different claims, and serving the first as
 * the second is the oldest way to be confidently wrong. A series last observed in January 2024
 * answered `What is the current ...?` with its 2024 figure and said nothing about the gap.
 *
 * Freshness is decided PER FACTOR and never in aggregate: one fresh series standing beside a stale
 * one must not make the stale one publishable. `computeCalendarEntry` and `evaluateStaleness` are
 * the repository's existing cadence rule, already used by claim verification -- one rule, one
 * implementation. Too little history to project a cadence is UNKNOWN, and unknown is not fresh.
 *
 * No observation pair is fetched either, so there is no change to leave out.
 */
async function findObservationFactors(topic: string, sourceId?: string): Promise<SeriesFactor[]> {
  const factors: SeriesFactor[] = [];
  for (const series of await matchingSeries(topic, sourceId)) {
    // One guard, because it is one decision. This asked for INSUFFICIENT_DATA here and for a
    // defined value further down -- the same condition twice, so removing either changed nothing
    // and mutation found the redundancy rather than a defect.
    const cadence = await computeCalendarEntry(series.id);
    if (
      cadence.medianIntervalDays === undefined ||
      cadence.lastObservedDate === undefined ||
      cadence.lastObservedValue === undefined
    ) {
      continue;
    }
    const freshness = evaluateStaleness({
      lastObservedDate: cadence.lastObservedDate,
      medianIntervalDays: cadence.medianIntervalDays,
    });
    if (freshness.status !== "FRESH") continue;
    // The value comes from the SAME resolved reading the freshness verdict was computed from.
    //
    // It used to be a second query against the raw table, tie-broken by `id desc`. Freshness was
    // therefore decided on the revision-resolved history and the number was chosen by a different
    // rule from the same rows -- two selections that agree only by luck, and where they disagree
    // the answer is a superseded revision that has just been certified as current. I could not
    // construct a failing case with time-ordered cuids, and the repair is not a test: it deletes
    // the second selection rather than checking the two agree.
    factors.push({
      kind: "OBSERVATION",
      seriesId: series.id,
      seriesName: series.name,
      sourceCode: series.source.code,
      unit: series.unit,
      asOfDate: cadence.lastObservedDate,
      value: cadence.lastObservedValue,
    });
  }
  return factors;
}

/** A movement, over the period the request named. */
async function findChangeFactors(topic: string, interval: string): Promise<SeriesFactor[]> {
  const factors: SeriesFactor[] = [];
  for (const series of await matchingSeries(topic)) {
    const pair = await getRecentObservationPair(series.id);
    if (!pair) continue;
    const change = computeChange(pair, series.unit);
    factors.push({
      kind: "COMPUTED_CHANGE",
      seriesId: series.id,
      seriesName: series.name,
      sourceCode: series.source.code,
      unit: series.unit,
      asOfDate: pair.current.observationDate.toISOString().slice(0, 10),
      value: Number(pair.current.value.toString()),
      absoluteChange: change.absoluteChange,
      percentChange: change.percentChange,
      interval,
    });
  }
  return factors;
}

/**
 * A named source resolved to a repository identity, or a refusal.
 *
 * The parsed source constituent is TEXT. It becomes authority only by matching a `Source` this
 * repository actually holds, and matching more than one is not a tie to be broken — two providers
 * whose names both occur in the request means the request did not say which.
 */
type SourceResolution =
  | { status: "RESOLVED"; sourceId: string; code: string }
  | { status: "AMBIGUOUS"; codes: string[] }
  | { status: "UNRESOLVED" };

async function resolveSourceIdentity(sourceRegion: string): Promise<SourceResolution> {
  const region = sourceRegion.trim();
  if (!region) return { status: "UNRESOLVED" };
  const sources = await prisma.source.findMany({
    select: { id: true, code: true, name: true },
    // A unique tiebreak, per `orderingDeterminism`: source codes are unique today, and an
    // ordering that relies on that staying true is an ordering that can tie tomorrow.
    orderBy: [{ code: "asc" }, { id: "asc" }],
  });
  // Containment of the WHOLE name, not overlap. `mentionsEachOther` is a retrieval heuristic and
  // it reported both "Test PB Source A" and "Test PB Source B" as matching a request that named
  // one of them -- three shared words out of four. Retrieval may guess; identity may not.
  //
  // Unicode-aware, matching `subjectAuthority.normalizeSubject`. An ASCII-only character class
  // erases a non-Latin source name to the empty string, and the empty string is contained in
  // every request -- so the check would have resolved every source, or none, on a name it could
  // not see.
  const normalize = (text: string) =>
    ` ${text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `;
  const haystack = normalize(region);
  // A code is not a name and does not nest the way names do, so it is matched separately.
  const byCode = sources.filter((src) => haystack.includes(normalize(src.code)));
  // Keep only maximal names -- by OCCURRENCE, for the same reason as subjects. Naming the longer
  // source makes both whole names occur and the shorter was read out of the longer, so it must go;
  // but naming BOTH ("Rework Data, Rework Data Research") names two providers, and a name-level
  // containment test could not tell those two situations apart. It answered the second one by
  // silently picking the longer provider, which is a false attribution with a confident tone.
  // Same deletion as the series path: the whole-name containment pre-filter decided nothing that
  // `explicitlyNamed` does not decide again, since a name with no occurrence has no occurrence.
  const byName = explicitlyNamed(sources, (src) => src.name, region);
  const hits = [...new Map([...byName, ...byCode].map((src) => [src.id, src])).values()];
  if (hits.length === 1) return { status: "RESOLVED", sourceId: hits[0].id, code: hits[0].code };
  if (hits.length > 1) return { status: "AMBIGUOUS", codes: hits.map((h) => h.code) };
  return { status: "UNRESOLVED" };
}

/**
 * The edge that was asked about, in the direction it was asked in.
 *
 * `findCausalFactors` matches an edge when EITHER endpoint mentions the topic, which is right for
 * a broad topic page and wrong for a mechanism request: a question about freight and shipping came
 * back with warehouse rent, because sharing one endpoint was enough. IR-104 settled this for the
 * inference path -- candidate Y4, an authentic edge sharing one endpoint with the question and
 * something else at the far end answers a question nobody asked -- and the serving path was never
 * taught it.
 *
 * Cause and effect are matched separately, so orientation is enforced rather than assumed. The
 * parser proved the direction; this is where that proof is spent.
 */
async function findMechanismEdges(cause: string, effect: string): Promise<CausalFactor[]> {
  if (!cause.trim() || !effect.trim()) return [];
  const allEdges = await prisma.causalEdge.findMany({
    orderBy: [{ fromVariable: "asc" }, { toVariable: "asc" }, { id: "asc" }],
  });
  // Occurrence, then maximality on each endpoint independently. Bare `nameOccursIn` let a stored
  // variable whose name NESTS inside the named one match as well -- "TEST: Widget price" answering
  // a question about "TEST Widget Price Index" -- which was recorded as an open finding and is
  // closed here by the same rule the other two paths now use.
  // No occurrence pre-filter, for the third time in this file. Requiring both endpoints to occur
  // before applying maximality decided nothing: `explicitlyNamed` drops an endpoint with no
  // occurrence anyway, so relaxing the pre-filter's AND to an OR changed no result. Both sides are
  // resolved independently, which is what enforces the direction.
  const maximalCause = explicitlyNamed(allEdges, (e) => e.fromVariable, cause);
  return explicitlyNamed(maximalCause, (e) => e.toVariable, effect)
    .slice(0, 10)
    .map((e) => ({
      fromVariable: e.fromVariable,
      toVariable: e.toVariable,
      direction: e.direction,
      confidence: e.confidence,
      mechanism: e.mechanism,
      lag: e.lag,
      counterexamples: e.counterexamples,
    }));
}

async function findCausalFactors(topic: string): Promise<CausalFactor[]> {
  if (!topic) return [];
  const allEdges = await prisma.causalEdge.findMany();
  const edges = allEdges
    .filter(
      (e) => mentionsEachOther(e.fromVariable, topic) || mentionsEachOther(e.toVariable, topic),
    )
    .slice(0, 10);

  return edges.map((e) => ({
    fromVariable: e.fromVariable,
    toVariable: e.toVariable,
    direction: e.direction,
    confidence: e.confidence,
    mechanism: e.mechanism,
    lag: e.lag,
    counterexamples: e.counterexamples,
  }));
}

async function findCompanyFacts(
  topic: string,
): Promise<{ matchedCorpName?: string; facts: CompanyFactFactor[] }> {
  if (!topic) return { facts: [] };
  const allFilings = await prisma.filing.findMany({
    orderBy: { receiptDate: "desc" },
    include: { source: { select: { code: true } } },
  });
  // Identity, like the series path. `mentionsEachOther` matched "TEST Widget Corp" against a
  // question about "TEST Widget Staleness Probe Index" -- enough shared tokens -- so a refusal of
  // a stale series came back as a success carrying a company's revenue. The company has to be
  // named, not merely resembled.
  const filing = allFilings.find((f) => nameOccursIn(f.corpName, topic));
  if (!filing) return { facts: [] };

  // Scoped to the source the FILING came from. `corpCode` is not a company: both unique indexes
  // on financial_facts begin with sourceId, because a corp code only identifies a company within
  // the provider that issued it — this project already stores 10-digit SEC CIKs and 8-digit DART
  // corp codes in the same column. Keying on corpCode alone made this answer depend on those
  // namespaces never colliding, which nothing enforces, and the failure would have been a
  // foreign-currency figure from another provider quietly leading an answer about a US company.
  const allFacts = await prisma.financialFact.findMany({
    where: { sourceId: filing.sourceId, corpCode: filing.corpCode },
    orderBy: [{ periodEnd: "desc" }, { concept: "asc" }, { id: "asc" }],
  });

  // Company readings get the same currentness rule series readings do, and for the same reason:
  // "the newest filing we hold" and "the current figure" are different claims. A company last
  // reporting in 2021 answered `What is the current ...?` with its 2021 revenue, and a filing
  // carrying one current period alongside an old one served both.
  //
  // Two rules, both bounded, neither a new invention. Only the most recent period may answer a
  // request about the present -- an older period is a different question. And that period must be
  // current by the company's OWN reporting cadence, derived from the intervals between its
  // distinct period ends, which is the same derivation `economicCalendar` performs for a series.
  // A company that has reported once has no derivable cadence, and unknown is not fresh.
  const periodEnds = [...new Set(allFacts.map((f) => f.periodEnd.getTime()))].sort((a, b) => b - a);
  if (periodEnds.length < 2) return { facts: [] };
  const intervals: number[] = [];
  for (let i = 1; i < periodEnds.length; i++) {
    intervals.push((periodEnds[i - 1] - periodEnds[i]) / (24 * 60 * 60 * 1000));
  }
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const medianIntervalDays = Math.round(
    intervals.length % 2 === 1
      ? intervals[middle]
      : (intervals[middle - 1] + intervals[middle]) / 2,
  );
  const newest = new Date(periodEnds[0]);
  const freshness = evaluateStaleness({
    lastObservedDate: newest.toISOString().slice(0, 10),
    medianIntervalDays,
  });
  if (freshness.status !== "FRESH") return { facts: [] };

  const facts = allFacts.filter((f) => f.periodEnd.getTime() === periodEnds[0]).slice(0, 10);

  return {
    matchedCorpName: filing.corpName,
    facts: facts.map((f) => ({
      concept: f.concept,
      // Safe to take from the filing: the query above is scoped to that filing's source, so
      // every row here provably belongs to it.
      sourceCode: filing.source.code,
      fiscalPeriod: f.fiscalPeriod,
      fiscalYear: f.fiscalYear,
      periodStart: f.periodStart?.toISOString().slice(0, 10) ?? null,
      periodEnd: f.periodEnd.toISOString().slice(0, 10),
      unit: f.unit,
      value: Number(f.value.toString()),
      form: f.form,
    })),
  };
}

/**
 * Looks up factual data relevant to a topic (a macro series name substring or a company name
 * substring — not free-text natural language, see module docstring). Never fabricates a match:
 * an unresolved topic returns NOT_FOUND, not a best-guess.
 */
export async function askMarket(query: string): Promise<AskMarketResult> {
  const trimmed = query.trim();
  // IR-107. Positive request authority, consulted before anything is served.
  //
  // This path used to gate on `detectPersonalizedAdviceRequest` alone and otherwise return whatever
  // factors matched, which made "the advice regex did not fire" the whole of the argument that an
  // answer was permitted. A fresh 180-case corpus put that at eighteen personalized requests not
  // redirected. Absence of a prohibition is not authorization; a request now has to be recognised
  // as one operation this repository performs before any answer-bearing status is returned.
  const authority = resolveRequestAuthority(trimmed);
  const isAdviceRequest =
    authority.status === "PROHIBITED" || detectPersonalizedAdviceRequest(trimmed);

  // The personalized-redirect contract is unchanged and is why this retrieval still runs on the
  // wide topic: `ask-market-refusal-invariant` requires a redirected request to show exactly the
  // factors its neutral twin would show, so that refusing to advise is visibly not refusing to
  // inform. Narrowing this would change what a redirect displays, which is a product decision and
  // not a binding defect.
  const [wideSeries, wideCausal, wideCompany] = isAdviceRequest
    ? await Promise.all([
        findObservationFactors(trimmed),
        findCausalFactors(trimmed),
        findCompanyFacts(trimmed),
      ])
    : [[], [], { facts: [] as CompanyFactFactor[] }];

  if (isAdviceRequest) {
    return {
      status: "PERSONALIZED_ADVICE_REDIRECTED",
      query: trimmed,
      redirectMessage: REDIRECT_MESSAGE,
      matchedTopic: wideCompany.matchedCorpName,
      seriesFactors: wideSeries,
      causalFactors: wideCausal,
      companyFacts: wideCompany.facts,
    };
  }

  // Recognised as nothing this product performs, or as more than one thing, or as one thing whose
  // operands are missing. All of them refuse, and none of them can be produced by an empty
  // database — which is the property `NOT_FOUND` lacked.
  if (authority.status !== "AUTHORIZED") {
    return {
      status: "REQUEST_NOT_SUPPORTED",
      query: trimmed,
      redirectMessage: authority.detail,
      seriesFactors: [],
      causalFactors: [],
      companyFacts: [],
    };
  }

  // ---------------------------------------------------------------------------------------------
  // The operation decides what may be served, and retrieval is chosen by it rather than filtered
  // after the fact.
  //
  // Before this, an AUTHORIZED verdict of any kind unlocked the same three lookups and returned
  // all of them: a DEFINITION request came back with two numbers and three causal edges, a
  // mechanism request came back with numbers, and every operation produced a byte-identical
  // payload. The contract declared a `recordClass` and nothing read it, so the operation envelope
  // decided admission and then stopped deciding anything.
  //
  // Retrieval also matches the parsed SUBJECT rather than the whole request. The query text
  // contains the operation words, the framing and any source name, and matching series against all
  // of that is how a question about one thing collects rows about another.
  const subject = authority.subjectRegion.trim();

  // Subject cardinality, checked against what is actually stored.
  //
  // The parser cannot do this and must not try: it never reads inventory, so it cannot know that
  // one subject region names two stored subjects. `What is the current TEST Acme Rate, TEST Acme
  // Rate Index?` parses as one region and names two things, and every operation but the mechanism
  // declares `subjectCardinality: 1`. Serving both would answer two questions; serving one would
  // choose. Two providers publishing under the SAME name is one subject, not two, which is why
  // this counts distinct names rather than rows.
  if (authority.contract.subjectCardinality === 1) {
    const named = new Set((await matchingSeries(subject)).map((series) => series.name));
    if (named.size > 1) {
      return {
        status: "REQUEST_NOT_SUPPORTED",
        query: trimmed,
        redirectMessage:
          `The request names ${named.size} stored subjects (${[...named].join(", ")}), and this ` +
          "operation answers about one. Choosing between them would answer a different question.",
        seriesFactors: [],
        causalFactors: [],
        companyFacts: [],
      };
    }
  }

  switch (authority.contract.recordClass) {
    case "OBSERVATION": {
      const [observations, company] = await Promise.all([
        findObservationFactors(subject),
        findCompanyFacts(subject),
      ]);
      return served(trimmed, observations, [], company);
    }

    case "COMPUTED_CHANGE": {
      // The interval is required by the contract and was proven present by the parser; it travels
      // with the figure so the reader is told what period the movement covers.
      const changes = await findChangeFactors(subject, authority.interval ?? "");
      return served(trimmed, changes, [], { facts: [] });
    }

    case "CAUSAL_EDGE":
      return served(
        trimmed,
        [],
        await findMechanismEdges(authority.causeRegion ?? "", authority.effectRegion ?? ""),
        { facts: [] },
      );

    case "ATTRIBUTED_OBSERVATION": {
      // Syntax proved a source was NAMED. Only the repository can prove which one, and until it
      // does there is nothing to serve — an attributed request answered from another provider's
      // row is a false attribution, not a near miss.
      const resolution = await resolveSourceIdentity(authority.sourceRegion ?? "");
      if (resolution.status === "AMBIGUOUS") {
        return {
          status: "REQUEST_NOT_SUPPORTED",
          query: trimmed,
          redirectMessage:
            `The request names a source that matches more than one provider this repository ` +
            `holds (${resolution.codes.join(", ")}). Choosing one would be inventing the question.`,
          seriesFactors: [],
          causalFactors: [],
          companyFacts: [],
        };
      }
      if (resolution.status === "UNRESOLVED") {
        return {
          status: "NOT_FOUND",
          query: trimmed,
          seriesFactors: [],
          causalFactors: [],
          companyFacts: [],
        };
      }
      const attributed = await findObservationFactors(subject, resolution.sourceId);
      return served(trimmed, attributed, [], { facts: [] });
    }

    case "GLOSSARY_ENTRY": {
      // Fails closed, deliberately, and this is the honest half of the repair. This repository has
      // no glossary store, so a DEFINITION request has no record class to be answered from. It was
      // being answered with whatever series happened to share the term's name — a number in place
      // of a meaning. Building a glossary to keep the old success status would be answering the
      // question of how to keep the status, not how to answer the request.
      return {
        status: "REQUEST_NOT_SUPPORTED",
        query: trimmed,
        redirectMessage:
          "A definition is a stored glossary entry, and this repository holds none. A figure that " +
          "happens to share the term's name is not its meaning.",
        seriesFactors: [],
        causalFactors: [],
        companyFacts: [],
      };
    }
  }
}

/** NOT_FOUND when the authorized operation's own record class turned nothing up. */
function served(
  query: string,
  seriesFactors: SeriesFactor[],
  causalFactors: CausalFactor[],
  company: { matchedCorpName?: string; facts: CompanyFactFactor[] },
): AskMarketResult {
  const hasFactors =
    seriesFactors.length > 0 || causalFactors.length > 0 || company.facts.length > 0;
  if (!hasFactors) {
    return { status: "NOT_FOUND", query, seriesFactors: [], causalFactors: [], companyFacts: [] };
  }
  return {
    status: "FACTORS_FOUND",
    query,
    matchedTopic: company.matchedCorpName,
    seriesFactors,
    causalFactors,
    companyFacts: company.facts,
  };
}
