/**
 * Prints what the Evolution Engine currently observes and proposes.
 *
 * Pure over the ledger and the capability matrix — no database, no network, no writes, and nothing
 * in v1 imports any of it. The Engine proposes; Governance decides; a human applies.
 *
 *   npm run evolution:shadow
 */
import { detectWeaknesses, isolatedIncidents } from "@/server/evolution/detect";
import { BACKFILLED_LEDGER } from "@/server/evolution/ledger";
import {
  capabilityGapProposals,
  clusterProposals,
  observedEvidence,
  type Proposal,
} from "@/server/evolution/proposal";
import { evaluateAction } from "@/server/governance/policy";
import { isWorkExhausted, scheduleNextWork } from "@/server/evolution/scheduler";

function printProposal(proposal: Proposal) {
  console.log(`\n${proposal.id}`);
  console.log(`  OBSERVED    ${proposal.observation}`);
  if (proposal.prediction) console.log(`  PREDICTS    ${proposal.prediction}`);
  if (proposal.falsifiedBy) console.log(`  WRONG IF    ${proposal.falsifiedBy}`);
  console.log(`  PROPOSES    ${proposal.proposedChange}`);
  console.log(`  BENEFIT     ${proposal.expectedBenefit}`);
  console.log(`  RISK        ${proposal.expectedRisk}`);
  console.log(`  VERIFY      ${proposal.requiredVerify.join("; ")}`);

  // What carrying this out would need permission for, decided by the shadow policy engine rather
  // than asserted here. A proposal that does not say what it would require is a wish.
  const decisions = proposal.requiredGovernance.map((kind) => {
    const evaluation = evaluateAction({ kind });
    return `${kind}=${evaluation.decision}`;
  });
  console.log(`  GOVERNANCE  ${decisions.join(", ")}`);
  if (proposal.blockedBy) console.log(`  BLOCKED BY  ${proposal.blockedBy}`);
  console.log(
    `  EVIDENCE    ${observedEvidence(proposal).length} observed, ${
      proposal.evidence.length - observedEvidence(proposal).length
    } inferred`,
  );
}

function main() {
  const weaknesses = detectWeaknesses(BACKFILLED_LEDGER);
  const isolated = isolatedIncidents(BACKFILLED_LEDGER);

  console.log(
    `Evolution shadow — ${BACKFILLED_LEDGER.length} ledger entries, ${weaknesses.length} clusters, ` +
      `${isolated.length} isolated incident(s)\n`,
  );

  console.log("CLUSTERS");
  for (const w of weaknesses) {
    console.log(
      `  ${w.category.padEnd(22)} ${String(w.instances.length).padStart(2)} instances  ` +
        `${w.worstSeverity}  ${w.scope}  [${w.instances.join(" ")}]`,
    );
  }

  if (isolated.length > 0) {
    // Recorded rather than dropped: a single event is not a weakness, and pretending it never
    // happened is how the second occurrence starts from zero.
    console.log("\nNOT YET RECURRED (one instance each, kept so they are not lost)");
    for (const entry of isolated) {
      console.log(`  ${entry.id.padEnd(8)} ${entry.category.padEnd(22)} ${entry.summary}`);
    }
  }

  console.log("\n\nPROPOSALS FROM CLUSTERS");
  for (const proposal of clusterProposals()) printProposal(proposal);

  console.log("\n\nPROPOSALS FROM PROVIDER CAPABILITY GAPS");
  for (const proposal of capabilityGapProposals()) printProposal(proposal);

  // The meta-loop, printed: Evolution proposes, Governance classifies, the scheduler says what
  // may be started now. Nothing here executes anything — there is deliberately no way to.
  const queue = scheduleNextWork({
    context: {
      verificationGreen: true,
      credentialsAvailable: false,
      providerKeyAvailable: false,
      includedModelQuotaAvailable: true,
    },
  });

  console.log("\n\nNEXT WORK QUEUE — what an agent may start now");
  for (const work of queue.actionable) {
    console.log(`  ${work.authority.padEnd(31)} ${work.proposal.id}`);
  }
  console.log("\nDEFERRED — recorded, and NOT a reason to stop");
  for (const work of queue.deferred) {
    console.log(
      `  ${work.authority.padEnd(31)} ${work.proposal.id}  ${work.blockedBy ?? ""}`.trimEnd(),
    );
  }
  console.log(
    `\nWork exhausted: ${isWorkExhausted(queue)} — meaning nothing is STARTABLE, not that nothing remains.`,
  );

  console.log(
    "\nShadow mode: nothing above was applied, no code was changed, and no v1 module imports " +
      "the Engine. Every proposal names the governed actions it would require, and the scheduler " +
      "exports no way to carry any of them out.",
  );
}

main();
