/**
 * IR-112 corpus exposure. READ-ONLY, no DB: how many DEVELOPMENT corpus rows carry a trailing
 * comma-adjunct after the operation, what authority do they get today, and is their bound subject
 * corrupted by absorbing that adjunct?
 *
 * Sealed holdouts are NOT touched: this reads the development corpus only.
 *
 *   npx tsx scripts/ir112-corpus.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";
import { REQUEST_DEVELOPMENT_CORPUS } from "../tests/fixtures/requestDevelopmentCorpus";

type Row = { id: string; query: string; expected?: unknown };

const rows = REQUEST_DEVELOPMENT_CORPUS as unknown as readonly Row[];

// A trailing adjunct candidate: text after the LAST comma, before terminal punctuation, that is
// short and is not itself a clause with a coordinator. Purely descriptive -- this is the
// measurement, not a proposed grammar.
const TAIL = /,\s*([^,]{1,40})\s*[?.!]?\s*$/;

let total = 0;
let withTail = 0;
const buckets = new Map<string, number>();
const corrupted: string[] = [];
const prohibited: string[] = [];

for (const row of rows) {
  const query = String((row as { query?: string }).query ?? "");
  if (!query) continue;
  total += 1;
  const m = TAIL.exec(query.trim());
  if (m === null) continue;
  const tail = m[1]
    .trim()
    .toLowerCase()
    .replace(/[?.!]$/, "");
  withTail += 1;
  const a = resolveRequestAuthority(query);
  const key = a.status === "AUTHORIZED" ? `AUTHORIZED/${a.operation}` : a.status;
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
  const id = String((row as { id?: string }).id ?? "?");
  if (a.status === "AUTHORIZED") {
    const subj = a.subjectRegion.toLowerCase();
    const head = tail.split(" ")[0];
    if (head && subj.includes(` ${head}`)) {
      corrupted.push(`${id}  tail="${tail}"  subj=[${a.subjectRegion.trim()}]`);
    }
  }
  if (a.status === "PROHIBITED") prohibited.push(`${id}  tail="${tail}"  ${query}`);
}

console.log(`development corpus rows: ${total}`);
console.log(`rows with a trailing comma-adjunct: ${withTail}`);
console.log("\nauthority of those rows today:");
for (const [k, v] of [...buckets].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`\nAUTHORIZED but with the adjunct absorbed into the subject: ${corrupted.length}`);
for (const c of corrupted) console.log(`  ${c}`);
console.log(`\nPROHIBITED among them: ${prohibited.length}`);
for (const p of prohibited) console.log(`  ${p}`);
