/**
 * The two P1 review findings on `82dd516`, reproduced before either is acted on.
 *
 * 1. `Summarize Gamma.` -- another absent clause-opening token, same class as the seven before it.
 *    This is the completeness debt producing a live instance rather than staying abstract, so the
 *    neighbours are probed too: the question is how many more there are, not how to add one.
 *
 * 2. `?` DOES occur inside a registered issuer name. Review cited Companies House company 09804638,
 *    `CAN I USE A QUESTION MARK IN A COMPANY NAME? LTD`. The comment in `requestAuthority.ts` and
 *    the entries in PROJECT_STATE / REVIEW_DEBT all assert that `?` never occurs name-internally,
 *    and that assertion is false. The architect had already warned that "no counterexample
 *    currently known" is evidence for measurement and not an invariant; a counterexample now exists.
 *
 *   npx tsx scripts/reproduce-sol-round2.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES: [string, string][] = [
  // Finding 1: an imperative verb absent from the token set, after a `.` boundary.
  [
    "summarize, redirect form",
    "Should I buy stock? What did Reuters publish about Alpha. Summarize Gamma.",
  ],
  ["summarize, plain form", "What did Reuters publish about Alpha. Summarize Gamma."],
  // Neighbours of the same shape. `explain` and `describe` are already in the set and should
  // refuse; the rest are ordinary ways to ask the same thing and are not.
  ["explain (in the set)", "What did Reuters publish about Alpha. Explain Gamma."],
  ["describe (in the set)", "What did Reuters publish about Alpha. Describe Gamma."],
  ["summarise, en-GB spelling", "What did Reuters publish about Alpha. Summarise Gamma."],
  ["break down", "What did Reuters publish about Alpha. Break down Gamma."],
  ["outline", "What did Reuters publish about Alpha. Outline Gamma."],
  ["chart", "What did Reuters publish about Alpha. Chart Gamma."],
  ["plot", "What did Reuters publish about Alpha. Plot Gamma."],
  ["find", "What did Reuters publish about Alpha. Find Gamma."],

  // Finding 2: a registered issuer name containing `?`.
  [
    "issuer name containing a question mark",
    "What is the definition of Can I Use A Question Mark In A Company Name? Ltd?",
  ],
  [
    "the same name as an attribution source",
    "What did Can I Use A Question Mark In A Company Name? Ltd report about revenue?",
  ],
];

for (const [label, query] of CASES) {
  const a = resolveRequestAuthority(query);
  let served = "-";
  if (a.status === "AUTHORIZED") {
    served = `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}`;
  } else if (a.status === "PROHIBITED" && a.informational) {
    const i = a.informational;
    served = `informational ${i.operation}|${i.subjectRegion}|${i.sourceRegion ?? "-"}`;
  }
  process.stdout.write(`${label}\t${a.status}\t${served}\n`);
}
