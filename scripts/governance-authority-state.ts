/**
 * What the REAL durable state says about live-provider authority, right now.
 *
 *   npx tsx scripts/governance-authority-state.ts
 *
 * Not a summary of the documents — the documents are the input. This runs the same parser the
 * autonomy boundary runs, over the same `docs/HUMAN_GATE_QUEUE.md` bytes, and asks the same
 * questions the scheduler asks. It exists because a governance claim read out of prose is exactly
 * the thing that went wrong: `docs/HUMAN_GATE_QUEUE.md` said one thing, a ledger entry said
 * another, and nothing mechanical noticed the two had diverged.
 *
 * Reads no credential, contacts no provider, and writes nothing.
 */
import { readFileSync } from "node:fs";

import { parseGateRegister } from "./autonomy-context";
import { capabilityGapProposals } from "../src/server/evolution/proposal";
import { CAPABILITY_AXES, PROVIDER_CAPABILITIES } from "../src/server/fabric/providerCapability";
import {
  authorizingGateFor,
  liveUseAuthorization,
  PROVIDERS_REQUIRING_AUTHORIZATION,
} from "../src/server/fabric/providerAuthorization";

const register = readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8");
const parsed = parseGateRegister(register);

console.log("GATE REGISTER, as the real parser reads it");
for (const gate of ["HG-002", "HG-003", "HG-004", "HG-006"]) {
  console.log(`  ${gate}  ${parsed.get(gate) ?? "(absent)"}`);
}

console.log("\nLIVE-USE AUTHORIZATION, as the gate boundary derives it");
for (const provider of PROVIDERS_REQUIRING_AUTHORIZATION) {
  const gate = authorizingGateFor(provider);
  const decision = liveUseAuthorization(provider, parsed);
  console.log(`  ${provider.padEnd(10)} gate=${gate ?? "(none)"}  ${decision.state}`);
  console.log(`             ${decision.because}`);
}

console.log("\nCAPABILITY MATRIX, which is a technical fact and not an authorization");
for (const profile of PROVIDER_CAPABILITIES) {
  const tally: Record<string, number> = {};
  for (const axis of CAPABILITY_AXES) {
    const state = profile.axes[axis].state;
    tally[state] = (tally[state] ?? 0) + 1;
  }
  console.log(`  ${profile.sourceCode.padEnd(10)} ${JSON.stringify(tally)}`);
}

console.log("\nPROPOSALS THE GENERATOR EMITS, and what blocks each");
for (const proposal of capabilityGapProposals()) {
  console.log(
    `  ${proposal.id.padEnd(24)} provider=${String(proposal.provider)}  blockedBy=${String(proposal.blockedBy)}`,
  );
}

const callsAProvider = capabilityGapProposals().filter(
  (p) => p.requiredGovernance.includes("CALL_FREE_PROVIDER") && p.provider !== undefined,
);
const unguarded = callsAProvider.filter((p) => p.blockedBy === undefined);
console.log("\nPROPOSALS THAT WOULD CALL A KEYED PROVIDER");
console.log(`  total ${callsAProvider.length}, of which ${unguarded.length} name no gate`);
for (const p of unguarded) console.log(`    UNGUARDED  ${p.id} (${String(p.provider)})`);
