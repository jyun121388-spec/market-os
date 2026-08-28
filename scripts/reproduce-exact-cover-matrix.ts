/**
 * The ESC-015 exact-cover reproduction matrix, at the PARSER level, before any redesign.
 *
 * Every case the decision names as load-bearing, in one place and with its expectation attached,
 * so the redesign is measured against a fixed denominator instead of against whichever example is
 * in front of me. Run before changing anything; run again after.
 *
 * The unknown-second-object cases are deliberately probed HERE, at `resolveRequestAuthority`, and
 * not through the candidate envelope. That is the point of the acceptance case: repository
 * inventory must never decide what the request MEANT, so the parser must refuse `A affects B and C`
 * whether or not `C` is a stored endpoint. A probe that consults inventory could not tell the
 * difference between "the grammar refused" and "the row was missing".
 *
 *   npx tsx scripts/reproduce-exact-cover-matrix.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

type Expect = "PUBLISH" | "REFUSE";

const CASES: [Expect, string, string][] = [
  // ---- 8. ordinary single-intent issuer/title requests: positive controls -------------------
  ["PUBLISH", "issuer Corp", "What is the current Acme Corp. revenue?"],
  ["PUBLISH", "issuer Inc", "What is the current Acme Inc. revenue?"],
  ["PUBLISH", "issuer Co", "What is the current Samsung Electronics Co. revenue?"],
  [
    "PUBLISH",
    "issuer mixed script",
    "What did Samsung Electronics Co. 삼성전자 report about revenue?",
  ],
  ["PUBLISH", "abbreviation then measure noun", "What is the current U.S. rate of inflation?"],
  ["PUBLISH", "brand with exclamation", "What is the definition of Yahoo! Finance?"],
  ["PUBLISH", "partnership with semicolon", "What is the current Smith; Jones revenue?"],
  ["PUBLISH", "long dotted abbreviation", "What is the current N.Y.S.E. volume?"],
  [
    "PUBLISH",
    "institutional name",
    "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
  ],
  ["PUBLISH", "plain attribution", "What did Reuters publish about Alpha?"],
  ["PUBLISH", "plain observation", "What is the current US headline CPI?"],
  ["PUBLISH", "plain mechanism", "Explain how Alpha affects Beta."],

  // ---- 9. Korean supported paths: matched positive controls ---------------------------------
  // 2 eojeols. The 3-eojeol form `현재 기준금리는 얼마인가요?` is a DOCUMENTED capability limit
  // of the Korean copular matcher, not a defect; my first version of this matrix expected it to
  // publish and was wrong about the product rather than finding something.
  ["PUBLISH", "korean current observation", "기준금리는 얼마인가요?"],
  ["PUBLISH", "korean definition", "USD-KRW란 무엇인가요?"],

  // ---- multi-intent, must refuse. Includes the directive-in-source cases -------------------
  [
    "REFUSE",
    "period, unenumerated imperative",
    "What did Reuters publish about Alpha. Summarize Gamma.",
  ],
  ["REFUSE", "period, bare noun", "What did Reuters publish about Oil. Summarize Gamma."],
  [
    "REFUSE",
    "period, three-letter subject",
    "What did Reuters publish about CPI. Summarize Gamma.",
  ],
  [
    "REFUSE",
    "exclamation, unenumerated imperative",
    "What did Reuters publish about Alpha! Summarize Gamma.",
  ],
  [
    "REFUSE",
    "semicolon, unenumerated imperative",
    "What did Reuters publish about Alpha; Summarize Gamma.",
  ],
  ["REFUSE", "directive in source at period", "Should I buy stock. Reuters published about Alpha?"],
  [
    "REFUSE",
    "directive in source at exclamation",
    "Should I buy stock! Reuters published about Alpha?",
  ],
  [
    "REFUSE",
    "directive in source at semicolon",
    "Should I buy stock; Reuters published about Alpha?",
  ],
  [
    "REFUSE",
    "directive then two clauses",
    "Should I buy stock? What did Reuters publish about Alpha? What about the Gamma level?",
  ],
  ["REFUSE", "mechanism effect eats a tail", "Explain how Alpha affects Beta! Summarize Gamma."],
  [
    "REFUSE",
    "korean clause after english",
    "What is the current Gamma? 현재 기준금리는 얼마인가요?",
  ],

  // ---- unknown second object. Repository inventory must not decide -------------------------
  ["PUBLISH", "single pair control", "Explain how Alpha affects Beta."],
  ["REFUSE", "and-conjoined second object", "Explain how Alpha affects Beta and Gamma."],
  ["REFUSE", "or-conjoined second object", "Explain how Alpha affects Beta or Gamma."],
  ["REFUSE", "comma-appended second object", "Explain how Alpha affects Beta, Gamma."],
  ["REFUSE", "comparison residue", "Explain how Alpha affects Beta compared with Gamma."],
  ["REFUSE", "versus residue", "Explain how Alpha affects Beta versus Gamma."],
  ["REFUSE", "conjoined cause", "Explain how Alpha and Gamma affect Beta."],
  ["REFUSE", "conjoined subject observation", "What is the current Alpha and Gamma?"],
  ["REFUSE", "conjoined attribution subject", "What did Reuters publish about Alpha and Gamma?"],
];

let wrong = 0;
const failures: string[] = [];

for (const [expectation, label, query] of CASES) {
  const a = resolveRequestAuthority(query);
  const published = a.status === "AUTHORIZED";
  let served = "-";
  if (a.status === "AUTHORIZED") {
    served = `${a.operation}|subj=${a.subjectRegion.trim()}|src=${a.sourceRegion ?? "-"}|cause=${a.causeRegion?.trim() ?? "-"}|effect=${a.effectRegion?.trim() ?? "-"}`;
  }
  const ok = expectation === "PUBLISH" ? published : !published;
  if (!ok) {
    wrong += 1;
    failures.push(`${expectation} expected, got ${a.status} :: ${label} :: ${served}`);
  }
  process.stdout.write(
    `${ok ? "ok  " : "WRONG"}\t${expectation}\t${a.status}\t${label}\t${served}\n`,
  );
}

process.stdout.write(`\n${CASES.length} cases, ${wrong} not meeting the contract\n`);
for (const f of failures) {
  process.stdout.write(`  ${f}\n`);
}
