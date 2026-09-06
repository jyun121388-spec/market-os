/**
 * RUN the scheduler rather than describing the queue in prose.
 *
 * `CLAUDE.md` is explicit that a prose summary is not evidence about what is startable, and that
 * the first time this was actually run it contradicted a summary written minutes earlier. So this
 * exists to make the queue an OUTPUT rather than a claim.
 *
 * It is also the autonomous entry point, and that is a stricter job than "print the queue". This
 * used to call `scheduleNextWork()` bare and so inherited the library's optimistic reading of an
 * unstated environment: with every provider key known to be absent it printed `ACTIONABLE 5`, and
 * then handed that queue to the stop sentinel. The environment is now established first, presence
 * only, and passed explicitly — see `scripts/autonomy-context.ts` (IR-126).
 *
 *   npx tsx scripts/next-work.ts [--bus-root <dir>]
 */

import { evaluateStopSentinel } from "../src/server/evolution/scheduler";
import { queueVerdict, scheduleAutonomousWork } from "./autonomy-context";
import { gatherStopEvidence } from "./stop-evidence";

const schedule = scheduleAutonomousWork();
const { queue, environment, gateDeferrals } = schedule;

console.log("== ENVIRONMENT (presence only; no value is read past a boolean) ==");
for (const [provider, presence] of Object.entries(environment.providerKeys)) {
  console.log(`  ${provider.padEnd(9)} key ${presence}`);
}
for (const fact of environment.established) {
  console.log(`  ${fact.field} = ${fact.value}  -- ${fact.because}`);
}
for (const fact of environment.unestablished) {
  console.log(
    `  ${fact.field} UNESTABLISHED, supplied as ${String(fact.supplied)}  -- ${fact.because}`,
  );
}

console.log(`\nACTIONABLE ${queue.actionable.length}   DEFERRED ${queue.deferred.length}\n`);

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

if (gateDeferrals.length > 0) {
  console.log(
    "== DEFERRED BY AN OPEN HUMAN GATE (startable on the environment alone; not on the register) ==",
  );
  for (const d of gateDeferrals) {
    console.log(`  ${d.proposalId}  ${d.gates.map((g) => `${g.id}=${g.status}`).join(", ")}`);
  }
  console.log();
}

const verdict = queueVerdict(schedule);
console.log(`QUEUE VERDICT: ${verdict.verdict} -- ${verdict.because}`);
console.log(
  "  (a statement about the QUEUE. Whether the loop may STOP is the sentinel below, which is a different question.)\n",
);

// Everything the machine can actually be asked is asked; everything else stays undefined.
//
// This used to supply `queue` alone and called that deliberate. It was half right: asserting a zero
// would indeed be the failure the sentinel exists to refuse, but never GATHERING one meant eight of
// its nine conditions had never been evaluated against reality, and `MAY STOP` was false by
// construction rather than by finding. `gatherStopEvidence` establishes what it can prove and
// reports the rest WITH THE REASON. A subset is safe: `mayStop` needs every condition satisfied, so
// an absent field can only hold the answer at false. See `scripts/stop-evidence.ts`.
const busRootFlag = process.argv.indexOf("--bus-root");
const evidence = gatherStopEvidence(busRootFlag === -1 ? undefined : process.argv[busRootFlag + 1]);

const sentinel = evaluateStopSentinel({ queue, ...evidence.supplied });
console.log(`MAY STOP: ${sentinel.mayStop}`);
for (const c of sentinel.conditions) {
  console.log(`  ${c.satisfied ? "yes" : "NO "}  ${c.name} -- ${c.detail}`);
}

console.log("\nNOT ESTABLISHED (the sentinel is refusing on absence, not on a finding):");
for (const { field, because } of evidence.unestablished) console.log(`  ${field} -- ${because}`);
if (sentinel.remaining.length > 0) {
  console.log("\nREMAINING:");
  for (const r of sentinel.remaining) console.log(`  ${r}`);
}
