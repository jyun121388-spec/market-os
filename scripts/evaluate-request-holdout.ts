/**
 * Baseline run of the frozen request-authority corpus, against unchanged code.
 *
 * The corpus was frozen before any operation envelope existed, so this is the "before" column, not
 * a score to improve by tuning. If a case here later drives a change, the corpus becomes regression
 * evidence from that moment and a new one must be frozen before any generalisation claim.
 *
 * ## Four axes, because the first version collapsed them into one and got the finding wrong
 *
 * The earlier evaluator mapped every non-`PROHIBITED_REQUEST` refusal to `UNSUPPORTED` and called
 * the difference "leakage". That conflated three unrelated things and overstated the safety
 * problem: `DIRECTIVE_FRAME` is a real refusal with zero planner calls, and counting it as leakage
 * says the model was reached when it was not. The axes are now separate, and they are not equally
 * severe:
 *
 *   1. INFERENCE EXECUTION LEAK   a prohibited request that becomes planner-eligible.
 *                                 Execution authority, not wording. The severe one.
 *   2. REFUSAL-REASON ERROR       refused, but under a reason that misdescribes why.
 *                                 Not an execution defect; still wrong, and it is what decides
 *                                 whether the product redirects or shrugs.
 *   3. FALSE PROHIBITED LABEL     a permitted request reported as a legal refusal. The product
 *                                 telling someone they asked for advice when they asked for a
 *                                 definition.
 *   4. LIVE ASK REDIRECT MISS     a prohibited request for which `askMarket` does not return
 *                                 PERSONALIZED_ADVICE_REDIRECTED. This is the product behaviour,
 *                                 and it is measured on the real path rather than inferred.
 *
 * ## An empty database is not a safety boundary
 *
 * A prohibited request that returns `NOT_FOUND` because no stored factor happened to match is not
 * refused — it is unanswered by luck. The run therefore seeds factors for subjects the corpus's
 * prohibited requests actually name, and reports how many of the missed ones then return
 * answer-bearing content. That number is what production would do.
 *
 * No provider, no model, no network.
 */

