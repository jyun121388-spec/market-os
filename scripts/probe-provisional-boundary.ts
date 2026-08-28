/**
 * Where the LEXICAL evidence still does the work, now that terminator shape decides `.` and `?`.
 *
 * Eight mutants went ISOLATED -> MISSED when Option B landed: the Korean clause rule, the
 * determiner rules, and all three token groups. Same cause as every previous time -- the
 * discriminators were written at `.` boundaries, and `.` is now decided by abbreviation shape
 * before any lexical rule is consulted.
 *
 * The lexical rules are not dead. They are the ONLY protection at `!` and `;`, which stay
 * provisional because `Yahoo!` is a brand and `Smith; Jones` is a partnership. So the
 * discriminators have to move there, and this measures which of them actually refuse before any
 * of it is asserted as a test.
 *
 *   npx tsx scripts/probe-provisional-boundary.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

/** The lexical rule each case is meant to exercise, and a tail that should trigger it. */
const TAILS: [string, string][] = [
  ["interrogative who", "Who published Gamma?"],
  ["interrogative why", "Why the Gamma decline?"],
  ["interrogative what", "What about the Gamma level?"],
  ["imperative compare", "Compare it to Gamma."],
  ["imperative list", "List the Gamma figures."],
  ["imperative tell", "Tell me the Gamma level."],
  ["determiner the", "The Gamma level too?"],
  ["determiner any", "Any Gamma figures?"],
  ["determiner same", "Same for Gamma?"],
  ["korean clause", "현재 기준금리는 얼마인가요?"],
  ["korean bare nominal (must NOT confirm)", "삼성전자?"],
];

const HEADS: [string, string][] = [
  ["!", "What did Reuters publish about Alpha!"],
  [";", "What did Reuters publish about Alpha;"],
];

for (const [boundary, head] of HEADS) {
  for (const [rule, tail] of TAILS) {
    const a = resolveRequestAuthority(`${head} ${tail}`);
    const served = a.status === "AUTHORIZED" ? `${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
    process.stdout.write(`${boundary}\t${a.status}\t${rule}\t${served}\n`);
  }
}

// The accumulation case: a run that crosses a CONFIRMED boundary and then an UNCONFIRMED one. If
// confirmation resets instead of accumulating, the second boundary launders the first.
const LAUNDER = [
  "What did Reuters publish about Alpha? What about the Gamma! level?",
  "What did Reuters publish about Alpha? What about the Gamma; level?",
  "What did Reuters publish about Alpha? Who published Gamma! Finance?",
];
process.stdout.write("\n");
for (const query of LAUNDER) {
  const a = resolveRequestAuthority(query);
  const served = a.status === "AUTHORIZED" ? `${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
  process.stdout.write(`launder\t${a.status}\t${served}\t${JSON.stringify(query)}\n`);
}
