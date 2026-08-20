import { prisma } from "@/server/db/client";
import { computeChange, getRecentObservationPair } from "./seriesReadings";
import { extractKeywords } from "./eventClustering";

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
  "PERSONALIZED_ADVICE_REDIRECTED" | "FACTORS_FOUND" | "NOT_FOUND";

export interface SeriesFactor {
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
  absoluteChange: number;
  percentChange: number | null;
}

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
  /\b(guaranteed|guarantee)\b[\s\S]{0,40}\b(return|profit|gain|yield)s?\b/i,
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
  // Split in two, because the recipient and the figure trade off against each other. A recipient
  // that is unmistakably a PERSON needs no figure after it — "Can you promise John double-digit
  // annual returns?" has none, and requiring one let it through. A recipient of the form
  // "the <something>" is far weaker evidence, so that branch still wants a figure: without it,
  // "does the merger promise the kind of returns investors want" reads as a promise to "the kind".
  /\b[Pp]romis(e|es|ed|ing)\s+(me|us|him|her|them|you|(my|our|his|her|their|your)\s+\w+|[A-Z][a-z]+)\s[^?!]{0,30}\b(return|profit|gain|yield)s?\b/,
  /\b(promise|promises|promised|promising)\s+the\s+\w+\s+(an?|\d)[^?!]{0,30}\b(return|profit|gain|yield)s?\b/i,
  // A recipient written in lower case, or shouted in capitals, is the same recipient. The
  // case-sensitive branch above reads a capital as evidence of a name, and "promise john a 10%
  // annual return" offers none — so this branch takes any word and lets the figure do the work
  // instead, which is what keeps "does the new fab promise better returns" out of it.
  // An article is not a recipient. Without excluding them, "The prospectus promises a 5 year
  // lock-up, not a return" reads as a promise made to "a".
  /\b(promise|promises|promised|promising)\s+(?!(a|an|the|no|nothing|not)\b)\w+\s[^?!]{0,20}\d[^?!]{0,25}\b(return|profit|gain|yield)s?\b/i,
  /\btarget (price|return)\b/i,
  // "price target" — the same prohibited concept with the words the other way round, which the
  // pattern above does not match. Price targets are named explicitly in LEGAL_GUARDRAILS.md's
  // hard-prohibitions list, so having only one word order covered was a real hole.
  /\bprice target\b/i,
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
  /\bwhat (level|value|number)\b[^?!]{0,30}\bwill\b[^?!]{0,30}\b(s&p( 500)?|nasdaq|dow( jones)?|russell|kospi|kosdaq|nikkei|ftse|dax|hang seng|stoxx|vix)\b[^?!]{0,25}\b(hit|reach|be|close)\b/i,
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
  /\bshould (my|his|her|their|our|your)\b[^?!,]{0,60}\b(buy|sell|dump|short|invest)\b/i,
  /\bshould (my|his|her|their|our|your)\b[^?!,]{0,60}\bhold\b(?![^?!]{0,20}\b(constant|fixed|steady|equal|unchanged)\b)/i,
  /\bshould\s+(my |his |her |their |our |your )?(dad|mom|mum|mother|father|brother|sister|son|daughter|wife|husband|partner|spouse|friend|uncle|aunt|grandma|grandpa|colleague|boss|client)\b[^?!]{0,25}\b(buy|sell|dump|short|hold|invest)\b/i,
  // Investor roles — someone whose job is to trade on another person's behalf. Deliberately not
  // "investors", "a company" or "a pension fund": those appear in questions about markets and
  // regulation far more often than in requests for advice.
  /\bshould\s+(the|my|our|his|her|their|your)\s+(trustee|broker|adviser|advisor|analyst|banker|desk|fund manager|portfolio manager|money manager|wealth manager|accountant)\b[^?!]{0,25}\b(buy|sell|dump|short|hold|invest)\b/i,
  // A named person — but a capital letter marks a proper noun, not a person, and in this product
  // most proper nouns are companies. The bare version of this rule lasted one commit and refused
  // "Should Apple buy Nvidia?", "Should Samsung sell its display unit?", "Should Tesla invest in a
  // new gigafactory?" and "Should Europe invest in LNG terminals?" — corporate actions and policy,
  // which is most of what this product is FOR.
  //
  // So the name is not enough on its own. A personal possessive after the verb is what separates
  // "Should Sarah sell her Tesla shares?" from "Should Samsung sell its display unit?": people get
  // "his" and "her", companies get "its".
  //
  // That leaves "Should John buy Nvidia?" uncovered, and it is a real request for advice. Recorded
  // as a gap rather than closed, because every way of closing it that has been tried refuses
  // ordinary research: see docs/INTERIM_REVIEW_FINDINGS.md, Gate E.
  /\b[Ss]hould\s+[A-Z][a-z]+\b[^?!]{0,25}\b(buy|sell|dump|short|hold|invest)\b[^?!]{0,25}\b(his|her)\b/,
  // "Should I invest?" with no object. The `should i (…|invest in|…)` pattern above requires
  // "invest IN something", so the bare form slipped through.
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
  /\bstop[-\s]?loss\b/i,
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
  /목표\s*(가|주가|수익률)/,
  // 익절 / 손절 — take-profit and stop-loss. Extremely common Korean retail-investing verbs and
  // unambiguously requests for a trading instruction, not for analysis.
  /(익절|손절)\s*(할까|해야|타이밍|하나요|할까요)?/,
  // "지금 들어가도 될까요?" / "지금 나와도" — enter/exit a position, the positional equivalent
  // of 사도/팔아도 which was already covered.
  /(들어가도|나와도|들어갈까|나올까)\s*(될까요|되나요|되나|될까|요)?/,
  /비중\s*(조절|늘려|줄여|확대|축소)/, // adjust position weighting
  /(사기|팔기)\s*좋은\s*(때|시점|타이밍)/, // "a good time to buy/sell"
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
    if (!ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(withoutCollocation))) return false;
  }

  return ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(query));
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
function mentionsEachOther(a: string, b: string): boolean {
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

async function findSeriesFactors(topic: string): Promise<SeriesFactor[]> {
  if (!topic) return [];
  const allSeries = await prisma.series.findMany({
    include: { source: { select: { code: true } } },
  });
  const matches = allSeries.filter((s) => mentionsEachOther(s.name, topic)).slice(0, 5);

  const factors: SeriesFactor[] = [];
  for (const series of matches) {
    const pair = await getRecentObservationPair(series.id);
    if (!pair) continue;
    const change = computeChange(pair, series.unit);
    factors.push({
      seriesId: series.id,
      seriesName: series.name,
      sourceCode: series.source.code,
      unit: series.unit,
      asOfDate: pair.current.observationDate.toISOString().slice(0, 10),
      value: Number(pair.current.value.toString()),
      absoluteChange: change.absoluteChange,
      percentChange: change.percentChange,
    });
  }
  return factors;
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
  const filing = allFilings.find((f) => mentionsEachOther(f.corpName, topic));
  if (!filing) return { facts: [] };

  // Scoped to the source the FILING came from. `corpCode` is not a company: both unique indexes
  // on financial_facts begin with sourceId, because a corp code only identifies a company within
  // the provider that issued it — this project already stores 10-digit SEC CIKs and 8-digit DART
  // corp codes in the same column. Keying on corpCode alone made this answer depend on those
  // namespaces never colliding, which nothing enforces, and the failure would have been a
  // foreign-currency figure from another provider quietly leading an answer about a US company.
  const facts = await prisma.financialFact.findMany({
    where: { sourceId: filing.sourceId, corpCode: filing.corpCode },
    orderBy: [{ periodEnd: "desc" }],
    take: 10,
  });

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
  const isAdviceRequest = detectPersonalizedAdviceRequest(trimmed);

  const [seriesFactors, causalFactors, companyResult] = await Promise.all([
    findSeriesFactors(trimmed),
    findCausalFactors(trimmed),
    findCompanyFacts(trimmed),
  ]);

  const hasFactors =
    seriesFactors.length > 0 || causalFactors.length > 0 || companyResult.facts.length > 0;

  if (isAdviceRequest) {
    return {
      status: "PERSONALIZED_ADVICE_REDIRECTED",
      query: trimmed,
      redirectMessage: REDIRECT_MESSAGE,
      matchedTopic: companyResult.matchedCorpName,
      seriesFactors,
      causalFactors,
      companyFacts: companyResult.facts,
    };
  }

  if (!hasFactors) {
    return {
      status: "NOT_FOUND",
      query: trimmed,
      seriesFactors: [],
      causalFactors: [],
      companyFacts: [],
    };
  }

  return {
    status: "FACTORS_FOUND",
    query: trimmed,
    matchedTopic: companyResult.matchedCorpName,
    seriesFactors,
    causalFactors,
    companyFacts: companyResult.facts,
  };
}
