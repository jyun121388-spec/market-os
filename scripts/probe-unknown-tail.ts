/**
 * How wide is the swallowing class actually? The unknown-tail safety matrix.
 *
 * Architect review graded the unbounded clause-opening set a P1 that blocks closure, and named this
 * measurement: a candidate boundary after a head that READS, followed by tails of every shape the
 * lexical set does not enumerate. The required outcome under a fail-closed policy is refusal for
 * every unknown tail. What this measures is the CURRENT behaviour, so the size of the live defect
 * is a number rather than an impression.
 *
 * The head is held constant and is known to read alone, so any difference is the tail's doing.
 *
 *   npx tsx scripts/probe-unknown-tail.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const HEAD = "What did Reuters publish about Alpha.";

/** Tails, by shape. `.` boundary throughout: `?` is confirmed by the terminator rule already. */
const TAILS: [string, string[]][] = [
  [
    "imperative, not in the set",
    [
      "Summarize Gamma.",
      "Summarise Gamma.",
      "Break down Gamma.",
      "Outline Gamma.",
      "Chart Gamma.",
      "Plot Gamma.",
      "Find Gamma.",
      "Check Gamma.",
      "Look up Gamma.",
      "Pull the Gamma series.",
      "Send me Gamma.",
      "Graph Gamma.",
    ],
  ],
  [
    "imperative, in the set (control)",
    ["Explain Gamma.", "Describe Gamma.", "Tell me Gamma.", "Show Gamma.", "List Gamma."],
  ],
  [
    "interrogative fragment",
    ["Who published Gamma?", "Why the Gamma decline?", "How about Gamma?", "What of Gamma?"],
  ],
  ["bare noun", ["Gamma.", "Revenue.", "Inflation.", "Unemployment."]],
  ["proper-name-shaped", ["Gamma Corp.", "Alpha Holdings.", "Beta Industries.", "Delta Partners."]],
  ["coined token", ["Zorbulate Gamma.", "Frobnicate Gamma.", "Quux Gamma.", "Blint Gamma."]],
  ["hangul", ["감마 알려줘.", "감마."]],
  ["digits", ["2024.", "10 Gamma.", "Q3 Gamma."]],
];

let swallowed = 0;
let refused = 0;

for (const [shape, tails] of TAILS) {
  for (const tail of tails) {
    const query = `${HEAD} ${tail}`;
    const a = resolveRequestAuthority(query);
    let verdict = a.status as string;
    let served = "-";
    if (a.status === "AUTHORIZED") {
      served = `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}`;
      // The head alone would serve subject " alpha ". Anything longer means the tail was absorbed.
      if (a.subjectRegion.trim() !== "alpha") {
        verdict = "SWALLOWED";
        swallowed += 1;
      }
    } else {
      refused += 1;
    }
    process.stdout.write(`${shape}\t${verdict}\t${served}\t${JSON.stringify(tail)}\n`);
  }
}

process.stdout.write(`\nSWALLOWED ${swallowed}\tREFUSED ${refused}\n`);
