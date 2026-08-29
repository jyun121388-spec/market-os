/**
 * Whether a sentence containing prohibited vocabulary is actually making a prohibited request.
 *
 * Four measured false positives, and one defect said four times:
 *
 *     How does a stop-loss order actually work on the KRX?      -> /\bstop[-\s]?loss\b/i
 *     손절 주문은 거래소에서 어떻게 처리되나요?                    -> /(익절|손절)\s*(...)?/
 *     What price target did analysts publish for Nvidia?        -> /\bprice target\b/i
 *     증권사들이 발표한 삼성전자 목표주가는 얼마였나요?             -> /목표\s*(가|주가|수익률)/
 *
 * Three of those four patterns are bare vocabulary with no anchor at all; the fourth has an anchor
 * whose entire suffix group is optional, which is the same thing written at greater length. Each
 * would be easy to patch with its own exception, and that is the loop Gates A through T already
 * ran — five rounds of replacing one pattern with a slightly different pattern while the
 * regression rate stayed flat.
 *
 * **Vocabulary is evidence, not intent.** "Stop-loss" appears in a question about how the exchange
 * processes an order type and in a request to choose one for the asker. What separates them is not
 * a word anywhere in either sentence; it is the FRAME — what the sentence asks the product to do.
 *
 * So this module answers that one question, deterministically, with no model and no network.
 *
 * ## The ordering is the safety property
 *
 * A directive signal is checked FIRST and wins outright. "Where should I set my stop-loss on the
 * KRX?" contains a mechanism-shaped phrase and is a request for a trading instruction; a classifier
 * that found the mechanism frame first would exempt it. Only after no directive signal is found is
 * the sentence allowed to be factual.
 *
 * And `UNKNOWN` exempts nothing. An unrecognised frame carrying prohibited vocabulary keeps being
 * refused, so the failure mode of an incomplete signal list is over-blocking — the smaller harm,
 * and the one this project has already chosen deliberately once when it pinned eighteen legitimate
 * macro questions as must-not-flag.
 *
 * ## What this is not
 *
 * Not a general intent classifier and not a replacement for anything. It is consulted by exactly
 * the patterns whose matches were measured as false positives, listed in `askMarket.ts` as
 * `VOCABULARY_ONLY_PATTERNS`. Every other pattern is unchanged and unconsulted, because every
 * other pattern already carries its own anchor.
 */

export type RequestFrame =
  /** Asks the product to decide, choose, set a level, or act. */
  | "REQUEST_DIRECTIVE"
  /** Asks how something works, is processed, or is defined. */
  | "FACTUAL_MECHANISM"
  /** Asks what somebody else published, said, or estimated. */
  | "THIRD_PARTY_REPORTED_FACT"
  /** Asks what happened or what a figure was. Classified, and deliberately not exempting. */
  | "DESCRIPTIVE_ANALYSIS"
  /** No frame recognised. Exempts nothing. */
  | "UNKNOWN";

/**
 * The asker wants a decision, a level, or an action.
 *
 * Checked before everything else, so a directive wearing a factual shape is still a directive.
 * Korean carries this in the verb ending far more than in the vocabulary — 잡아야 하나요, 봐야
 * 하나요, 정해 주세요 — which is why the endings are here rather than a noun list.
 */
