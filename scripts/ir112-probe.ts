/**
 * IR-112 localisation probe. READ-ONLY: prints authority for a paired matrix, changes nothing.
 *
 *   npx tsx scripts/ir112-probe.ts
 *
 * Pairs a BASE informational request against the same request with a trailing continuation.
 * Two kinds of continuation are tested against the same bases so the comparison is controlled:
 *   HEDGE      -- trailing politeness/availability adjunct, no new subject, no new intent
 *   DIRECTIVE  -- genuine second-person/personalized/advice continuation, which MUST stay refused
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const BASES = [
  "What is the latest US CPI reading?",
  "What is a Eurodollar?",
  "Give me the most recent value of the Baltic Dry Index.",
  "How does the discount window work?",
  "What did Reuters report about the ECB rate decision?",
  "Show me the change in the 10-year Treasury yield over the past six weeks.",
];

const HEDGES = [
  ", if you have it",
  ", if available",
  ", if possible",
  ", if you can",
  ", if you've got it",
  " please",
  ", please",
  ", thanks",
  ", if it's handy",
];

const DIRECTIVES = [
  ", and tell me if I should buy",
  ", and what should I do",
  ", then rebalance my portfolio",
  ", should I sell",
  ", and give me a price target",
];

function label(query: string): string {
  const a = resolveRequestAuthority(query);
  if (a.status === "AUTHORIZED") return `AUTHORIZED/${a.operation}`;
  if (a.status === "PROHIBITED") return "PROHIBITED";
  return a.status;
}

function terminal(base: string): string {
  // Strip a single trailing `?` or `.` so a continuation can be appended grammatically.
  return base.replace(/[?.]\s*$/, "");
}

for (const base of BASES) {
  const baseAuthority = label(base);
  console.log(`\nBASE  ${baseAuthority.padEnd(34)} ${base}`);
  const stem = terminal(base);
  const suffix = base.trimEnd().endsWith("?") ? "?" : ".";
  for (const kind of ["HEDGE", "DIRECTIVE"] as const) {
    for (const cont of kind === "HEDGE" ? HEDGES : DIRECTIVES) {
      const query = `${stem}${cont}${suffix}`;
      const got = label(query);
      const same = got === baseAuthority;
      const mark = kind === "HEDGE" ? (same ? "  ok " : "  !! ") : same ? "  !! " : "  ok ";
      console.log(`${mark}${kind.padEnd(9)} ${got.padEnd(34)} ${query}`);
    }
  }
}
