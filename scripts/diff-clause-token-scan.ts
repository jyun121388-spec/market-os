/**
 * Differential corpus for B-M3: does scanning ALL tokens of a fragment for a clause-opening word
 * differ from scanning only its FIRST token?
 *
 * The mutation survived the whole binding suite, which says the tests do not separate the two
 * rules. It does NOT say the two rules agree. Hand analysis has been wrong about exactly this kind
 * of question twice in this unit -- once in each direction -- so the question is settled by
 * generating requests and comparing outputs, not by argument.
 *
 * This script only PRINTS a fingerprint per generated request. It is run twice, against the
 * original and against the mutant, by `scripts/mutation/differential.py`, which owns the
 * write/restore transaction. Any line that differs between the two runs is a discriminating
 * request; if no line differs across the whole corpus, the two rules agree on everything this
 * corpus can express and B-M3 is EQUIVALENT_OVER_CORPUS rather than merely untested.
 *
 *   npx tsx scripts/diff-clause-token-scan.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

/**
 * Fragment pool. Each entry is a clause or a name fragment that can legally follow a candidate
 * boundary. The pool is chosen to cover the cases the rule is ABOUT, not to be representative
 * English: names carrying internal terminator punctuation, tails whose clause-opening word is not
 * first, tails with no clause-opening word at all, and Hangul.
 */
const FRAGMENTS = [
  // clause openers in FIRST position -- both rules must confirm
  "What is the CPI",
  "How did rates move",
  "Did Reuters publish anything",
  "Tell me the unemployment rate",
  "Explain the mechanism",
  // clause openers in a LATER position -- this is where the two rules can diverge
  "In 2024 what was the CPI",
  "Since then how did rates move",
  "For Korea what is the policy rate",
  "As of March did Reuters publish anything",
  "By region which series moved",
  "Under the new basis is the reading comparable",
  "At the time there was a revision",
  "Of those which one moved",
  // The tokens P1 review found missing, and the four that reproducing it found alongside them.
  // Each of these was being swallowed into the preceding subject region.
  "Who published Gamma",
  "Why the Gamma decline",
  "Compare it to Gamma",
  "List the Gamma figures",
  "Any Gamma figures",
  "Same for Gamma",
  // The over-refusal risk those additions carry: the SAME words as name tails, after a name's
  // internal terminator. `list`, `any` and `same` are ordinary enough to appear in one.
  "list",
  "any Gamma",
  "same period revenue",
  "Compare Inc",
  "List Ltd revenue",
  // no clause-opening token anywhere -- neither rule may confirm
  "Finance",
  "revenue",
  "the Gamma level",
  "Bureau of Labor Statistics",
  "10 index level",
  "Alpha Corp",
  // Hangul -- confirmed by script, independent of either token rule
  "현재 기준금리는 얼마인가요",
  "물가상승률은 어떻게 되나요",
];

/** Openers, including ones that make the whole request PROHIBITED. */
const HEADS = [
  "Should I buy stock",
  "What did Reuters publish about Alpha",
  "Yahoo",
  "Acme Inc",
  "The U.S",
  "What is the CPI",
];

const SEPARATORS = [". ", "? ", "! ", "; "];

function fingerprint(query: string): string {
  const a = resolveRequestAuthority(query);
  if (a.status === "AUTHORIZED") {
    return [
      "AUTHORIZED",
      a.operation,
      a.subjectRegion,
      a.sourceRegion ?? "-",
      a.interval ?? "-",
      a.causeRegion ?? "-",
      a.effectRegion ?? "-",
      a.subjectIdentity,
    ].join("|");
  }
  // ESC-015 item 4: a PROHIBITED request carries no informational payload, so there is nothing
  // left to fingerprint beyond the status itself.
  return a.status;
}

const queries: string[] = [];
for (const head of HEADS) {
  for (const s1 of SEPARATORS) {
    for (const f1 of FRAGMENTS) {
      queries.push(`${head}${s1}${f1}?`);
      for (const s2 of SEPARATORS) {
        for (const f2 of FRAGMENTS) {
          queries.push(`${head}${s1}${f1}${s2}${f2}?`);
        }
      }
    }
  }
}

// Deterministic order, deduplicated, so the two runs are line-comparable.
const seen = new Set<string>();
let emitted = 0;
for (const q of queries) {
  if (seen.has(q)) continue;
  seen.add(q);
  let result: string;
  try {
    result = fingerprint(q);
  } catch (error) {
    // A throw is itself a behavioural difference worth diffing, not a reason to stop.
    result = `THREW|${error instanceof Error ? error.message : String(error)}`;
  }
  process.stdout.write(`${JSON.stringify(q)}\t${result}\n`);
  emitted += 1;
}
process.stdout.write(`CORPUS_SIZE\t${emitted}\n`);
