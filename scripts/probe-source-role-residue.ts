/**
 * Can an ATTRIBUTED_REPORTED_OBSERVATION's SOURCE role carry residue the way the subject role did?
 *
 * ESC-015 §8 requires both `sourceRegion` and `subjectRegion` to bind exactly. The subject side is
 * covered now; `resolveSourceIdentity` still resolves by occurrence, so the same question has to be
 * asked of it: does a stored source name merely OCCURRING inside a larger source role authorize
 * publishing under that provider's attribution?
 *
 * REPRODUCE BEFORE REPAIR. This probe does not assume the shape exists -- it prints what the parser
 * actually puts in `sourceRegion` for a spread of candidates, so a repair (if any) is aimed at a
 * region that really occurs rather than one I imagined.
 *
 *   npx tsx scripts/probe-source-role-residue.ts
 */

import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

const QUERIES = [
  // Ordinary control.
  "What did Reuters publish about Alpha?",
  // Residue attempts on the SOURCE side specifically.
  "What did Reuters and Bloomberg publish about Alpha?",
  "What did Reuters, Purchase Gamma shares, publish about Alpha?",
  "What did Reuters Purchase Gamma shares publish about Alpha?",
  "What did the Reuters wire service publish about Alpha?",
  "What did Reuters Zorbulate publish about Alpha?",
  "What did some Reuters publish about Alpha?",
  "What has Reuters said about Alpha?",
  "What has the Reuters desk said about Alpha?",
  // And the subject side, as a comparison -- already covered, shown for contrast.
  "What did Reuters publish about Alpha. Purchase Gamma shares.",
];

for (const query of QUERIES) {
  const a = resolveRequestAuthority(query);
  const region = "sourceRegion" in a ? (a as { sourceRegion?: string }).sourceRegion : undefined;
  const subject =
    "subjectRegion" in a ? (a as { subjectRegion?: string }).subjectRegion : undefined;
  console.log(JSON.stringify(query));
  console.log(
    `   status=${a.status} op=${"operation" in a ? a.operation : "-"} ` +
      `source=${JSON.stringify(region)} subject=${JSON.stringify(subject)}`,
  );
}
