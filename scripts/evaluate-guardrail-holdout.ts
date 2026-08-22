/**
 * Runs a labelled corpus through the advice guardrail and writes a machine-readable result.
 *
 * Read-only with respect to the corpus and the detector: it imports both and writes one JSON file.
 * It exists so that "the holdout scored X" is a file somebody can check rather than a sentence in
 * a commit message, and so the two corpora can never be quietly averaged — every result names its
 * `classification`, and a `DEVELOPMENT_CORPUS` rate and a `FRESH_HOLDOUT` rate must never share a
 * denominator.
 *
 * Usage: `npm run eval:holdout` (fresh holdout) or `npm run eval:holdout -- development`.
 */

import { writeFileSync } from "node:fs";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import { classifyRequestFrame } from "@/server/domain/requestFrame";
import {
  ADVICE_GUARDRAIL_CORPUS,
  ADVICE_GUARDRAIL_CORPUS_KIND,
  type CorpusCase,
  type CorpusKind,
} from "../tests/fixtures/adviceGuardrailCorpus";
import {
  ADVICE_GUARDRAIL_HOLDOUT,
  HOLDOUT_KIND,
  HOLDOUT_VERSION,
} from "../tests/fixtures/adviceGuardrailHoldout";

const which = process.argv[2] === "development" ? "development" : "holdout";

const cases: CorpusCase[] =
  which === "holdout" ? ADVICE_GUARDRAIL_HOLDOUT : ADVICE_GUARDRAIL_CORPUS;
const classification: CorpusKind =
  which === "holdout" ? HOLDOUT_KIND : ADVICE_GUARDRAIL_CORPUS_KIND;
const corpusVersion = which === "holdout" ? HOLDOUT_VERSION : "development-2026-08-21-v1";

interface Bucket {
  caught: number;
  total: number;
}
const bump = (map: Record<string, Bucket>, key: string, caught: boolean) => {
  map[key] ??= { caught: 0, total: 0 };
  map[key].total += 1;
  if (caught) map[key].caught += 1;
};

let tp = 0;
let tn = 0;
const falsePositives: unknown[] = [];
const falseNegatives: unknown[] = [];
const perConcept: Record<string, Bucket> = {};
const perLanguage: Record<string, Bucket> = {};

for (const c of cases) {
  const refused = detectPersonalizedAdviceRequest(c.query);
  const correct = c.label === "MUST_REFUSE" ? refused : !refused;

  bump(perConcept, c.concept, correct);
  bump(perLanguage, c.lang, correct);

  if (c.label === "MUST_REFUSE") {
    if (refused) tp += 1;
    else
      falseNegatives.push({
        query: c.query,
        concept: c.concept,
        lang: c.lang,
        frame: classifyRequestFrame(c.query),
      });
  } else {
    if (!refused) tn += 1;
    else
      falsePositives.push({
        query: c.query,
        concept: c.concept,
        lang: c.lang,
        frame: classifyRequestFrame(c.query),
      });
  }
}

const refuseTotal = cases.filter((c) => c.label === "MUST_REFUSE").length;
const allowTotal = cases.length - refuseTotal;

const report = {
  corpusVersion,
  classification,
  // True by construction for the holdout: the fixture was committed before the detector ran, and
  // the commit that adds it contains no result. Checkable in the history rather than asserted.
  createdBeforeDetectorRun: which === "holdout",
  caseCount: cases.length,
  languages: Object.fromEntries(Object.entries(perLanguage).map(([k, v]) => [k, v.total])),
  conceptCounts: Object.fromEntries(Object.entries(perConcept).map(([k, v]) => [k, v.total])),
  truePositives: tp,
  trueNegatives: tn,
  falsePositives: falsePositives.length,
  falseNegatives: falseNegatives.length,
  // Each rate keeps its own denominator. A single "accuracy" would let a lopsided corpus hide a
  // one-sided failure, and this corpus is deliberately lopsided in difficulty.
  falseNegativeRate: `${falseNegatives.length} / ${refuseTotal}`,
  falsePositiveRate: `${falsePositives.length} / ${allowTotal}`,
  perConcept,
  perLanguage,
  individualErrors: { falseNegatives, falsePositives },
};

const out = `docs/evaluation/${which === "holdout" ? "holdout" : "development"}-guardrail-result.json`;
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`${classification}  ${corpusVersion}  ${cases.length} cases`);
console.log(`  TP ${tp}  TN ${tn}  FP ${falsePositives.length}  FN ${falseNegatives.length}`);
console.log(`  FN rate ${report.falseNegativeRate}   FP rate ${report.falsePositiveRate}`);
console.log(`  written to ${out}`);
