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
  /\bmy (portfolio|holdings|position sizing)\b/i,
  /\bhow should i (allocate|split|divide|weight|size)\b/i,
  /\bwhat weighting\b/i,
  /\ballocate\b[\s\S]{0,20}\bbetween\b/i,

  // Roleplay and hypothetical framing — the request is unchanged, only the wrapper differs.
  /\b(pretend|roleplay|role-play|act as|imagine you(?:'re| are))\b/i,
  /\bif you (were|had)\b[\s\S]{0,60}\b(buy|sell|invest|put it|would you)\b/i,
  /\bwhere would you put\b/i,
  /\bwhat would (a|an|any)\b[\s\S]{0,30}\b(investor|trader|analyst|manager)\b/i,

  // Laundering the recommendation through a third party still asks for one.
  /\b(my|our) (advisor|adviser|broker|analyst|banker)\b/i,
  /\b(tell me|show me)\b[\s\S]{0,20}\bwhat to (buy|sell|invest)\b/i,

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

export function detectPersonalizedAdviceRequest(query: string): boolean {
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
  const allSeries = await prisma.series.findMany();
  const matches = allSeries.filter((s) => mentionsEachOther(s.name, topic)).slice(0, 5);

  const factors: SeriesFactor[] = [];
  for (const series of matches) {
    const pair = await getRecentObservationPair(series.id);
    if (!pair) continue;
    const change = computeChange(pair, series.unit);
    factors.push({
      seriesId: series.id,
      seriesName: series.name,
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
  const allFilings = await prisma.filing.findMany({ orderBy: { receiptDate: "desc" } });
  const filing = allFilings.find((f) => mentionsEachOther(f.corpName, topic));
  if (!filing) return { facts: [] };

  const facts = await prisma.financialFact.findMany({
    where: { corpCode: filing.corpCode },
    orderBy: [{ periodEnd: "desc" }],
    take: 10,
  });

  return {
    matchedCorpName: filing.corpName,
    facts: facts.map((f) => ({
      concept: f.concept,
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
