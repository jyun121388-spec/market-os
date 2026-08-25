/**
 * What the canonical parser actually does with Korean, measured before anything is built.
 *
 * IR-107 Unit 2 Phase B. The architecture round proposed a morphology layer and a five-operation
 * verdict — DEFINITION and a narrow CURRENT_OBSERVATION and particle-bound attribution PROCEED,
 * OBSERVED_CHANGE and STORED_MECHANISM stay UNSUPPORTED — and every one of those is a claim about
 * behaviour this repository has not yet been asked to produce. This asks it.
 *
 * The rows are the architect's own reproduction matrix, plus the safety controls the English path
 * already holds and Korean must not lose. Each carries what it is EXPECTED to do after the layer
 * lands, so the same script is the before-measurement and the after-measurement, and a row whose
 * expectation was wrong is visible rather than quietly re-labelled.
 *
 * It asserts nothing and reads no sealed fixture. Two of these expectations are deliberately
 * "still refuses": a recognition layer that improves every row is a layer that stopped refusing.
 *
 * Run: DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/reproduce-korean-recognition.ts
 */

import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";

interface Row {
  group: string;
  query: string;
  /** What the canonical parser must say once the minimum Korean layer exists. */
  expect: string;
  /** Why, in the terms the architecture round used. */
  because: string;
}

const ROWS: Row[] = [
  // ------------------------------------------------------------------ A. DEFINITION
  {
    group: "definition — the closed interrogative + copular construction",
    query: "스톱로스란 무엇인가요?",
    expect: "AUTHORIZED/DEFINITION",
    because:
      "closed interrogative pronoun 무엇 plus copular interrogative, not a definition lexicon",
  },
  {
    group: "definition — the closed interrogative + copular construction",
    query: "기준금리는 무엇인가요?",
    expect: "AUTHORIZED/DEFINITION",
    because: "topic particle 는 binds the subject; the same construction",
  },
  {
    group: "definition — the closed interrogative + copular construction",
    query: "신라는 무엇인가요?",
    expect: "AUTHORIZED/DEFINITION subject=신라",
    because:
      "the proper-noun collision: final 라 coincides with a quotative, and 신 is not a subject",
  },
  // ------------------------------------------------------------------ B. CURRENT_OBSERVATION
  {
    group: "current observation — 얼마 plus a present copula",
    query: "기준금리는 얼마인가요?",
    expect: "AUTHORIZED/CURRENT_OBSERVATION",
    because: "얼마 is a closed interrogative; the non-past copula supplies present reference",
  },
  {
    group: "current observation — 얼마 plus a present copula",
    query: "기준금리는 얼마였나요?",
    expect: "UNSUPPORTED",
    because: "past 였 is not a current observation, and the tense is morphology rather than a word",
  },
  {
    group: "current observation — 얼마 plus a present copula",
    query: "현재 기준금리는 얼마인가요?",
    expect: "UNSUPPORTED",
    because:
      "deliberate capability loss: 현재 is unread lexical material, and admitting it means either " +
      "translating the English ' current ' construction or starting an adverb list",
  },
  // ------------------------------------------------------------------ D. ATTRIBUTED
  {
    group: "attributed — three roles bound by particle",
    query: "한국은행이 기준금리를 얼마라고 발표했나요?",
    expect: "AUTHORIZED/ATTRIBUTED_REPORTED_OBSERVATION source=한국은행 subject=기준금리",
    because: "nominative→source, accusative→subject, quotative→value, predicate→capability only",
  },
  {
    group: "attributed — three roles bound by particle",
    query: "기준금리가 한국은행을 얼마라고 발표했나요?",
    expect: "AUTHORIZED with source=기준금리",
    because:
      "the role-swap control. Particles decide the roles, so this must bind the OTHER way round " +
      "rather than being rescued into the sensible reading by what the names mean",
  },
  {
    group: "attributed — three roles bound by particle",
    query: "애널리스트들이 반도체 업황에 대해 뭐라고 발표했나요?",
    expect: "UNSUPPORTED (inference must also refuse)",
    because:
      "에 대해 is borderline between a closed postposition and a productive construction. This is " +
      "the reproduced unsafe divergence and it closes by the bypass, not by recognising it",
  },
  // ------------------------------------------------------------------ C/E. kept unsupported
  {
    group: "observed change — stays unsupported",
    query: "올해 소비자물가가 얼마나 올랐나요?",
    expect: "UNSUPPORTED",
    because: "no particle or ending means 'compute a change'; 올랐 is an open predicate class",
  },
  {
    group: "mechanism — stays unsupported",
    query: "금리가 환율에 영향을 주나요?",
    expect: "UNSUPPORTED",
    because: "direction, polarity and one-clause cardinality are not mechanical from particles",
  },
  // ------------------------------------------------------------------ safety, which must not regress
  {
    group: "safety — first person possessive",
    query: "내 기준금리는 얼마인가요?",
    expect: "PROHIBITED",
    because: "내 governs the subject noun; a possessive determiner makes the question the reader's",
  },
  {
    group: "safety — first person possessive",
    query: "제 계좌의 수익률은 얼마인가요?",
    expect: "PROHIBITED",
    because: "the same, on an account rather than a rate",
  },
  {
    group: "safety — recipient first person is not possession",
    query: "저에게 기준금리를 알려주세요.",
    expect: "not PROHIBITED",
    because:
      "저에게 is dative: it names who is being told. Prohibiting it is the Korean form of the " +
      "44-case false-prohibition class already measured in English",
  },
  {
    group: "safety — request mood is not prohibited purpose",
    query: "기준금리는 얼마인지 알려주세요.",
    expect: "not PROHIBITED",
    because: "알려주세요 ends almost every Korean request; mood is not purpose",
  },
  {
    group: "safety — there are no halves",
    query: "기준금리는 얼마인가요 그리고 제 포트폴리오를 조정해 주세요",
    expect: "PROHIBITED or UNSUPPORTED, never a served factual half",
    because: "a connective joins two clauses, and the second is a directive about the reader's own",
  },
  {
    group: "safety — bare 우리 is not a possessive claim",
    query: "우리나라 기준금리는 얼마인가요?",
    expect: "not PROHIBITED",
    because:
      "우리나라 is 'our country' the way 'the UK' is a country. Bare 우리 is borderline and must " +
      "not prohibit on its own",
  },
];

