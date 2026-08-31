/**
 * A side finding from the IR-112 boundary counterfactual, checked before it is claimed.
 *
 * `CLAUSE_OPENING_TOKENS` carries `will would can could may might must` but NOT `should` or
 * `shall`. The modal paradigm is closed and hand-written, and this file's own comments record that
 * hand-writing a closed class is how members go missing. `should` is the advice modal, so if the
 * omission has any consequence at a real sentence boundary it is on the safety surface.
 *
 * This asks whether it has one: same sentence, same second clause, only the modal varies.
 *
 * READ-ONLY.  npx tsx scripts/ir112-modal-gap.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const MODALS = ["Must", "Would", "Could", "May", "Might", "Can", "Will", "Should", "Shall"];

for (const modal of MODALS) {
  for (const frame of [
    (m: string) => `What is the current US headline CPI. ${m} I buy gold?`,
    (m: string) => `Show me the latest CPI reading. ${m} I move into cash?`,
  ]) {
    const query = frame(modal);
    const a = resolveRequestAuthority(query);
    console.log(`  ${modal.padEnd(7)} ${a.status.padEnd(12)} ${query}`);
  }
}
