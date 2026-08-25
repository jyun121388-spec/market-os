/**
 * The B1 adversarial review's findings, run against the code rather than argued about.
 *
 * IR-107 Unit 2 Phase B. The exact-tree review of 3ca88ea returned REWORK_REQUIRED with ten
 * findings, and the discipline this project runs on is that a finding is reproduced before it is
 * repaired — twice now a plausible finding has turned out to be wrong about the code, and once a
 * repair was written for a defect that did not exist.
 *
 * Each row states what the reviewer predicted. The point of running it is the rows where the
 * prediction is WRONG, which is why the prediction is recorded next to the behaviour instead of
 * being checked silently.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/reproduce-korean-review.ts
 */

import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { analyseCopularInterrogative, analyseNoun } from "@/server/domain/koreanMorphology";

interface Case {
  attack: string;
  query: string;
  /** What the reviewer said this does today. */
  claimed: string;
  /** What it must do after the repair. */
  required: string;
}

const CASES: Case[] = [
  {
    attack: "1/3 marked reading suppresses the unsplit one",
    query: "유리가 무엇인가요?",
    claimed: "AUTHORIZED/DEFINITION subject 유리",
    required: "must not authorize a truncated subject on marker precedence alone",
  },
  {
    attack: "2 a marker rejected by conditioning falls through to zero-marking",
    query: "기준금리은 얼마인가요?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 기준금리은",
    required: "UNSUPPORTED — the wrong allomorph is a malformed marker, not an absent one",
  },
  {
    attack: "4 any markerless first eojeol becomes a subject",
    query: "안 얼마인가요?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 안",
    required: "UNSUPPORTED — 안 is the negator, not a noun phrase",
  },
  {
    attack: "5 a fused possessive escapes the determiner check",
    query: "내계좌는 얼마인가요?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 내계좌",
    required: "must not authorize; the reader's own account is not a stored subject",
  },
  {
    attack: "5b the possessive check is skipped once anything is recognised",
    query: "내 계좌는 얼마인가요?",
    claimed: "PROHIBITED (spaced form still works)",
    required: "PROHIBITED",
  },
  {
    attack: "6 internal coordination asserted as one subject",
    query: "금리와환율은 얼마인가요?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 금리와환율",
    required: "must not authorize — cardinality one is asserted, not established",
  },
  {
    attack: "6b the compound the conjunction rule must not refuse by substring",
    query: "교환과정은 무엇인가요?",
    claimed: "AUTHORIZED/DEFINITION subject 교환과정",
    required: "measured, and the cost stated either way",
  },
  {
    attack: "7 a directive/obligation form becomes a subject",
    query: "사야 얼마인가요?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 사야",
    required: "UNSUPPORTED",
  },
  {
    attack: "9 raw jamo is offered as a surface",
    query: "기준금리는 얼마ㅂ니까?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION",
    required: "UNSUPPORTED — 얼마ㅂ니까 is not a Korean word",
  },
  {
    attack: "10 unknown conditioning read as consonant-final",
    query: "CPI이 무엇인가요?",
    claimed: "AUTHORIZED/DEFINITION subject CPI",
    required: "a stated mixed-script rule, not silence",
  },
  {
    attack: "10b the mixed-script case that must keep working",
    query: "CPI는 무엇인가요?",
    claimed: "AUTHORIZED/DEFINITION subject CPI",
    required: "AUTHORIZED/DEFINITION subject CPI",
  },
  {
    attack: "11 past and future remain unrecognised (reviewer says CORRECT)",
    query: "기준금리는 얼마였습니까?",
    claimed: "UNSUPPORTED",
    required: "UNSUPPORTED",
  },
  {
    attack: "control — the zero-marked case the repair may cost",
    query: "원달러환율 얼마야?",
    claimed: "AUTHORIZED/CURRENT_OBSERVATION subject 원달러환율",
    required: "measured, and the loss stated if it is lost",
  },
];

function describe(query: string): string {
  const authority = resolveRequestAuthority(query);
  if (authority.status !== "AUTHORIZED") return authority.status;
  return `AUTHORIZED/${authority.operation} subject="${authority.subjectRegion.trim()}"`;
}

console.log("morphology probes");
for (const eojeol of [
  "유리가",
  "기준금리은",
  "내계좌는",
  "금리와환율은",
  "교환과정은",
  "CPI이",
  "CPI는",
]) {
  console.log(
    `  ${eojeol.padEnd(10)} ${analyseNoun(eojeol)
      .map((a) => `${a.stem}/${a.role ?? "-"}`)
      .join("  ")}`,
  );
}
console.log("\npredicate probes");
for (const eojeol of ["얼마ㅂ니까", "얼마ㄴ가요", "뭐ㅂ니까", "뭐ㄴ가요", "얼마입니까", "뭔가요"]) {
  console.log(`  ${eojeol.padEnd(10)} ${JSON.stringify(analyseCopularInterrogative(eojeol))}`);
}

console.log("\nrequest authority");
for (const c of CASES) {
  const actual = describe(c.query);
  const matchesClaim = actual === c.claimed;
  console.log(`\n  [${c.attack}]`);
  console.log(`    query    ${c.query}`);
  console.log(`    actual   ${actual}`);
  console.log(
    `    claimed  ${c.claimed}${matchesClaim ? "   <-- reproduced" : "   <-- CLAIM DIFFERS"}`,
  );
  console.log(`    required ${c.required}`);
}
