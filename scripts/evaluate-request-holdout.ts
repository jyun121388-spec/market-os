/**
 * Baseline run of the frozen request-authority holdout, against unchanged code.
 *
 * The corpus was frozen before any operation envelope existed, so this is a measurement of what the
 * request gate does today — the "before" column for IR-107, not a score to improve against by
 * tuning. If a case here later drives a change, the corpus becomes regression evidence from that
 * moment and a new one must be frozen before any generalisation claim.
 *
 * ## Mapping today's outcomes onto the contract's label space
 *
 * The current gate has no notion of an operation and no AMBIGUOUS outcome, so the mapping is the
 * honest minimum:
 *
 *     eligible                              -> ANSWERABLE   the gate let it through
 *     PROHIBITED_REQUEST                    -> PROHIBITED   reported as a legal refusal
 *     FRAME_NOT_PROVEN / FRAME_NOT_ELIGIBLE -> UNSUPPORTED  the gate's way of saying "cannot"
 *
 * AMBIGUOUS has no representation today, so every ambiguous case is counted against whatever the
 * gate happened to say. That is a fact about the gate, not an artefact of the mapping.
 *
 * ## The two numbers that matter, and they are not symmetric
 *
 * LEAKAGE  a PROHIBITED request the gate let through. A safety defect.
 * MISLABEL an UNSUPPORTED or ANSWERABLE request reported as PROHIBITED. Not a safety defect, but
 *          the product telling a user they asked for advice when they asked for a definition.
 *
 * Over-blocking is reported separately for cases carrying trading vocabulary, because that is the
 * exact defect IR-107 reproduced.
 *
 * No provider, no model, no network, no database.
 */

import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { classifyRequestFrame } from "@/server/domain/requestFrame";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import {
  REQUEST_AUTHORITY_HOLDOUT,
  REQUEST_AUTHORITY_SHA256,
  type RequestAuthorityCase,
} from "../tests/fixtures/requestAuthorityHoldout";

type Observed = "ANSWERABLE" | "UNSUPPORTED" | "PROHIBITED";

function observe(query: string): Observed {
  const auth = authorizeInference(query);
  if (auth.eligible) return "ANSWERABLE";
  return auth.blockedBy === "PROHIBITED_REQUEST" ? "PROHIBITED" : "UNSUPPORTED";
}

const rows = REQUEST_AUTHORITY_HOLDOUT.map((c: RequestAuthorityCase) => ({
  c,
  observed: observe(c.query),
  frame: classifyRequestFrame(c.query),
  advice: detectPersonalizedAdviceRequest(c.query),
}));

console.log(`holdout ${rows.length} cases, sha256 ${REQUEST_AUTHORITY_SHA256}`);

const matrix: Record<string, Record<string, number>> = {};
for (const r of rows) {
  matrix[r.c.expected] ??= {};
  matrix[r.c.expected][r.observed] = (matrix[r.c.expected][r.observed] ?? 0) + 1;
}
console.log("\nexpected -> observed");
for (const [expected, obs] of Object.entries(matrix)) {
  console.log(`  ${expected.padEnd(13)} ${JSON.stringify(obs)}`);
}

const leaked = rows.filter((r) => r.c.expected === "PROHIBITED" && r.observed !== "PROHIBITED");
console.log(
  `\nLEAKAGE — prohibited requests the gate did not refuse as prohibited: ${leaked.length}`,
);
for (const r of leaked.slice(0, 12)) {
  console.log(`  ${r.c.id} ${r.c.language} observed ${r.observed}  ${r.c.query.slice(0, 78)}`);
}
if (leaked.length > 12) console.log(`  ... and ${leaked.length - 12} more`);

const mislabelled = rows.filter(
  (r) => r.c.expected !== "PROHIBITED" && r.observed === "PROHIBITED",
);
console.log(`\nMISLABELLED — not prohibited, reported as prohibited: ${mislabelled.length}`);
for (const r of mislabelled.slice(0, 12)) {
  console.log(
    `  ${r.c.id} ${r.c.language} expected ${r.c.expected} vocab=${r.c.carriesTradingVocabulary}  ${r.c.query.slice(0, 66)}`,
  );
}
if (mislabelled.length > 12) console.log(`  ... and ${mislabelled.length - 12} more`);

const answerable = rows.filter((r) => r.c.expected === "ANSWERABLE");
const admitted = answerable.filter((r) => r.observed === "ANSWERABLE");
console.log(`\nANSWERABLE admitted: ${admitted.length}/${answerable.length}`);

console.log("\nadmitted by operation");
const byOp: Record<string, { total: number; admitted: number }> = {};
for (const r of answerable) {
  byOp[r.c.operation] ??= { total: 0, admitted: 0 };
  byOp[r.c.operation].total += 1;
  if (r.observed === "ANSWERABLE") byOp[r.c.operation].admitted += 1;
}
for (const [op, v] of Object.entries(byOp).sort()) {
  console.log(`  ${op.padEnd(32)} ${v.admitted}/${v.total}`);
}

console.log("\nadmitted by language");
const byLang: Record<string, { total: number; admitted: number }> = {};
for (const r of answerable) {
  byLang[r.c.language] ??= { total: 0, admitted: 0 };
  byLang[r.c.language].total += 1;
  if (r.observed === "ANSWERABLE") byLang[r.c.language].admitted += 1;
}
for (const [lang, v] of Object.entries(byLang).sort()) {
  console.log(`  ${lang} ${v.admitted}/${v.total}`);
}

const vocabInnocent = rows.filter(
  (r) => r.c.carriesTradingVocabulary && r.c.expected !== "PROHIBITED",
);
const vocabMislabelled = vocabInnocent.filter((r) => r.observed === "PROHIBITED");
console.log(
  `\nTrading vocabulary without personalized intent: ${vocabMislabelled.length}/${vocabInnocent.length} reported as PROHIBITED`,
);
for (const r of vocabMislabelled.slice(0, 10)) {
  console.log(`  ${r.c.id} ${r.c.language} expected ${r.c.expected}  ${r.c.query.slice(0, 70)}`);
}

const ambiguous = rows.filter((r) => r.c.expected === "AMBIGUOUS");
console.log(`\nAMBIGUOUS cases (no representation in today's gate): ${ambiguous.length}`);
const ambObs: Record<string, number> = {};
for (const r of ambiguous) ambObs[r.observed] = (ambObs[r.observed] ?? 0) + 1;
console.log(`  observed as ${JSON.stringify(ambObs)}`);
