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
  /\b(guaranteed|guarantee) (return|profit|gain)s?\b/i,
  /\btarget (price|return)\b/i,
  // "price target" — the same prohibited concept with the words the other way round, which the
  // pattern above does not match. Price targets are named explicitly in LEGAL_GUARDRAILS.md's
  // hard-prohibitions list, so having only one word order covered was a real hole.
  /\bprice target\b/i,
  /\bwill .* (hit|reach|go to) [\d,.]+\b/i,
  /\b(recommend|suggest|pick) (a stock|an etf|which stock|me a stock|me a pick)\b/i,
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
