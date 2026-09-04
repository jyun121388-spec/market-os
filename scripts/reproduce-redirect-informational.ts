/**
 * Does the advice redirect publish company facts that its neutral form refuses?
 *
 * Codex finding 2 on 76fbaf5, P1. I repaired the CAUSAL side of the redirect because that is what
 * I had reproduced, and asked review explicitly whether the same class was open on the company and
 * series retrievals. It is.
 *
 *     "Define X."                    -> REQUEST_NOT_SUPPORTED, no facts. This repository holds no
 *                                       glossary, so a DEFINITION request has no record class.
 *     "Should I buy X? Define X."    -> REDIRECTED, and the redirect's WIDE company lookup over the
 *                                       whole prohibited string finds X and publishes its figures.
 *
 * The refusal publishes what the neutral form refuses to publish, which is the same defect as the
 * causal one with a different record class. `findCompanyFacts` needs only the company name to
 * occur somewhere in the string; the DEFINITION operation's own refusal never runs.
 *
 * The affirmative relation row is measured here too, because review answered CONTRACT_BREACH on it
 * and the repair for both is the same: a PROHIBITED authority must carry the informational
 * constituent it recognized, and the redirect must use that operation's normal selector.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx --tsconfig tsconfig.json \
 *   scripts/reproduce-redirect-informational.ts
 */
import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";

const SOURCE_CODE = "TEST_REDIRECT_INFO";
const CORP_CODE = "0009999777";
const CORP_NAME = "TEST Redirect Holdings Inc.";
const CAUSE = "TEST Info Cause";
const EFFECT = "TEST Info Effect";

async function clean(sourceId?: string) {
  if (sourceId) {
    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });
  }
  await prisma.causalEdge.deleteMany({ where: { fromVariable: CAUSE } });
}

async function main() {
  const source = await prisma.source.upsert({
    where: { code: SOURCE_CODE },
    update: {},
    create: { code: SOURCE_CODE, name: "Redirect informational probe", tier: "TIER_S" },
  });
  await clean(source.id);

  const day = 24 * 60 * 60 * 1000;
  const iso = (n: number) => new Date(Date.now() - n * day).toISOString().slice(0, 10);

  await prisma.filing.create({
    data: {
      sourceId: source.id,
      corpCode: CORP_CODE,
      corpName: CORP_NAME,
      reportName: "10-Q",
      receiptNo: "9999-0777",
      receiptDate: new Date(`${iso(30)}T00:00:00.000Z`),
      raw: {},
    },
  });
  for (const f of [
    { concept: "Revenues", value: "12000000000", periodEnd: iso(30) },
    { concept: "Revenues", value: "11000000000", periodEnd: iso(120) },
  ]) {
    await prisma.financialFact.create({
      data: {
        sourceId: source.id,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: f.concept,
        accessionNumber: "9999-0777",
        unit: "USD",
        value: f.value,
        periodStart: new Date(`${iso(120)}T00:00:00.000Z`),
        periodEnd: new Date(`${f.periodEnd}T00:00:00.000Z`),
        fiscalYear: 2026,
        fiscalPeriod: "Q3",
        form: "10-Q",
        filedDate: new Date(`${iso(30)}T00:00:00.000Z`),
        raw: {},
      },
    });
  }

  await prisma.causalEdge.create({
    data: {
      fromVariable: CAUSE,
      toVariable: EFFECT,
      direction: "POSITIVE",
      confidence: "MEDIUM",
      mechanism: "test transmission mechanism",
      evidence: "test fixture",
      lag: "1 quarter",
      counterexamples: "test fixture",
    },
  });

  const CASES = [
    {
      label: "definition / company",
      neutral: `Define ${CORP_NAME}`,
      advice: `Should I buy ${CORP_NAME}? Define ${CORP_NAME}`,
    },
    {
      label: "affirmative relation",
      neutral: `Explain how ${CAUSE} affects ${EFFECT}.`,
      advice: `Should I buy ${CAUSE}? Explain how ${CAUSE} affects ${EFFECT}.`,
    },
    // Control: the topical case the enforced invariant already covers. It must stay in parity, or
    // a repair has broken the half that was working.
    {
      label: "topical (control)",
      neutral: `What is the current ${CORP_NAME}?`,
      advice: `Should I buy ${CORP_NAME}?`,
    },
  ];

  let divergent = 0;
  for (const { label, neutral, advice } of CASES) {
    const n = await askMarket(neutral);
    const a = await askMarket(advice);
    const shape = (r: typeof n) =>
      `series ${r.seriesFactors.length} / causal ${r.causalFactors.length} / company ${r.companyFacts.length}`;
    const same = shape(n) === shape(a);
    if (!same) divergent += 1;
    console.log(`  ${label.padEnd(22)} neutral  ${n.status.padEnd(24)} ${shape(n)}`);
    console.log(`  ${" ".repeat(22)} ADVICE   ${a.status.padEnd(24)} ${shape(a)}`);
    console.log(`  ${" ".repeat(22)} PARITY:  ${same ? "same" : "DIVERGENT"}\n`);
  }

  await clean(source.id);
  await prisma.source.delete({ where: { id: source.id } });
  await prisma.$disconnect();
  console.log(`REPRODUCED if any case is DIVERGENT. Divergent: ${divergent}/${CASES.length}`);
}

void main();
