/**
 * IR-110: what would narrowing bare-copular Korean DEFINITION actually cost?
 *
 * The architecture pass returned NO_CHANGE with a Human Gate, and the gate turns on a number: how
 * much recall the only available repair would delete. A number quoted from a document is not a
 * measurement, so this counts it against the real corpus and the real parser.
 *
 * A Korean DEFINITION row is "bare-copular" here if the request carries NO positive definitional
 * evidence — no metalinguistic head (뜻 / 의미 / 정의 / 개념 / 용어 / 표현) and no `(이)란`
 * definiendum marker — so the only thing licensing DEFINITION is nominative-plus-WHAT-copula.
 * Those are exactly the rows a DEFINIENDUM-only gate would stop recognising.
 *
 * READ-ONLY.  npx tsx scripts/ir110-recall-cost.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";
import { REQUEST_DEVELOPMENT_CORPUS } from "../tests/fixtures/requestDevelopmentCorpus";

const METALINGUISTIC = ["뜻", "의미", "정의", "개념", "용어", "표현"];
const DEFINIENDUM = ["이란", "란 ", "라는"];

type Row = { id: string; query: string; language: string; expected: string };
const rows = REQUEST_DEVELOPMENT_CORPUS as unknown as readonly Row[];

const korean = rows.filter((r) => /[가-힣]/.test(r.query));
const bare: Row[] = [];
const evidenced: Row[] = [];

for (const row of korean) {
  const authority = resolveRequestAuthority(row.query);
  if (authority.status !== "AUTHORIZED" || authority.operation !== "DEFINITION") continue;
  const hasHead = METALINGUISTIC.some((h) => row.query.includes(h));
  const hasMarker = DEFINIENDUM.some((m) => row.query.includes(m));
  (hasHead || hasMarker ? evidenced : bare).push(row);
}

console.log(`Korean corpus rows: ${korean.length}`);
console.log(`  currently AUTHORIZED/DEFINITION: ${bare.length + evidenced.length}`);
console.log(`    carrying positive definitional evidence (head or (이)란): ${evidenced.length}`);
console.log(`    BARE — licensed only by nominative + WHAT copula:         ${bare.length}`);
console.log("\nthe rows a DEFINIENDUM-only gate would stop recognising:");
for (const r of bare) console.log(`  ${r.id}  ${r.query}`);

console.log("\nthe defect itself, and the controls that must not move:");
for (const probe of [
  "오늘주가가 뭐야?",
  "현재주가가 뭐야?",
  "현재가가 뭐야?",
  "종합주가가 뭐야?",
  "오늘 주가가 뭐야?",
  "기준금리는 얼마인가요?",
]) {
  const a = resolveRequestAuthority(probe);
  const verdict = a.status === "AUTHORIZED" ? `AUTHORIZED/${a.operation}` : a.status;
  console.log(`  ${verdict.padEnd(30)} ${probe}`);
}
