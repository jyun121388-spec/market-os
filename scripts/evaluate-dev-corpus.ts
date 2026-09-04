/**
 * Development-corpus evaluator for request authority (IR-107 Unit 2).
 *
 * This corpus is NOT a holdout. It was written blind to the parser — the generators were forbidden
 * to read `requestAuthority.ts`, its construction table, or any frozen fixture — but once written
 * it may be inspected and fitted against, which is exactly what disqualifies it as evidence. The
 * frozen holdouts stay sealed until the implementation is frozen, and are run once.
 *
 * What this reports is deliberately split three ways, because one aggregate number hides all three
 * failures that matter:
 *
 *   1. COVERAGE   — which operations and which language the parser can recognise at all.
 *   2. SAFETY     — negative controls that were authorized. Any non-zero here outranks any coverage
 *                   gain; a parser that admits more by admitting a directive has not improved.
 *   3. MISLABELS  — a refusal with the wrong reason. Refused-for-the-wrong-reason is the failure
 *                   IR-107's baseline was built to expose, and it is invisible in a pass rate.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/evaluate-dev-corpus.ts
 */

import {
  REQUEST_DEVELOPMENT_CORPUS,
  type DevelopmentCase,
} from "../tests/fixtures/requestDevelopmentCorpus";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

/** Negative labels whose only acceptable verdict is PROHIBITED, not merely "not authorized". */
const MUST_BE_PROHIBITED = new Set(["PROHIBITED_ADVICE", "PROHIBITED_PERSONAL_SUBJECT"]);

interface Row {
  c: DevelopmentCase;
  status: string;
  operation: string | null;
  detail: string;
}

function pct(n: number, d: number): string {
  return d === 0 ? "  n/a" : `${String(Math.round((100 * n) / d)).padStart(3)}%`;
}

function table(
  title: string,
  keys: string[],
  count: (key: string) => { hit: number; total: number },
): void {
  console.log(`\n${title}`);
  for (const key of keys.sort()) {
    const { hit, total } = count(key);
    if (total === 0) continue;
    console.log(
      `   ${key.padEnd(34)} ${String(hit).padStart(3)}/${String(total).padEnd(4)} ${pct(hit, total)}`,
    );
  }
}

function main(): void {
  const rows: Row[] = REQUEST_DEVELOPMENT_CORPUS.map((c) => {
    const a = resolveRequestAuthority(c.query);
    return {
      c,
      status: a.status,
      operation: a.status === "AUTHORIZED" ? a.operation : null,
      detail: a.detail,
    };
  });

  const positives = rows.filter((r) => r.c.expected === "ANSWERABLE");
  const negatives = rows.filter((r) => r.c.expected === "REFUSED");

  console.log(
    `development corpus: ${rows.length} cases  (${positives.length} answerable, ${negatives.length} controls)`,
  );

  // ---- 1. coverage ---------------------------------------------------------------------------
  // Recognised AND recognised as the right operation. Admitting a change request as a current
  // observation is not coverage; it answers a different question with a straight face.
  const correct = (r: Row) => r.status === "AUTHORIZED" && r.operation === r.c.operation;

  console.log(
    `\n1. COVERAGE: ${positives.filter(correct).length}/${positives.length} answerable requests` +
      ` authorized as the operation they actually ask for`,
  );
  const authorizedAtAll = positives.filter((r) => r.status === "AUTHORIZED").length;
  const wrongOperation = authorizedAtAll - positives.filter(correct).length;
  if (wrongOperation > 0) {
    console.log(
      `   WARNING: ${wrongOperation} authorized as the WRONG operation — counted as misses`,
    );
  }

  table("   by operation", [...new Set(positives.map((r) => r.c.operation))], (op) => {
    const set = positives.filter((r) => r.c.operation === op);
    return { hit: set.filter(correct).length, total: set.length };
  });
  table("   by language", [...new Set(positives.map((r) => r.c.language))], (lang) => {
    const set = positives.filter((r) => r.c.language === lang);
    return { hit: set.filter(correct).length, total: set.length };
  });

  // ---- 2. safety -----------------------------------------------------------------------------
  // The floor. Coverage numbers are not reportable while any of these is non-zero.
  const leaked = negatives.filter((r) => r.status === "AUTHORIZED");
  console.log(`\n2. SAFETY — controls authorized: ${leaked.length}/${negatives.length}`);
  if (leaked.length === 0) {
    console.log("   none — every negative control is refused");
  }
  for (const r of leaked) {
    console.log(`   LEAK ${r.c.id} ${r.c.operation} -> ${r.operation}  ${r.c.query.slice(0, 78)}`);
  }

  const wronglyPermissive = negatives.filter(
    (r) => MUST_BE_PROHIBITED.has(r.c.operation) && r.status !== "PROHIBITED",
  );
  console.log(
    `\n   refused, but not as PROHIBITED, where only PROHIBITED is right: ` +
      `${wronglyPermissive.length}/${negatives.filter((r) => MUST_BE_PROHIBITED.has(r.c.operation)).length}`,
  );
  for (const r of wronglyPermissive.slice(0, 12)) {
    console.log(`   ${r.c.id} ${r.status.padEnd(12)} ${r.c.query.slice(0, 74)}`);
  }

  table(
    "   controls by label (refused correctly)",
    [...new Set(negatives.map((r) => r.c.operation))],
    (label) => {
      const set = negatives.filter((r) => r.c.operation === label);
      return { hit: set.filter((r) => r.status !== "AUTHORIZED").length, total: set.length };
    },
  );

  // ---- 3. how the misses fail ------------------------------------------------------------------
  // Not a list of sentences to fix. A distribution: one refusal reason dominating a whole operation
  // is a structural gap, and a long flat tail is the phrase-table symptom this unit exists to avoid.
  const misses = positives.filter((r) => !correct(r));
  const byStatus: Record<string, number> = {};
  for (const r of misses) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`\n3. MISSES BY REFUSAL STATUS: ${JSON.stringify(byStatus)}`);

  for (const op of [...new Set(misses.map((r) => r.c.operation))].sort()) {
    const set = misses.filter((r) => r.c.operation === op);
    const tally: Record<string, number> = {};
    for (const r of set) tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log(`   ${op.padEnd(34)} ${set.length} missed  ${JSON.stringify(tally)}`);
  }

  const sample = process.argv.includes("--samples");
  if (sample) {
    console.log("\n   sample misses (structure, not sentences to patch):");
    for (const op of [...new Set(misses.map((r) => r.c.operation))].sort()) {
      for (const r of misses.filter((x) => x.c.operation === op).slice(0, 6)) {
        console.log(`   ${r.c.id} ${r.status.padEnd(12)} ${r.c.query}`);
      }
    }
  }

  console.log(
    `\nSUMMARY  coverage ${positives.filter(correct).length}/${positives.length}` +
      `   safety leaks ${leaked.length}` +
      `   (frozen holdouts NOT run — sealed until the implementation is frozen)`,
  );
}

main();
