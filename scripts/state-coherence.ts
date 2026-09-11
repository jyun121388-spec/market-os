/**
 * Do the authority-bearing documents agree with the gate register?
 *
 *   npx tsx scripts/state-coherence.ts
 *
 * The question nothing in this repository was asking. `docs/HUMAN_GATE_QUEUE.md` said the ECOS and
 * OpenDART credentials were open Human Gates while a ledger entry recorded them closed, the two
 * disagreed for a full day, and the divergence was silent because governance claims live in prose
 * and prose is not compared to anything. IR-148 corrected the state; this is the mechanism that
 * would have caught it, and `tests/stateCoherence.test.ts` runs it.
 *
 * Deliberately NARROW. It does not read documents for style, tone or completeness — it checks a
 * short list of claims that can be mechanically contradicted by the register, and says which file
 * and which line. A checker that tried to understand the prose would be a checker nobody trusts.
 *
 * Reads no credential and contacts nothing.
 */
import { readFileSync } from "node:fs";

import { parseGateRegister } from "./autonomy-context";
import { AUTHORITY_BEARING_STATUS } from "../src/server/fabric/providerAuthorization";

/** Documents whose statements carry authority, as opposed to the ledgers that record history. */
export const AUTHORITY_BEARING_DOCUMENTS = [
  "docs/PROJECT_STATE.md",
  "docs/CURRENT_TASK.md",
  "docs/RELEASE_READINESS.md",
  "docs/SESSION_HANDOFF.md",
  "docs/V1_DELIVERY_AUDIT.md",
] as const;

export interface CoherenceFinding {
  file: string;
  line: number;
  gate: string;
  registerSays: string;
  text: string;
}

/**
 * Phrases that assert a gate is CLOSED.
 *
 * The `\bclosed\b` and `resolved` forms are what the drift actually looked like — "measured when
 * HG-003 and HG-004 closed" reads as history and asserts an authority state. Past tense is not an
 * exemption: a document saying a gate closed, when the register says it is open, is wrong in the
 * present tense about what may happen next.
 */
const CLOSURE_PHRASES = /\b(closed|resolved|live[_ ]verified|satisfied|granted|unblocked)\b/i;

/**
 * A line that is explicitly ABOUT the correction is not a contradiction of it.
 *
 * Without this the reconciliation's own sentences — "HG-003 and HG-004 were written
 * `LIVE_VERIFIED` here and that was withdrawn" — would be reported as the drift they describe,
 * which is the substring-scan-fires-on-its-own-denial failure this project keeps re-learning.
 */
const DISCLAIMER_PHRASES =
  /withdrawn|not authoriz|unauthoriz|pending_user|quarantin|was wrong|no longer|IR-148|revoked|never granted/i;

export function checkCoherence(
  documents: readonly string[] = AUTHORITY_BEARING_DOCUMENTS,
  registerPath = "docs/HUMAN_GATE_QUEUE.md",
): CoherenceFinding[] {
  const register = parseGateRegister(readFileSync(registerPath, "utf8"));
  const open = [...register.entries()]
    .filter(([, status]) => status !== AUTHORITY_BEARING_STATUS)
    .map(([gate, status]) => ({ gate, status }));

  const findings: CoherenceFinding[] = [];
  for (const file of documents) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (DISCLAIMER_PHRASES.test(line)) return;
      for (const { gate, status } of open) {
        const at = line.indexOf(gate);
        if (at === -1) continue;
        // A WINDOW after the mention, not the whole line. One line can name several gates in
        // different states — `FRED_API_KEY (present, HG-002 resolved), ECOS_API_KEY (HG-003
        // pending)` is a true sentence that a line-wide match reports as two contradictions. A
        // checker with false positives is a checker somebody switches off.
        const window = line.slice(at + gate.length, at + gate.length + 40);
        if (!CLOSURE_PHRASES.test(window)) continue;
        findings.push({
          file,
          line: index + 1,
          gate,
          registerSays: status,
          text: line.trim().slice(0, 140),
        });
      }
    });
  }
  return findings;
}

if (process.argv[1] && process.argv[1].endsWith("state-coherence.ts")) {
  const findings = checkCoherence();
  const register = parseGateRegister(readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8"));
  console.log("GATE REGISTER");
  for (const [gate, status] of [...register.entries()].sort()) {
    console.log(`  ${gate}  ${status}`);
  }
  console.log(`\nAUTHORITY-BEARING DOCUMENTS CHECKED: ${AUTHORITY_BEARING_DOCUMENTS.length}`);
  if (findings.length === 0) {
    console.log("  no document contradicts the register about an open gate");
  } else {
    console.log(`  ${findings.length} contradiction(s):`);
    for (const f of findings) {
      console.log(
        `    ${f.file}:${f.line}  says ${f.gate} is closed; register says ${f.registerSays}`,
      );
      console.log(`      ${f.text}`);
    }
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}
