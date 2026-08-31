/**
 * IR-112, independent reproduction of the architecture pass's two load-bearing claims.
 *
 * CLAIM 1  the grammar can already express a subject RIGHT EDGE, and where it does, the trailing
 *          adjunct reaches `match.residue` and fails closed instead of being absorbed. Exactly one
 *          construction has a non-null closing marker -- `what does X mean` -- so it is a natural
 *          experiment run by the repository itself rather than a design I have to argue for.
 *
 * CLAIM 2  punctuation alone cannot be the boundary, because identities carry internal
 *          punctuation. If these split at their comma or period the subject is destroyed.
 *
 * READ-ONLY.  npx tsx scripts/ir112-closer.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

function show(query: string): void {
  const a = resolveRequestAuthority(query);
  const region =
    a.status === "AUTHORIZED" ? ` subj=[${a.subjectRegion}]` : `  ${a.detail.slice(0, 64)}`;
  console.log(`  ${a.status.padEnd(12)}${region}\n      ${query}`);
}

console.log("CLAIM 1 -- a CLOSED construction, same tails that break the open ones:");
for (const tail of ["", ", if you have it", ", if available", ", please", ", and should I buy"]) {
  show(`What does quantitative easing mean${tail}?`);
}

console.log("\n  the OPEN construction, for contrast, same tails:");
for (const tail of ["", ", if you have it", ", if available", ", please", ", and should I buy"]) {
  show(`What is the latest US CPI reading${tail}?`);
}

console.log("\nCLAIM 2 -- identities carrying internal punctuation must not split there:");
for (const query of [
  "What is the current Smith, Jones revenue?",
  "What is the latest Yahoo! Finance reading?",
  "What is the current Acme Inc. revenue?",
  "What is the current U.S. rate of inflation?",
]) {
  show(query);
}
