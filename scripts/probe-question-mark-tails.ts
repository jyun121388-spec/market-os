/**
 * Is the `?`-boundary swallow a real request shape, or only a generator artifact?
 *
 * A differential found 258 corpus requests where a fragment ending in `?` is followed by a tail
 * with no clause-opening evidence, and the tail is absorbed into the preceding subject region. Every
 * one of those 258 is a machine-generated string like `Alpha. Finance? Finance?`, and "the corpus
 * says so" is not the same as "a person would type it". These are the terse follow-ups a person
 * actually writes, plus the name-with-punctuation controls that must keep working.
 *
 *   npx tsx scripts/probe-question-mark-tails.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const CASES = [
  // Terse follow-ups. Each ends its first clause with `?`, and the tail names a thing rather than
  // asking a readable question -- which is exactly the shape with no clause-opening evidence.
  "What is the current Acme Inc. revenue? Gamma?",
  "What did Reuters publish about Alpha? Gamma?",
  "What did Reuters publish about Alpha? Alpha Corp?",
  "What is the current US headline CPI? Korea?",
  "What is the current US headline CPI? The same for Korea?",
  // Controls: names carrying internal terminator punctuation. `.` and `!` must stay provisional.
  "What is the definition of Yahoo! Finance?",
  "What is the current Acme Inc. revenue?",
  "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  "What did Samsung Electronics Co. 삼성전자 report about revenue?",
  "What did Mr. Show report about Alpha?",
];

for (const query of CASES) {
  const a = resolveRequestAuthority(query);
  const served =
    a.status === "AUTHORIZED" ? `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
  process.stdout.write(`${JSON.stringify(query)}\t${a.status}\t${served}\n`);
}
