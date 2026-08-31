/**
 * IR-112 step 2: is the mechanism a hedge-vocabulary problem or a SUBJECT REGION EXTENT problem?
 *
 * READ-ONLY. Prints the bound subject region for every hedged variant that still authorizes.
 * If the hypothesis is right, the adjunct is INSIDE the subject region even when it does not
 * change the verdict -- which makes the surviving cases lucky rather than correct.
 *
 *   npx tsx scripts/ir112-subject.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES = [
  "What is the latest US CPI reading?",
  "What is the latest US CPI reading, if available?",
  "What is the latest US CPI reading, if possible?",
  "What is the latest US CPI reading, if it's handy?",
  "What is the latest US CPI reading, thanks?",
  "What is the latest US CPI reading, please?",
  "What is the latest US CPI reading please?",
  "What is the latest US CPI reading, if you have it?",
  "What is the latest US CPI reading, if he has it?",
  "What is the latest US CPI reading, if the desk has it?",
  "Give me the most recent value of the Baltic Dry Index.",
  "Give me the most recent value of the Baltic Dry Index, if available.",
  "Give me the most recent value of the Baltic Dry Index, if you have it.",
  "What did Reuters report about the ECB rate decision?",
  "What did Reuters report about the ECB rate decision, if available?",
  "Show me the change in the 10-year Treasury yield over the past six weeks.",
  "Show me the change in the 10-year Treasury yield over the past six weeks, if available.",
];

for (const query of CASES) {
  const a = resolveRequestAuthority(query);
  if (a.status === "AUTHORIZED") {
    const extras = [
      a.sourceRegion === undefined ? "" : ` src=[${a.sourceRegion}]`,
      a.interval === undefined ? "" : ` ivl=[${a.interval}]`,
    ].join("");
    console.log(`AUTHORIZED/${a.operation.padEnd(31)} subj=[${a.subjectRegion}]${extras}`);
  } else {
    console.log(`${a.status.padEnd(42)} ${query}`);
  }
  console.log(`   <- ${query}`);
}
