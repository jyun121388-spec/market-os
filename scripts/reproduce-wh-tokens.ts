/**
 * Reproduction for the P1 review finding: `who` and `why` are missing from CLAUSE_OPENING_TOKENS.
 *
 * The set was written by hand as "the subset of framing that can stand CLAUSE-INITIALLY", and two
 * wh-words that plainly can were left out. Mutation isolation cannot see this: every mutant tests
 * whether the implemented set is load-bearing, and none tests whether it is COMPLETE.
 *
 *   npx tsx scripts/reproduce-wh-tokens.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES = [
  // Reported by review. Both must refuse; the second must not carry a polluted informational region.
  "What did Reuters publish about Alpha? Why the Gamma decline?",
  "Should I buy stock? What did Reuters publish about Alpha? Who published Gamma?",
  // The rest of the wh- and clause-opening space, to find out whether `who`/`why` are the only two.
  "What did Reuters publish about Alpha? Who said that?",
  "What did Reuters publish about Alpha? Whose figure is that?",
  "What did Reuters publish about Alpha? Whom did they ask?",
  "What did Reuters publish about Alpha? When was that?",
  "What did Reuters publish about Alpha? Where was that published?",
  "What did Reuters publish about Alpha? Why does that matter?",
  "What did Reuters publish about Alpha? Should I care?",
  "What did Reuters publish about Alpha? Could you also cover Gamma?",
  "What did Reuters publish about Alpha? Compare it to Gamma.",
  "What did Reuters publish about Alpha? List the Gamma figures.",
  "What did Reuters publish about Alpha? Any Gamma figures?",
  "What did Reuters publish about Alpha? Same for Gamma?",
  "What did Reuters publish about Alpha? Also Gamma?",
  "What did Reuters publish about Alpha? And Gamma?",
  // Controls that must KEEP authorizing -- names carrying internal terminator punctuation.
  "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  "What is the definition of Yahoo! Finance?",
  "What is the current Acme Inc. revenue?",
  "What did Samsung Electronics Co. 삼성전자 report about revenue?",
];

for (const query of CASES) {
  const a = resolveRequestAuthority(query);
  let served = "-";
  if (a.status === "AUTHORIZED") {
    served = `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}`;
  }
  // ESC-015 item 4 removed the informational payload: a PROHIBITED request carries nothing.
  process.stdout.write(`${JSON.stringify(query)}\t${a.status}\t${served}\n`);
}