const DIRECTIVE_SIGNALS: RegExp[] = [
  // First person with a stake in the answer.
  /\b(should|shall|do|can|could|would|must)\s+(i|we)\b/i,
  /\bfor (me|us|my|our)\b/i,
  // "my price target" and "my stop loss level" put a word between the possessive and the object,
  // and the tight `my <object>` form missed both. Bounded to a short span so the possessive is
  // plausibly governing the object rather than merely appearing earlier in the sentence.
  /\bmy\b[^?]{0,18}\b(position|stop|stop[-\s]?loss|target|portfolio|trade|order|entry|exit|allocation)\b/i,
  /\bin my (position|case|situation|shoes)\b/i,
  // Asking us to produce or choose a number or an action.
  /\b(give|tell|show|find|pick|choose|set|place|suggest|recommend)\s+(me|us)\b/i,
  /\bwhat\s+.{0,30}\bshould\s+(i|we|it|the)\b/i,
  /\bwhere\s+.{0,20}\b(should|do)\s+(i|we)\b/i,
  /\bhow (much|many)\s+.{0,30}\bshould\b/i,
  /\bwhat'?s? a good\b/i,
  // Bare imperatives aimed at the product. Anchored to an object so "set theory" and "place of
  // supply" are not instructions.
  /^\s*(set|place|put|enter|exit|buy|sell|short|hedge|allocate|rebalance)\b[^?]{0,60}$/i,
  // Korean decision-seeking endings. 하나요 and 할까요 on their own are the question forms that
  // ask somebody else to decide, which is exactly the distinction being drawn.
  /(할까요|할까|해야\s*(하나요|할까요|되나요|되나|하나))/,
  /(잡아야|봐야|정해야|골라야|사야|팔아야|넣어야|빼야)/,
  /(정해|알려|추천해|골라|잡아)\s*(주세요|주실|주시|줘|달라)/,
  /(제|내|저희|우리)\s*(상황|경우|포지션|계좌|자산|돈)/,
  /얼마로\s*(잡|보|정|설정)/,
];

/**
 * The asker wants to know how something works.
 *
 * Anchored to an explanatory verb rather than to the interrogative alone: "how much leverage" is a
 * question with "how" in it and is not a mechanism question.
 */
const MECHANISM_SIGNALS: RegExp[] = [
  /\bhow (does|do|is|are|did)\b[^?]{0,80}\b(work|works|worked|function|functions|processed|process|handled|handle|executed|execute|calculated|calculate|settled|settle|matched|match|regulated|regulate|defined|define|triggered|trigger)\b/i,
  /\b(what|explain)\b[^?]{0,40}\b(mechanism|process|procedure)\b/i,
  /\bwhat (is|are)\b[^?]{0,30}\b(defined as|meant by)\b/i,
  /\bexplain how\b/i,
  // Korean: 어떻게 처리되나요 / 어떻게 작동하나요 / 무슨 뜻인가요 / 어떻게 계산되나요.
  /어떻게\s*[^?]{0,20}(처리|작동|동작|계산|체결|산정|적용|규제|정의)\s*(되|하|됩|합)/,
  /(무슨|어떤)\s*(뜻|의미)(인가요|입니까|이야|이에요)?/,
  /(이란|란|이라는\s*것은)\s*무엇/,
  /어떻게\s*(생기|발생하)/,
];

/**
 * The asker wants to know what somebody else said.
 *
 * Requires BOTH a third-party source and a reporting verb. Either alone is too weak: "analysts"
 * appears in plenty of requests for our own view, and "published" appears in plenty of sentences
 * about us.
 */
const REPORTING_SOURCE_KO = /(증권사|애널리스트|리서치|기관|컨센서스|시장\s*전망)/;
const REPORTING_SOURCE =
  /\b(analysts?|brokers?|brokerages?|sell[-\s]?side|research (house|firm|desk)s?|consensus|street)\b/i;

/**
 * Does this text consist of nothing but generic third-party vocabulary?
 *
 * Exported for `sourceAuthority`, which needs the distinction the whole B2-C repair turns on: a
 * request "explicitly attributed to source X" is a different thing from one that merely says
 * somebody else reported it. `What did analysts publish about X?` names NO provider -- `analysts`
 * is the vocabulary that proves the frame, not a party -- while `What did Xraywire analysts publish
 * about X?` purports to name one.
 *
 * The same regexes, not a second copy of them. A separate list of "generic words" would be a
 * denylist maintained in two places, and the two would drift; here, a term that proves the frame is
 * by construction the same term that cannot be an attribution on its own.
 */
