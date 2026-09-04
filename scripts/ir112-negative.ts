/**
 * IR-112 step 4 groundwork: WHICH mechanism is actually refusing the negative controls?
 *
 * READ-ONLY. If the directive continuations are refused only because a personal pronoun got
 * absorbed into the subject region, then excising trailing adjuncts from that region would
 * silently unrefuse them -- the over-broadening failure the task names. So test directive
 * continuations that carry NO personal pronoun at all.
 *
 *   npx tsx scripts/ir112-negative.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const BASE = "What is the latest US CPI reading";

const CONTINUATIONS = [
  // pronoun-free directive / advice continuations -- these MUST stay refused
  ", and recommend an entry point",
  ", then place the order",
  ", and rebalance the portfolio",
  ", and say whether to buy",
  ", and pick the best sector",
  ", then decide the allocation",
  ", and forecast next month",
  ", and predict where it goes next",
  // pronoun-bearing directive continuations -- refused today, but by which rule?
  ", and tell me if I should buy",
  ", and give me a price target",
  // hedges, for the contrast
  ", if you have it",
  ", if available",
];

for (const cont of CONTINUATIONS) {
  const query = `${BASE}${cont}?`;
  const a = resolveRequestAuthority(query);
  const verdict =
    a.status === "AUTHORIZED"
      ? `AUTHORIZED/${a.operation} subj=[${a.subjectRegion}]`
      : `${a.status}  ${"detail" in a ? a.detail.slice(0, 90) : ""}`;
  console.log(`${cont}\n    ${verdict}\n`);
}
