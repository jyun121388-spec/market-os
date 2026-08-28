/**
 * Structural review found the abbreviation LENGTH threshold fitted rather than principled.
 *
 * `Corp.` is four alphanumerics with no internal period, so `<= 3` calls it a sentence end and
 * `What is the current Acme Corp. revenue?` is refused. `Corp.` is one of the most ordinary issuer
 * suffixes there is. Reproduced here before anything is changed, alongside the rest of the suffix
 * population so the threshold is chosen against a measurement instead of against whichever example
 * was in front of me.
 *
 * Grouped by alphanumeric length, because that is the only thing the current test can see.
 *
 *   npx tsx scripts/probe-abbreviation-length.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

/** Legal-entity and title abbreviations, by the length the helper measures. */
const SUFFIXES: [number, string[]][] = [
  [2, ["Co", "LP", "SA", "AG", "NV", "BV", "AB", "AS", "Oy", "KK"]],
  [3, ["Inc", "Ltd", "LLC", "PLC", "Pty", "Pte", "Bhd", "Sdn", "Srl", "Mfg"]],
  [4, ["Corp", "GmbH", "Dept", "Prof", "Assn", "Bros", "Univ", "SpA"]],
  [5, ["Corpn", "Assoc", "Sched"]],
];

let refused = 0;
let authorized = 0;

for (const [length, suffixes] of SUFFIXES) {
  for (const suffix of suffixes) {
    const query = `What is the current Acme ${suffix}. revenue?`;
    const a = resolveRequestAuthority(query);
    const served = a.status === "AUTHORIZED" ? a.subjectRegion.trim() : "-";
    if (a.status === "AUTHORIZED") {
      authorized += 1;
    } else {
      refused += 1;
    }
    process.stdout.write(`${length}\t${suffix}\t${a.status}\t${served}\n`);
  }
}

// The other direction: ordinary words of the same lengths must still END a sentence, or raising the
// threshold would reopen the swallowing class it was introduced to close.
process.stdout.write("\n");
const ORDINARY = ["Data", "Rate", "Cost", "Gold", "Alpha", "Gamma", "Growth", "Oil", "CPI"];
for (const word of ORDINARY) {
  const query = `What did Reuters publish about ${word}. Summarize Gamma.`;
  const a = resolveRequestAuthority(query);
  const served = a.status === "AUTHORIZED" ? a.subjectRegion.trim() : "-";
  const verdict = a.status === "AUTHORIZED" ? "SWALLOWED" : a.status;
  process.stdout.write(
    `${word.replace(/[^0-9A-Za-z]/gu, "").length}\t${word}\t${verdict}\t${served}\n`,
  );
}

process.stdout.write(`\nsuffixes AUTHORIZED ${authorized}   REFUSED ${refused}\n`);
