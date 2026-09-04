/**
 * The ESC-015 Option B measurement corpus. GENERATED -- edit the generator, not this file.
 *
 * ESC-015 fixed the denominator: every pinned reproduction, the whole 28/38 unknown-tail
 * matrix, and the named continuation/name controls that previously falsified broader rules.
 * The pinned half is extracted from `tests/requestAuthority.test.ts` rather than retyped, so
 * the measurement is about what the suite actually holds.
 *
 * Each row carries its EXPECTATION so the two directions the decision asked for can be counted
 * without me deciding case by case afterwards which side a difference falls on:
 *
 *     REFUSE      a swallowing case. Refusing it is the repair working.
 *     AUTHORIZE   a continuation/name control. Refusing it is a FALSE REFUSAL.
 *     KNOWN_FAIL  the question-mark issuer exception, already refused before Option B.
 *
 *   npx tsx scripts/probe-option-b.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES: [string, string, string][] = [
  [
    "REFUSE",
    "pinned: attribution subject eats an unreadable tail",
    "What did Reuters publish about Alpha? What about the Gamma level?",
  ],
  [
    "REFUSE",
    "pinned: source slot eats the first question",
    "What did Reuters publish about Alpha? What did they say about Gamma?",
  ],
  [
    "REFUSE",
    "pinned: mechanism effect eats the tail",
    "Explain how Alpha affects Beta. What about the Gamma level?",
  ],
  [
    "REFUSE",
    "pinned: english subject eats a korean question",
    "What is the current Gamma? 현재 기준금리는 얼마인가요?",
  ],
  [
    "REFUSE",
    "pinned: determiner opens the swallowed clause",
    "What did Reuters publish about Alpha? The Gamma level too?",
  ],
  [
    "REFUSE",
    "pinned: clause opener sits mid-fragment",
    "What did Reuters publish about Alpha? The Gamma level, did it rise?",
  ],
  [
    "REFUSE",
    "pinned: a clean third fragment launders the boundary",
    "What did Reuters publish about Alpha? What about the Gamma. level?",
  ],
  [
    "REFUSE",
    "pinned: the clause opener sits behind a preposition",
    "What did Reuters publish about Alpha. In 2024 what was the CPI?",
  ],
  [
    "REFUSE",
    "pinned: the clause opener sits behind a prepositional phrase",
    "What did Reuters publish about Alpha. As of March did Reuters publish anything?",
  ],
  [
    "REFUSE",
    "pinned: the clause opener sits behind a fronted adjunct",
    "What did Reuters publish about Alpha. For Korea what is the policy rate?",
  ],
  [
    "REFUSE",
    "pinned: the tail opens with who",
    "What did Reuters publish about Alpha? Who published Gamma?",
  ],
  [
    "REFUSE",
    "pinned: the tail opens with why",
    "What did Reuters publish about Alpha? Why the Gamma decline?",
  ],
  [
    "REFUSE",
    "pinned: the tail is a who-question",
    "What did Reuters publish about Alpha? Who said that?",
  ],
  [
    "REFUSE",
    "pinned: the tail is an imperative compare",
    "What did Reuters publish about Alpha? Compare it to Gamma.",
  ],
  [
    "REFUSE",
    "pinned: the tail is an imperative list",
    "What did Reuters publish about Alpha? List the Gamma figures.",
  ],
  [
    "REFUSE",
    "pinned: the tail opens with any",
    "What did Reuters publish about Alpha? Any Gamma figures?",
  ],
  [
    "REFUSE",
    "pinned: the tail opens with same",
    "What did Reuters publish about Alpha? Same for Gamma?",
  ],
  [
    "REFUSE",
    "pinned: a bare name follows a question mark",
    "What is the current US headline CPI? Korea?",
  ],
  [
    "REFUSE",
    "pinned: a bare subject follows a question mark",
    "What did Reuters publish about Alpha? Gamma?",
  ],
  [
    "REFUSE",
    "pinned: a company name follows a question mark",
    "What is the current Acme Inc. revenue? Gamma?",
  ],
  [
    "REFUSE",
    "pinned: who follows a period",
    "What did Reuters publish about Alpha. Who published Gamma?",
  ],
  [
    "REFUSE",
    "pinned: why follows a period",
    "What did Reuters publish about Alpha. Why the Gamma decline?",
  ],
  [
    "REFUSE",
    "pinned: compare follows a period",
    "What did Reuters publish about Alpha. Compare it to Gamma.",
  ],
  [
    "REFUSE",
    "pinned: list follows a period",
    "What did Reuters publish about Alpha. List the Gamma figures.",
  ],
  [
    "REFUSE",
    "pinned: the follows a period",
    "What did Reuters publish about Alpha. The Gamma level too?",
  ],
  [
    "REFUSE",
    "pinned: any follows a period",
    "What did Reuters publish about Alpha. Any Gamma figures?",
  ],
  [
    "REFUSE",
    "pinned: same follows a period",
    "What did Reuters publish about Alpha. Same for Gamma?",
  ],
  [
    "REFUSE",
    "pinned: a korean clause follows a period",
    "What is the current Gamma. 현재 기준금리는 얼마인가요?",
  ],
  [
    "REFUSE",
    "pinned: a korean clause follows an attribution and a period",
    "What did Reuters publish about Alpha. 현재 기준금리는 얼마인가요?",
  ],
  [
    "AUTHORIZE",
    "control: institutional name with of",
    "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  ],
  [
    "AUTHORIZE",
    "control: abbreviation then measure noun",
    "What is the current U.S. rate of inflation?",
  ],
  ["AUTHORIZE", "control: company suffix then measure noun", "What is the current Acme Inc. rate?"],
  [
    "AUTHORIZE",
    "control: numbered name then measure noun",
    "What is the current No. 10 index level?",
  ],
  ["AUTHORIZE", "control: exclamation inside a name", "What is the definition of Yahoo! Finance?"],
  ["AUTHORIZE", "control: company suffix then noun", "What is the current Acme Inc. revenue?"],
  [
    "AUTHORIZE",
    "control: mixed-script issuer name after an abbreviation",
    "What did Samsung Electronics Co. 삼성전자 report about revenue?",
  ],
  [
    "AUTHORIZE",
    "control: title abbreviation whose name is a clause-opening token",
    "What did Mr. Show report about Alpha?",
  ],
  [
    "AUTHORIZE",
    "control: mixed-script issuer name as the subject of a definition",
    "What is the definition of Samsung Electronics Co. 삼성전자?",
  ],
  [
    "REFUSE",
    "unknown tail: Summarize Gamma.",
    "What did Reuters publish about Alpha. Summarize Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Summarise Gamma.",
    "What did Reuters publish about Alpha. Summarise Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Break down Gamma.",
    "What did Reuters publish about Alpha. Break down Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Outline Gamma.",
    "What did Reuters publish about Alpha. Outline Gamma.",
  ],
  ["REFUSE", "unknown tail: Chart Gamma.", "What did Reuters publish about Alpha. Chart Gamma."],
  ["REFUSE", "unknown tail: Plot Gamma.", "What did Reuters publish about Alpha. Plot Gamma."],
  ["REFUSE", "unknown tail: Find Gamma.", "What did Reuters publish about Alpha. Find Gamma."],
  ["REFUSE", "unknown tail: Check Gamma.", "What did Reuters publish about Alpha. Check Gamma."],
  [
    "REFUSE",
    "unknown tail: Look up Gamma.",
    "What did Reuters publish about Alpha. Look up Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Pull the Gamma series.",
    "What did Reuters publish about Alpha. Pull the Gamma series.",
  ],
  [
    "REFUSE",
    "unknown tail: Send me Gamma.",
    "What did Reuters publish about Alpha. Send me Gamma.",
  ],
  ["REFUSE", "unknown tail: Graph Gamma.", "What did Reuters publish about Alpha. Graph Gamma."],
  [
    "REFUSE",
    "unknown tail: Explain Gamma.",
    "What did Reuters publish about Alpha. Explain Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Describe Gamma.",
    "What did Reuters publish about Alpha. Describe Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Tell me Gamma.",
    "What did Reuters publish about Alpha. Tell me Gamma.",
  ],
  ["REFUSE", "unknown tail: Show Gamma.", "What did Reuters publish about Alpha. Show Gamma."],
  ["REFUSE", "unknown tail: List Gamma.", "What did Reuters publish about Alpha. List Gamma."],
  [
    "REFUSE",
    "unknown tail: How about Gamma?",
    "What did Reuters publish about Alpha. How about Gamma?",
  ],
  [
    "REFUSE",
    "unknown tail: What of Gamma?",
    "What did Reuters publish about Alpha. What of Gamma?",
  ],
  ["REFUSE", "unknown tail: Gamma.", "What did Reuters publish about Alpha. Gamma."],
  ["REFUSE", "unknown tail: Revenue.", "What did Reuters publish about Alpha. Revenue."],
  ["REFUSE", "unknown tail: Inflation.", "What did Reuters publish about Alpha. Inflation."],
  ["REFUSE", "unknown tail: Unemployment.", "What did Reuters publish about Alpha. Unemployment."],
  ["REFUSE", "unknown tail: Gamma Corp.", "What did Reuters publish about Alpha. Gamma Corp."],
  [
    "REFUSE",
    "unknown tail: Alpha Holdings.",
    "What did Reuters publish about Alpha. Alpha Holdings.",
  ],
  [
    "REFUSE",
    "unknown tail: Beta Industries.",
    "What did Reuters publish about Alpha. Beta Industries.",
  ],
  [
    "REFUSE",
    "unknown tail: Delta Partners.",
    "What did Reuters publish about Alpha. Delta Partners.",
  ],
  [
    "REFUSE",
    "unknown tail: Zorbulate Gamma.",
    "What did Reuters publish about Alpha. Zorbulate Gamma.",
  ],
  [
    "REFUSE",
    "unknown tail: Frobnicate Gamma.",
    "What did Reuters publish about Alpha. Frobnicate Gamma.",
  ],
  ["REFUSE", "unknown tail: Quux Gamma.", "What did Reuters publish about Alpha. Quux Gamma."],
  ["REFUSE", "unknown tail: Blint Gamma.", "What did Reuters publish about Alpha. Blint Gamma."],
  ["REFUSE", "unknown tail: 감마 알려줘.", "What did Reuters publish about Alpha. 감마 알려줘."],
  ["REFUSE", "unknown tail: 감마.", "What did Reuters publish about Alpha. 감마."],
  ["REFUSE", "unknown tail: 2024.", "What did Reuters publish about Alpha. 2024."],
  ["REFUSE", "unknown tail: 10 Gamma.", "What did Reuters publish about Alpha. 10 Gamma."],
  ["REFUSE", "unknown tail: Q3 Gamma.", "What did Reuters publish about Alpha. Q3 Gamma."],
  [
    "KNOWN_FAIL",
    "named control: question-mark issuer exception",
    "What is the definition of Can I Use A Question Mark In A Company Name? Ltd?",
  ],
  [
    "AUTHORIZE",
    "continuation: Bloomberg L.P. publish",
    "What did Bloomberg L.P. publish about Alpha?",
  ],
  ["AUTHORIZE", "continuation: Acme Inc. report", "What did Acme Inc. report about revenue?"],
  ["AUTHORIZE", "plain single-clause request", "What is the current US headline CPI?"],
  ["AUTHORIZE", "plain attribution", "What did Reuters publish about Alpha?"],
  ["AUTHORIZE", "plain definition", "What is the definition of Alpha?"],
];

for (const [expectation, label, query] of CASES) {
  const a = resolveRequestAuthority(query);
  let served = "-";
  if (a.status === "AUTHORIZED") {
    served = `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}|${a.causeRegion ?? "-"}|${a.effectRegion ?? "-"}`;
  }
  // ESC-015 item 4 removed the informational payload: a PROHIBITED request carries nothing.
  process.stdout.write(`${expectation}\t${a.status}\t${served}\t${label}\n`);
}
