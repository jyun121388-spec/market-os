/**
 * The other direction of B-M3, which the first corpus could not see.
 *
 * Scanning ALL tokens of a tail is strictly more confirming than scanning only the first, so the
 * risk it carries is over-refusal: a NAME whose tail happens to contain a clause-opening word
 * (`show`, `has`, `will`, `is`, `there`) after a name-internal terminator. The generated corpus
 * contained no such name, so it reported zero over-refusals -- which is a statement about the
 * corpus, not about the rule.
 *
 *   npx tsx scripts/probe-name-tail-openers.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const QUERIES = [
  // name-internal terminator, tail containing a clause-opening verb
  "What did Bloomberg L.P. show about Alpha?",
  "What did Acme Inc. tell investors about revenue?",
  "What did Alpha Corp. give as guidance?",
  "What is the current Acme Inc. will-they-report status?",
  // tail containing a clause-opening auxiliary
  "What is the current Acme Inc. has-reported figure?",
  "What did the U.S. Securities and Exchange Commission is-it-final ruling say?",
  // controls: the same shapes without a clause-opening word in the tail
  "What did Bloomberg L.P. publish about Alpha?",
  "What did Acme Inc. report about revenue?",
  "What is the definition of Yahoo! Finance?",
  "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  // Architect review named these two and marked them UNDETERMINED, asking for exactly this
  // measurement rather than asserting them. A title abbreviation whose name IS a clause-opening
  // token, and a mixed-script name whose tail is Hangul.
  "What is the definition of Mr. Show?",
  "What did Mr. Show report about Alpha?",
  "What is the definition of Samsung Electronics Co. 삼성전자?",
  "What did Samsung Electronics Co. 삼성전자 report about revenue?",
  // the discriminating swallow case, for contrast
  "What did Reuters publish about Alpha. In 2024 what was the CPI?",
];

// Exactly one line per query, always: `differential.py` compares the two runs line by line and
// refuses a comparison whose line counts differ, which is the right refusal and which a probe that
// prints a second line only for AUTHORIZED results will always trigger.
for (const query of QUERIES) {
  const a = resolveRequestAuthority(query);
  const served =
    a.status === "AUTHORIZED" ? `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}` : "-";
  process.stdout.write(`${JSON.stringify(query)}\t${a.status}\t${served}\n`);
}
