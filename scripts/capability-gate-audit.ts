/**
 * The provider capability census, and the part of the gate invariant a type cannot hold.
 *
 * The PROVIDER_ASSUMPTION cluster is the scheduler's top-ranked actionable item. Its proposed
 * change has two halves: no cell moves to SUPPORTED without a live response, which needs live
 * provider calls and is credential-blocked for three of four providers; and every NOT_VERIFIED
 * cell names the gate that would clear it, which needs nothing but this repository.
 *
 * When this script was first written, `blockedBy` was optional on every state and BOTH directions
 * of that second half were runtime questions. They are not any more: `CapabilityEvidence` is a
 * discriminated union in which `NOT_VERIFIED` requires a gate and every other state forbids one,
 * so a cell that violates it no longer compiles. Those two checks were deleted from here rather
 * than kept as reassurance -- a runtime check for something the compiler already refuses is a test
 * that can never fail, which is worse than no test because it reads like coverage.
 *
 * What remains is what the type genuinely cannot say: that each gate NAMED is a gate that EXISTS,
 * and that the classifier actually forwards it to the caller who has to act on it.
 *
 * READ-ONLY.  npx tsx scripts/capability-gate-audit.ts
 */

import { readFileSync } from "node:fs";
import {
  PROVIDER_CAPABILITIES,
  CAPABILITY_AXES,
  classifyEvidenceGap,
} from "../src/server/fabric/providerCapability";

/** Gate ids the project actually documents. A gate nobody has written down cannot be cleared. */
function documentedGates(): Set<string> {
  const text = [
    readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8"),
    readFileSync("docs/PROJECT_STATE.md", "utf8"),
  ].join("\n");
  return new Set(text.match(/\bHG-\d{3}\b/g) ?? []);
}

let cells = 0;
const byState = new Map<string, number>();
const gates = new Map<string, number>();

for (const profile of PROVIDER_CAPABILITIES) {
  for (const axis of CAPABILITY_AXES) {
    const evidence = profile.axes[axis];
    cells += 1;
    byState.set(evidence.state, (byState.get(evidence.state) ?? 0) + 1);
    if (evidence.state === "NOT_VERIFIED") {
      gates.set(evidence.blockedBy, (gates.get(evidence.blockedBy) ?? 0) + 1);
    }
  }
}

console.log(
  `providers ${PROVIDER_CAPABILITIES.length}  axes ${CAPABILITY_AXES.length}  cells ${cells}\n`,
);
console.log("states:");
for (const [state, n] of [...byState].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${state}`);
}

const documented = documentedGates();
console.log("\ngates named by NOT_VERIFIED cells:");
const undocumented: string[] = [];
for (const [gate, n] of [...gates].sort((a, b) => b[1] - a[1])) {
  const known = documented.has(gate);
  if (!known) undocumented.push(gate);
  console.log(`  ${String(n).padStart(3)}  ${gate}  ${known ? "documented" : "NOT DOCUMENTED"}`);
}
console.log(`\ngates named but not documented anywhere: ${undocumented.length}`);
for (const g of undocumented) console.log(`  ${g}`);

// The classifier is the consumer that forwards `blockedBy` to a reader. The union guarantees the
// cell has a gate; it does not guarantee this function passes it on.
let unreachable = 0;
for (const profile of PROVIDER_CAPABILITIES) {
  for (const axis of CAPABILITY_AXES) {
    const gap = classifyEvidenceGap(profile.sourceCode, axis, false);
    if (gap.kind === "VERIFICATION_DEBT" && !gap.blockedBy) {
      unreachable += 1;
      console.log(`  gate lost in classifyEvidenceGap: ${profile.sourceCode}.${axis}`);
    }
  }
}
console.log(`\nVERIFICATION_DEBT gaps whose gate does not reach the caller: ${unreachable}`);
