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
  /\bwill .* (hit|reach|go to) [\d,.]+\b/i,
  /\b(recommend|suggest|pick) (a stock|an etf|which stock|me a stock|me a pick)\b/i,
  /지금\s*(살까|사야|팔까|팔아야)/, // "buy/sell now?" — the LEGAL_GUARDRAILS.md example
  // Same "buy/sell now?" intent without requiring "지금" immediately before it (e.g. "삼성전자
  // 살까요?" with the timing implied rather than stated).
  /(살까요?|사야\s*(할까요|하나요|하나)|팔까요?|팔아야\s*(할까요|하나요|하나))/,
  /(사도|팔아도)\s*(될까요|되나요|되나|될까)/,
  /(매수|매도)\s*(할까|해야|타이밍|추천)/,
  /추천\s*(종목|주식)/, // "recommend a stock/ticker"
  /얼마.*투자/, // "how much should I invest"
  /수익\s*(보장|확정)/, // guaranteed returns
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
