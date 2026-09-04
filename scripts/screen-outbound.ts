/**
 * Screen a file destined for issue #2 before it is posted. Issue #2 is publicly readable.
 *
 * Nothing outbound goes to the escalation channel without passing `screenPublicComment` first,
 * and the screen must be RUN rather than trusted: this file exists so that "screened" means a
 * command was executed and its findings printed, not that I read the text and felt fine about it.
 *
 *   npx tsx scripts/screen-outbound.ts <path> [<path> ...]
 */

import { readFileSync } from "node:fs";
import { screenPublicComment } from "../src/server/escalation/screen";

let failures = 0;

for (const path of process.argv.slice(2)) {
  const body = readFileSync(path, "utf8");
  const findings = screenPublicComment(body);
  const label = `${path} (${body.split(/\r?\n/).length} lines)`;
  if (findings.length === 0) {
    process.stdout.write(`CLEAN  ${label}\n`);
    continue;
  }
  failures += findings.length;
  process.stdout.write(`FINDINGS ${findings.length}  ${label}\n`);
  for (const finding of findings) {
    process.stdout.write(`  line ${finding.line}  ${finding.category}: ${finding.reason}\n`);
  }
}

process.stdout.write(failures === 0 ? "\nSCREEN PASS\n" : `\nSCREEN FAIL (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
