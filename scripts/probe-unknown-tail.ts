/**
 * How wide is the swallowing class, per BOUNDARY CHARACTER?
 *
 * The original version of this probe used `.` throughout and measured 28 of 38 tails swallowed.
 * That number is what graded the class a P1. ESC-015 Option B then closed it -- but only for the
 * terminators whose SHAPE can be trusted, and this probe now sweeps all three so the residual is a
 * number rather than an impression.
 *
 *     `.`  decided by abbreviation shape, so the class should be closed here
 *     `!`  provisional, because `Yahoo!` is a brand -- lexical evidence only
 *     `;`  provisional, because `Smith; Jones` is a partnership name -- lexical evidence only
 *
 * The head is held constant and reads alone, so any difference is the tail's doing.
 *
 *   npx tsx scripts/probe-unknown-tail.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const HEADS: [string, string][] = [
  [".", "What did Reuters publish about Alpha."],
  ["!", "What did Reuters publish about Alpha!"],
  [";", "What did Reuters publish about Alpha;"],
];

/** Tails, by shape. */
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

const totals = new Map<string, { swallowed: number; refused: number }>();

for (const [boundary, head] of HEADS) {
  totals.set(boundary, { swallowed: 0, refused: 0 });
  for (const [shape, tails] of TAILS) {
    for (const tail of tails) {
      const query = `${head} ${tail}`;
      const a = resolveRequestAuthority(query);
      let verdict: string = a.status;
      let served = "-";
      if (a.status === "AUTHORIZED") {
        served = `${a.operation}|${a.subjectRegion}|${a.sourceRegion ?? "-"}`;
        // The head alone serves subject " alpha ". Anything longer means the tail was absorbed.
        if (a.subjectRegion.trim() !== "alpha") {
          verdict = "SWALLOWED";
          totals.get(boundary)!.swallowed += 1;
        }
      } else {
        totals.get(boundary)!.refused += 1;
      }
      process.stdout.write(
        `${boundary}\t${shape}\t${verdict}\t${served}\t${JSON.stringify(tail)}\n`,
      );
    }
  }
}

process.stdout.write("\n");
for (const [boundary, { swallowed, refused }] of totals) {
  process.stdout.write(
    `boundary ${boundary}   SWALLOWED ${swallowed}   REFUSED ${refused}   of ${swallowed + refused}\n`,
  );
}
