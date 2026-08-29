/**
 * Could `LEGACY_BYPASS` be removed now, and what would it cost?
 *
 * IR-107 §16. `InferenceAuthorization` admits two provenances: `CANONICAL`, where the operation
 * parser recognised the whole request and its parse travels, and `LEGACY_BYPASS`, where the legacy
 * frame classifier admitted a request the canonical parser refuses. The bypass is labelled rather
 * than hidden precisely so its closure can be a deletion instead of another migration.
 *
 * It is not removable because it is ugly. Recognition coverage collapsed once before when canonical
 * binding was forced, so the question is measured, not argued:
 *
 *   THROUGHPUT   what share of eligible requests the canonical parser already recognises
 *   LOSS         legitimate, planner-eligible requests that would stop being eligible today
 *   EXPOSURE     requests the canonical parser REFUSES that reach a planner through the bypass
 *
 * LOSS and EXPOSURE are the same population seen from opposite ends, and separating them is the
 * whole decision: a bypass carrying only cases the parser refuses on SAFETY grounds should be shut
 * immediately, and one carrying cases it merely fails to RECOGNISE should not.
 *
 *   npx tsx scripts/legacy-bypass-readiness.ts
 */

import { readFileSync } from "node:fs";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

/**
 * The development corpus. NOT a sealed holdout -- this unit's brief forbids spending holdout
 * evidence on framing work, so the holdout fixtures are deliberately not read.
 */
function devCorpus(): string[] {
  const text = readFileSync("tests/fixtures/requestDevelopmentCorpus.ts", "utf8");
  return [...text.matchAll(/query:\s*["'`]([^"'`\n]{4,200})["'`]/g)].map((m) => m[1]);
}

const queries = devCorpus();
let canonical = 0;
let bypass = 0;
let blocked = 0;

/** Bypassed requests grouped by what the canonical parser said instead. */
const byCanonicalVerdict = new Map<string, string[]>();

for (const query of queries) {
  const authorization = authorizeInference(query);
  if (!authorization.eligible) {
    blocked += 1;
    continue;
  }
  if (authorization.provenance === "CANONICAL") {
    canonical += 1;
    continue;
  }
  bypass += 1;
  const verdict = resolveRequestAuthority(query).status;
  const bucket = byCanonicalVerdict.get(verdict) ?? [];
  bucket.push(query);
  byCanonicalVerdict.set(verdict, bucket);
}

const eligible = canonical + bypass;
console.log(`development corpus: ${queries.length} queries`);
console.log(`  blocked before a planner : ${blocked}`);
console.log(`  eligible                 : ${eligible}`);
console.log(
  `    CANONICAL              : ${canonical}` +
    (eligible > 0 ? `  (${((canonical / eligible) * 100).toFixed(1)}% throughput)` : ""),
);
console.log(`    LEGACY_BYPASS          : ${bypass}`);

console.log(`\nwhat the canonical parser says about each bypassed request:`);
for (const [verdict, rows] of [...byCanonicalVerdict].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${verdict.padEnd(14)} ${rows.length}`);
  for (const row of rows.slice(0, 4)) console.log(`      ${JSON.stringify(row.slice(0, 90))}`);
  if (rows.length > 4) console.log(`      ... and ${rows.length - 4} more`);
}

// The distinction the decision turns on. A request the parser calls PROHIBITED and the bypass
// admits is a live safety exposure; one it calls UNSUPPORTED is unrecognised, and removing the
// bypass would lose it rather than protect anyone.
const prohibited = byCanonicalVerdict.get("PROHIBITED")?.length ?? 0;
const ambiguous = byCanonicalVerdict.get("AMBIGUOUS")?.length ?? 0;
const unsupported = byCanonicalVerdict.get("UNSUPPORTED")?.length ?? 0;
console.log(`\nEXPOSURE  bypassed while the parser calls them PROHIBITED : ${prohibited}`);
console.log(`EXPOSURE  bypassed while the parser calls them AMBIGUOUS  : ${ambiguous}`);
console.log(`LOSS      bypassed only because the parser cannot read them: ${unsupported}`);
console.log(
  `\nREADINESS: removing LEGACY_BYPASS today would close ${prohibited + ambiguous} exposure(s) ` +
    `and lose ${unsupported} recognised-by-legacy request(s).`,
);
