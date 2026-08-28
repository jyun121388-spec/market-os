/**
 * Where the LEXICAL evidence still has to do the work: a boundary that is not `?`.
 *
 * Five mutants went from ISOLATED to MISSED the moment the terminator rule landed -- the Korean
 * clause rule, the determiner rule, and all three groups of clause-opening tokens. One cause for
 * all five: every discriminator in the suite happens to use `?` as its internal boundary, and `?`
 * now confirms on its own, so none of them consults the lexical rules any more.
 *
 * That is the same failure this unit already met once, on B-M3: the tests pick the case where the
 * mechanism cannot fail. `?` is caught by the terminator rule and `.`, `!`, `;` are not, so these
 * are the same requests with the boundary changed.
 *
 * Run BEFORE adding any of them as tests -- a discriminator asserted without being measured is how
 * a suite acquires a test that passes for a reason nobody checked.
 *
 *   npx tsx scripts/probe-period-boundary.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES: [string, string][] = [
  // Must REFUSE. Each relies on lexical evidence, because the boundary is not a question mark.
  ["interrogative who", "What did Reuters publish about Alpha. Who published Gamma?"],
  ["interrogative why", "What did Reuters publish about Alpha. Why the Gamma decline?"],
  ["imperative compare", "What did Reuters publish about Alpha. Compare it to Gamma."],
  ["imperative list", "What did Reuters publish about Alpha. List the Gamma figures."],
  ["determiner the", "What did Reuters publish about Alpha. The Gamma level too?"],
  ["determiner any", "What did Reuters publish about Alpha. Any Gamma figures?"],
  ["determiner same", "What did Reuters publish about Alpha. Same for Gamma?"],
  ["korean clause", "What is the current Gamma. 현재 기준금리는 얼마인가요?"],
  [
    "korean clause after attribution",
    "What did Reuters publish about Alpha. 현재 기준금리는 얼마인가요?",
  ],

  // Must still AUTHORIZE. These are the names the provisional boundary exists to reunite, and they
  // are what breaks if the lexical rules are widened instead of the boundary being narrowed.
  [
    "institutional name",
    "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  ],
  ["brand with exclamation", "What is the definition of Yahoo! Finance?"],
  ["company suffix", "What is the current Acme Inc. revenue?"],
  ["mixed-script issuer", "What did Samsung Electronics Co. 삼성전자 report about revenue?"],
  ["mixed-script issuer definition", "What is the definition of Samsung Electronics Co. 삼성전자?"],
  // The rest of the "must keep authorizing" set, added so that a disable-and-measure run against
  // the head condition can say which of these the head protects and which a tail property does.
  // The last two matter most: their tails contain VERBS and are still name continuations, so if the
  // head condition is what carries them, a continuation class only has to cover short nominals.
  ["company suffix then measure noun", "What is the current Acme Inc. rate?"],
  ["numbered name then measure noun", "What is the current No. 10 index level?"],
  ["title abbreviation, verb in the tail", "What did Mr. Show report about Alpha?"],
];

for (const [label, query] of CASES) {
  const a = resolveRequestAuthority(query);
  const served =
    a.status === "AUTHORIZED" ? `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
  process.stdout.write(`${label}\t${a.status}\t${served}\t${JSON.stringify(query)}\n`);
}