export function isGenericThirdPartyReference(text: string): boolean {
  const stripped = text
    .replace(new RegExp(REPORTING_SOURCE.source, "gi"), " ")
    .replace(new RegExp(REPORTING_SOURCE_KO.source, "g"), " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (stripped === "") return true;
  // Determiners and possessives may survive the strip and still name nobody.
  return stripped.split(/\s+/).every((token) => FUNCTION_ONLY.has(token.toLowerCase()));
}

/** Words that can sit beside a generic third-party term without naming a party. */
const FUNCTION_ONLY = new Set(["the", "a", "an", "s", "of", "some", "any", "most", "other"]);
const REPORTING_VERB =
  /\b(publish|published|issue|issued|set|reported|report|say|said|estimate|estimated|forecast|forecasts|forecasted|rate|rated|have|has)\b/i;
const REPORTING_VERB_KO = /(발표|제시|전망|추정|보고|공시|집계)/;

/** Asks what happened or what a figure was. Recognised, and never used to exempt anything. */
const DESCRIPTIVE_SIGNALS: RegExp[] = [
  /\b(what|how much|how many|when|which)\b[^?]{0,60}\b(was|were|did|has been|have been)\b/i,
  /(얼마였|얼마나\s*(올랐|떨어졌|늘었|줄었)|언제\s*(였|했))/,
];

/**
 * Classifies the frame of a query. Pure, deterministic, no model, no network.
 *
 * Order matters and is the safety property: directive first, so nothing wearing a factual shape
 * can exempt itself.
 */
export function classifyRequestFrame(query: string): RequestFrame {
  if (DIRECTIVE_SIGNALS.some((pattern) => pattern.test(query))) return "REQUEST_DIRECTIVE";
  if (MECHANISM_SIGNALS.some((pattern) => pattern.test(query))) return "FACTUAL_MECHANISM";
  if (
    (REPORTING_SOURCE.test(query) && REPORTING_VERB.test(query)) ||
    (REPORTING_SOURCE_KO.test(query) && REPORTING_VERB_KO.test(query))
  ) {
    return "THIRD_PARTY_REPORTED_FACT";
  }
  if (DESCRIPTIVE_SIGNALS.some((pattern) => pattern.test(query))) return "DESCRIPTIVE_ANALYSIS";
  return "UNKNOWN";
}

/**
 * The frames that let prohibited vocabulary through.
 *
 * Two of the five, and `DESCRIPTIVE_ANALYSIS` is deliberately not among them. "What was Samsung's
 * price target last year?" is descriptive and is still a question about a price target with no
 * stated source, which is close enough to asking for one that refusing is the right side to err
 * on. Exempting it would buy one corpus case and widen the hole by a whole frame.
 */
const EXEMPTING_FRAMES = new Set<RequestFrame>(["FACTUAL_MECHANISM", "THIRD_PARTY_REPORTED_FACT"]);

/**
 * Whether a query's frame is clearly factual enough to excuse prohibited vocabulary in it.
 *
 * `UNKNOWN` and `DESCRIPTIVE_ANALYSIS` both return false. An unrecognised frame is not a safe one.
 */
export function frameExemptsProhibitedVocabulary(query: string): boolean {
  return EXEMPTING_FRAMES.has(classifyRequestFrame(query));
}

/**
 * Subjects that make a "should X do Y" question a policy question rather than a request.
 *
 * The English side of this axis already exists — `./subjectClassification` answers "is the subject
 * of this trading verb a person or an institution", and it is why "Should the Bank of Korea cut
 * rates?" is answerable. Korean had no mirror, which is the third time this file has learned that
 * an English rule without a Korean one is a hole rather than a partial implementation.
 *
 * Deliberately institutions only, and deliberately short. A directive addressed to a regulator, a
 * central bank, an exchange or a government is a governance question; a directive addressed to us
 * about somebody's money is not, whoever is mentioned elsewhere in the sentence.
 */
const POLICY_SUBJECT_KO =
  /(정부|당국|금융당국|감독당국|규제기관|중앙은행|한국은행|연준|거래소|국회|입법부|공적연금|국민연금|기획재정부|금융위|금감원)(는|은|이|가|에서)/;

/**
 * Financial stake: is this directive about money, an instrument, or a position?
 *
 * Broad on purpose and narrow in one specific way. It has to cover the shapes the holdout found —
 * an amount with no instrument, a fund, a position, a return, a loss — while not turning every
 * imperative sentence into a refusal. The guardrail sits in front of a market-intelligence
 * product, so the cost of breadth here is bounded by what people actually ask it.
 */
const FINANCIAL_STAKE = [
  // Money, named or numbered.
  /[$₩€£]\s?\d/,
  /\b\d[\d,.]*\s?(k|m|bn|million|billion|dollars?|won|euros?|pounds?)\b/i,
  /(\d[\d,]*\s*(원|만원|억|천만|백만))/,
  /\b(money|cash|savings|bonus|inheritance|capital|funds?|payout|windfall|principal)\b/i,
  /(돈|자금|현금|예금|목돈|여윳돈|여유자금|퇴직금|성과급|상속|원금|보너스)/,
  // Instruments and holdings.
  /\b(stocks?|shares?|equit(y|ies)|bonds?|etfs?|funds?|crypto|bitcoin|futures?|options?|treasur(y|ies)|portfolio|position|holdings?|account|allocation)\b/i,
  /(주식|종목|채권|펀드|코인|비트코인|선물|옵션|포트폴리오|포지션|보유|계좌|비중|자산)/,
  // Prices, levels and outcomes.
  /\b(price|target|level|close|closing|return|returns|gain|profit|loss|losses|yield|rate)\b/i,
  /(주가|가격|종가|지수|환율|수익|수익률|손실|손해|이익|목표가|고점|저점)/,
  // Acting in a market.
  /\b(buy|sell|short|hedge|trade|invest|rebalance|allocate|order|execute)\b/i,
  /(매수|매도|매매|투자|손절|익절|주문|체결|리밸런싱|헤지)/,
];

/**
 * Whether the query asks the product to make a financial decision, independent of any pattern.
 *
 * **This is the structural repair for IR-090.** The frame classifier already worked out that a
 * sentence was a directive, and that answer was consulted only to EXEMPT — it could excuse
 * prohibited vocabulary and could never refuse anything on its own. 24 of the holdout's 85 misses
 * were classified `REQUEST_DIRECTIVE` and answered anyway, because being a directive about money
 * was not, anywhere in the system, a reason to redirect.
 *
 * So the classifier becomes symmetric. It is the same signal, read in both directions.
 *
 * Two conditions, both required:
 *
 * 1. The frame is `REQUEST_DIRECTIVE` — the asker wants a decision, a level, or an action.
 * 2. The sentence has a financial stake — money, an instrument, a position, a price, or an act of
 *    trading.
 *
 * And one exclusion: a directive whose subject is an institution setting policy is a governance
 * question. "Should the exchange change its circuit-breaker threshold?" is exactly the kind of
 * question this product exists for, and Korean carries that in a subject marker the English
 * subject classifier had no mirror for.
 *
 * What this is NOT: a new list of phrasings. It adds no vocabulary the classifier did not already
 * use, and it closes one named family rather than the 85 sentences that exposed it.
 */
/**
 * A stricter subset of the directive signals, for the direction where over-firing costs something.
 *
 * The first version of this repair reused `DIRECTIVE_SIGNALS` and broke six cases in the 518-case
 * pinning suite, which is the finding rather than an inconvenience:
 *
 * **The two directions need different evidence, because their errors have different costs.** As an
 * exemption blocker, a directive signal that over-fires is harmless — it declines to excuse
 * prohibited vocabulary, and something else decides. As a refusal trigger, the same over-fire is a
 * false positive on a legitimate question. `알려줘` is how Korean asks for any information at all;
 * it was correct to say "this is not a factual frame" and wrong to say "this is a request for a
 * decision". Likewise "Can you tell me if the bond promises investors a 5% yield?" — an instruction
 * to inform, not to decide.
 *
 * So this list asks for something narrower: the ASKER'S OWN STAKE, or an instruction to CHOOSE or
 * ACT rather than to explain. A question that merely wants information stays out, whatever verb
 * ending it uses.
 */
const DECISION_REQUEST_SIGNALS: RegExp[] = [
  // The asker's own stake in the answer.
  /\bshould\s+(i|we)\b/i,
  /\bfor (me|us)\b/i,
  /\bmy\b[^?]{0,18}\b(position|stop|stop[-\s]?loss|portfolio|trade|holdings?|account|allocation|money|cash|savings)\b/i,
  /\bin my (position|case|situation|shoes)\b/i,
  /\bif you were me\b/i,
  // An instruction to choose, set, size or act — never merely to explain.
  /\b(pick|choose|select|set|place|submit|execute|allocate|rebalance|split|divide|construct|design|build)\b[^?]{0,40}\b(for|my|me|us|order|trade|portfolio|position|amount|weights?)\b/i,
  /\b(give|show|tell|find)\s+me\b[^?]{0,40}\b(one number|the number|an? (exact|specific|certain)|price target|level|amount|trade|position|stock|fund|investment)\b/i,
  /\bhow much of (my|our)\b/i,
  /\bwhat (should|would) (i|we)\b/i,
  // Korean: the asker's own stake.
  /(제|내|저희|우리)\s*(상황|경우|포지션|계좌|자산|돈|자금|포트폴리오|비중)/,
  /(내|제)\s*[^?]{0,10}(팔까|살까|들어갈까|나올까|정리할까)/,
  // Korean: an instruction to choose, set or act. Deliberately excludes 알려줘 and 설명해 줘, which
  // ask to be informed.
  /(정해|골라|잡아|짜|만들어|넣어|바꿔|맞춰|나눠|추천해)\s*(주세요|주실|주시|줘|달라|봐)/,
  /(사야|팔아야|넣어야|빼야|잡아야|골라야|정해야)\s*(하나요|할까요|되나요|할까|해)/,
  /얼마로\s*(잡|보|정|설정)/,
  /(얼마나|몇\s*%|몇\s*퍼센트)\s*[^?]{0,15}(넣어야|투자해야|담아야|줄여야|늘려야)/,
];

/**
 * Subjects that make a "should X do Y" question a policy question rather than a request.
 *
 * The English half already existed in `./subjectClassification`, which is why "Should the Bank of
 * Korea cut rates?" is answerable. This adds the shapes that reach the refusal path: an
 * institution named as the actor, in either language.
 */
const POLICY_SUBJECT_EN =
  /\b(should|must|ought)\s+(the\s+)?(government|regulators?|central bank|fed|federal reserve|exchanges?|authorit(y|ies)|legislators?|policymakers?|pension funds?|treasury|congress|parliament|standard[-\s]setters?)\b/i;

export function requestsAFinancialDecision(query: string): boolean {
  if (classifyRequestFrame(query) !== "REQUEST_DIRECTIVE") return false;
  // A directive addressed to an institution is a governance question, which is what this product
  // is for. Checked before the stake, because a policy question about pensions is full of
  // financial vocabulary by nature.
  if (POLICY_SUBJECT_KO.test(query) || POLICY_SUBJECT_EN.test(query)) return false;
  if (!DECISION_REQUEST_SIGNALS.some((pattern) => pattern.test(query))) return false;
  return FINANCIAL_STAKE.some((pattern) => pattern.test(query));
}