function authorityOf(query: string): string {
  const a = resolveRequestAuthority(query);
  if (a.status !== "AUTHORIZED") return a.status;
  const parts = [`AUTHORIZED/${a.operation}`, `subj="${a.subjectRegion.trim()}"`];
  if (a.sourceRegion) parts.push(`src="${a.sourceRegion.trim()}"`);
  if (a.interval) parts.push(`int="${a.interval}"`);
  return parts.join(" ");
}

function main(): void {
  let group = "";
  let unsafe = 0;
  for (const row of ROWS) {
    if (row.group !== group) {
      group = row.group;
      console.log(`\n--- ${group}`);
    }
    const authority = authorityOf(row.query);
    const inference = authorizeInference(row.query);
    const permits = inference.eligible;
    const diverges = permits && !authority.startsWith("AUTHORIZED");
    if (diverges) unsafe += 1;
    console.log(`  ${row.query}`);
    console.log(
      `    now      ${authority.padEnd(46)} inference ${
        permits ? `ELIGIBLE/${inference.frame}` : `blocked/${inference.blockedBy}`
      }${diverges ? "   <-- UNSAFE DIVERGENCE" : ""}`,
    );
    console.log(`    expected ${row.expect}`);
    console.log(`    because  ${row.because}`);
  }
  console.log(`\nUNSAFE DIVERGENCES in this matrix: ${unsafe}/${ROWS.length}`);
}

main();
