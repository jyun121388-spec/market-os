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
const REPORTING_SOURCE =
  /\b(analysts?|brokers?|brokerages?|sell[-\s]?side|research (house|firm|desk)s?|consensus|street)\b/i;
const REPORTING_VERB =
  /\b(publish|published|issue|issued|set|reported|report|say|said|estimate|estimated|forecast|forecasts|forecasted|rate|rated|have|has)\b/i;
const REPORTING_SOURCE_KO = /(증권사|애널리스트|리서치|기관|컨센서스|시장\s*전망)/;
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
