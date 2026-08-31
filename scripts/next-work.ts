/**
 * RUN the scheduler rather than describing the queue in prose.
 *
 * `CLAUDE.md` is explicit that a prose summary is not evidence about what is startable, and that
 * the first time this was actually run it contradicted a summary written minutes earlier. So this
 * exists to make the queue an OUTPUT rather than a claim.
 *
 *   npx tsx scripts/next-work.ts
 */

import { scheduleNextWork, evaluateStopSentinel } from "../src/server/evolution/scheduler";

const queue = scheduleNextWork();

console.log(`ACTIONABLE ${queue.actionable.length}   DEFERRED ${queue.deferred.length}\n`);

for (const [label, items] of [
  ["ACTIONABLE", queue.actionable],
  ["DEFERRED", queue.deferred],
] as const) {
  console.log(`== ${label} ==`);
  for (const work of items) {
    console.log(`  ${work.proposal.id}  [${work.authority}]`);
    console.log(`      ${work.proposal.observation}`);
    console.log(`      rank: ${work.rankReason}`);
    if (work.blockedBy) console.log(`      blockedBy: ${work.blockedBy}`);
  }
  console.log();
}

// Only `queue` is supplied. Every other input is deliberately left undefined so the sentinel
// reports each unestablished condition as unsatisfied -- unknown is not zero, and asserting a zero
// here would be the exact failure this module exists to refuse.
const sentinel = evaluateStopSentinel({ queue });
console.log(`MAY STOP: ${sentinel.mayStop}`);
for (const c of sentinel.conditions) {
  console.log(`  ${c.satisfied ? "yes" : "NO "}  ${c.name} -- ${c.detail}`);
}
if (sentinel.remaining.length > 0) {
  console.log("\nREMAINING:");
  for (const r of sentinel.remaining) console.log(`  ${r}`);
}
