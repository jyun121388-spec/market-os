/**
 * What is the Korean-clause rule still doing, now that `?` confirms a boundary on its own?
 *
 * B-M1 -- remove the Korean confirmation entirely -- went from ISOLATED to MISSED the moment the
 * terminator rule landed, because every Korean case the suite poses ends its first clause with `?`
 * and the new rule catches those without consulting the Korean grammar at all.
 *
 * A survivor means the tests do not separate the two. It does NOT mean the rule is dead, and this
 * project's standing rule is that nothing is deleted on the strength of a surviving mutant --
 * only on a disable-and-measure proof. The branch's remaining reach is a Korean clause after a
 * NON-`?` boundary, so that is what these ask about.
 *
 *   npx tsx scripts/probe-korean-after-period.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES = [
  // Korean clause after a `.` boundary -- the shape the `?` rule cannot reach.
  "What is the current Gamma. 현재 기준금리는 얼마인가요?",
  "What did Reuters publish about Alpha. 현재 기준금리는 얼마인가요?",
  "What is the current Gamma; 현재 기준금리는 얼마인가요?",
  "What is the current Gamma! 현재 기준금리는 얼마인가요?",
  // The same after an abbreviation, where the period is name-internal and the head does NOT read.
  "What is the definition of Samsung Electronics Co. 현재 기준금리는 얼마인가요?",
  // Bare Korean NAME after a `.` boundary -- must still authorize; this is the P1 Terra graded.
  "What is the definition of Samsung Electronics Co. 삼성전자?",
  "What did Samsung Electronics Co. 삼성전자 report about revenue?",
  // And the `?` forms, which the terminator rule now covers either way.
  "What is the current Gamma? 현재 기준금리는 얼마인가요?",
];

for (const query of CASES) {
  const a = resolveRequestAuthority(query);
  const served =
    a.status === "AUTHORIZED" ? `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
  process.stdout.write(`${JSON.stringify(query)}\t${a.status}\t${served}\n`);
}
