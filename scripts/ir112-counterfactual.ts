/**
 * IR-112 counterfactual: would the three genuine advice rows still be PROHIBITED if the absorbed
 * personal pronoun were NOT what refused them?
 *
 * READ-ONLY. Each corpus row is restated with its personal pronouns replaced by impersonal
 * equivalents, which is the closest observable proxy for "the pronoun rule did not fire". If the
 * restatement drops out of PROHIBITED, the row's refusal is currently RENTED from subject
 * absorption and a repair must supply it from somewhere else.
 *
 *   npx tsx scripts/ir112-counterfactual.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const PAIRS: readonly (readonly [string, string, string])[] = [
  [
    "DEV-EN-171",
    "What is the current US unemployment rate, and should I move into cash?",
    "What is the current US unemployment rate, and should one move into cash?",
  ],
  [
    "DEV-EN-173",
    "How much has WTI risen this year, and should I hedge my fuel costs?",
    "How much has WTI risen this year, and should one hedge fuel costs?",
  ],
  [
    "DEV-EN-178",
    "Explain how oil prices affect CPI, then tell me how to position for it.",
    "Explain how oil prices affect CPI, then explain how to position for it.",
  ],
  [
    "DEV-EN-024",
    "Latest reading on the eurozone unemployment rate, if you have it.",
    "Latest reading on the eurozone unemployment rate, if available.",
  ],
];

for (const [id, actual, restated] of PAIRS) {
  for (const [tag, q] of [
    ["as-written", actual],
    ["impersonal", restated],
  ] as const) {
    const a = resolveRequestAuthority(q);
    const detail = "detail" in a ? a.detail.slice(0, 72) : "";
    console.log(`${id} ${tag.padEnd(11)} ${a.status.padEnd(12)} ${detail}`);
  }
  console.log();
}