import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { classifyRequestFrame } from "@/server/domain/requestFrame";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { askMarket, detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";
import { prisma } from "@/server/db/client";
import {
  REQUEST_AUTHORITY_HOLDOUT,
  REQUEST_AUTHORITY_SHA256,
  type RequestAuthorityCase,
} from "../tests/fixtures/requestAuthorityHoldout";
import { canonicalCorpusHash } from "../tests/fixtures/canonicalCorpusHash";

const SOURCE_CODE = "TEST_REQUEST_HOLDOUT";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * MS_PER_DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Subjects the corpus's prohibited requests name, so an empty factor set cannot mask a miss. */
const SEEDED_SUBJECTS = [
  "US CPI",
  "unemployment rate",
  "gold price",
  "policy rate",
  "Samsung Electronics share price",
];

const ANSWER_BEARING = new Set(["FACTORS_FOUND"]);

async function main() {
  const recomputed = canonicalCorpusHash(REQUEST_AUTHORITY_HOLDOUT);
  console.log(`holdout ${REQUEST_AUTHORITY_HOLDOUT.length} cases`);
  console.log(`  declared   ${REQUEST_AUTHORITY_SHA256}`);
  console.log(`  recomputed ${recomputed}`);
  if (recomputed !== REQUEST_AUTHORITY_SHA256) {
    throw new Error("Corpus integrity failed: the frozen hash does not match the cases.");
  }
  console.log("  integrity  OK — recomputed from the cases, not read back from the constant");

  const rows = REQUEST_AUTHORITY_HOLDOUT.map((c: RequestAuthorityCase) => {
    const auth = authorizeInference(c.query);
    return {
      c,
      eligible: auth.eligible,
      blockedBy: auth.eligible ? null : auth.blockedBy,
      frame: classifyRequestFrame(c.query),
      detector: detectPersonalizedAdviceRequest(c.query),
      // Two paths, two numbers. `authorizeInference` is not bound to request
      // authority, and letting one figure stand for both is the reporting mistake
      // this column exists to make impossible.
      authority: resolveRequestAuthority(c.query),
    };
  });

  const prohibited = rows.filter((r) => r.c.expected === "PROHIBITED");
  const permitted = rows.filter((r) => r.c.expected !== "PROHIBITED");

  // ---- axis 1 -----------------------------------------------------------------------------
  const executionLeak = prohibited.filter((r) => r.eligible);
  console.log(`\n1. INFERENCE EXECUTION LEAK: ${executionLeak.length}/${prohibited.length}`);
  for (const r of executionLeak) console.log(`   ${r.c.id} ${r.c.language}  ${r.c.query}`);
  if (executionLeak.length === 0) {
    console.log("   none — every prohibited request is refused before the planner");
  }

  // ---- axis 2 -----------------------------------------------------------------------------
  const PROHIBITED_REASONS = new Set(["PROHIBITED_REQUEST", "DIRECTIVE_FRAME"]);
  const reasonError = prohibited.filter(
    (r) => !r.eligible && !PROHIBITED_REASONS.has(String(r.blockedBy)),
  );
  console.log(`\n2. REFUSAL-REASON ERROR: ${reasonError.length}/${prohibited.length}`);
  const reasonTally: Record<string, number> = {};
  for (const r of prohibited) {
    const key = r.eligible ? "ELIGIBLE" : String(r.blockedBy);
    reasonTally[key] = (reasonTally[key] ?? 0) + 1;
  }
  console.log(`   reasons given for prohibited requests: ${JSON.stringify(reasonTally)}`);
  for (const r of reasonError) {
    console.log(`   ${r.c.id} ${r.c.language} ${r.blockedBy}  ${r.c.query.slice(0, 70)}`);
  }

  // ---- axis 3 -----------------------------------------------------------------------------
  const falseProhibited = permitted.filter(
    (r) => !r.eligible && PROHIBITED_REASONS.has(String(r.blockedBy)),
  );
  console.log(`\n3. FALSE PROHIBITED LABEL: ${falseProhibited.length}/${permitted.length}`);
  for (const r of falseProhibited) {
    console.log(
      `   ${r.c.id} ${r.c.language} expected ${r.c.expected} vocab=${r.c.carriesTradingVocabulary} ${r.blockedBy}`,
    );
    console.log(`      ${r.c.query}`);
  }

  // ---- capability, for the "before" column ------------------------------------------------
  const answerable = rows.filter((r) => r.c.expected === "ANSWERABLE");
  const authorized = (r: (typeof rows)[number]) => r.authority.status === "AUTHORIZED";
  console.log(
    `
ANSWERABLE admitted by the INFERENCE path (authorizeInference, unbound): ` +
      `${answerable.filter((r) => r.eligible).length}/${answerable.length}`,
  );
  console.log(
    `ANSWERABLE authorized by REQUEST AUTHORITY (resolveRequestAuthority, live askMarket): ` +
      `${answerable.filter(authorized).length}/${answerable.length}`,
  );
  const leaked = prohibited.filter(authorized);
  console.log(`PROHIBITED authorized by REQUEST AUTHORITY: ${leaked.length}/${prohibited.length}`);
  for (const r of leaked) console.log(`   ${r.c.id} ${r.c.language}  ${r.c.query}`);
  const byOp: Record<string, { total: number; admitted: number }> = {};
  const byLang: Record<string, { total: number; admitted: number }> = {};
  for (const r of answerable) {
    byOp[r.c.operation] ??= { total: 0, admitted: 0 };
    byOp[r.c.operation].total += 1;
    byLang[r.c.language] ??= { total: 0, admitted: 0 };
    byLang[r.c.language].total += 1;
    if (authorized(r)) {
      byOp[r.c.operation].admitted += 1;
      byLang[r.c.language].admitted += 1;
    }
  }
  for (const [op, v] of Object.entries(byOp).sort()) {
    console.log(`   ${op.padEnd(32)} ${v.admitted}/${v.total}`);
  }
  for (const [lang, v] of Object.entries(byLang).sort()) {
    console.log(`   ${lang.padEnd(32)} ${v.admitted}/${v.total}`);
  }

  const vocabInnocent = rows.filter(
    (r) => r.c.carriesTradingVocabulary && r.c.expected !== "PROHIBITED",
  );
  console.log(
    `\nTrading vocabulary without personalized intent, reported as prohibited: ` +
      `${vocabInnocent.filter((r) => !r.eligible && PROHIBITED_REASONS.has(String(r.blockedBy))).length}/${vocabInnocent.length}`,
  );

  // ---- axis 4, on the real path, with the empty-database excuse removed --------------------
  const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
  if (existing) {
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }
  const source = await prisma.source.create({
    data: { code: SOURCE_CODE, name: "Request holdout source", tier: "TIER_S" },
  });
  for (const [i, name] of SEEDED_SUBJECTS.entries()) {
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: `RAH_${i}`,
        name,
        unit: "percent",
        frequency: "weekly",
      },
    });
    for (const [j, value] of ["1.10", "2.40"].entries()) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: daysAgo(7 - j * 7),
          value,
          raw: {},
        },
      });
    }
  }

  const redirectMisses: { c: RequestAuthorityCase; status: string }[] = [];
  for (const r of prohibited) {
    const result = await askMarket(r.c.query);
    if (result.status !== "PERSONALIZED_ADVICE_REDIRECTED") {
      redirectMisses.push({ c: r.c, status: result.status });
    }
  }
  console.log(`\n4. LIVE ASK REDIRECT MISS: ${redirectMisses.length}/${prohibited.length}`);
  const missByLang: Record<string, number> = {};
  const missByStatus: Record<string, number> = {};
  for (const m of redirectMisses) {
    missByLang[m.c.language] = (missByLang[m.c.language] ?? 0) + 1;
    missByStatus[m.status] = (missByStatus[m.status] ?? 0) + 1;
  }
  console.log(`   by language ${JSON.stringify(missByLang)}`);
  console.log(`   by status   ${JSON.stringify(missByStatus)}`);

  const answerBearing = redirectMisses.filter((m) => ANSWER_BEARING.has(m.status));
  console.log(
    `\n   of those, answer-bearing rather than merely unanswered: ${answerBearing.length}`,
  );
  for (const m of answerBearing) {
    console.log(`   ${m.c.id} ${m.c.language} ${m.status}  ${m.c.query.slice(0, 74)}`);
  }
  console.log(
    `   the remaining ${redirectMisses.length - answerBearing.length} return a non-answer only ` +
      "because no seeded factor matched. That is luck, not a boundary: with the matching data\n" +
      "   ingested they would answer too.",
  );

  await prisma.observation.deleteMany({ where: { sourceId: source.id } });
  await prisma.series.deleteMany({ where: { sourceId: source.id } });
  await prisma.source.delete({ where: { id: source.id } });
  await prisma.$disconnect();

  console.log(
    "\nHistorical advice holdouts are untouched and are NOT evidence about changed behaviour;\n" +
      "they measured a phrase-list guardrail at 81% and 73.2% false negative, which is why this\n" +
      "unit builds a positive operation envelope instead of a longer list.",
  );
}

main();
