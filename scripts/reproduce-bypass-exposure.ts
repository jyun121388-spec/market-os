/**
 * Do the classified bypass rows actually behave that way through the production door?
 *
 * IR-107 legacy-bypass measurement correction, §5. The corrected readiness script classifies from
 * corpus metadata, and a classification is a claim about the code, not evidence about it. A label
 * saying FALSE_ELIGIBILITY_EXPOSURE has to be shown reaching a planner with real candidate
 * evidence before anyone acts on it — and equally, a zero has to come from a refusal rather than
 * from an empty database or a thrown stub, which is how the previous measurement went wrong.
 *
 * So each representative row is run through `answerWithInference` with a COUNTING sink, twice:
 * once against an empty repository, once with fixtures that make the request genuinely answerable.
 * Only the seeded run can distinguish "refused" from "found nothing".
 *
 *   DATABASE_URL=...market_os_test npx tsx scripts/reproduce-bypass-exposure.ts
 */

import { prisma } from "@/server/db/client";
import { answerWithInference, type InferenceSink } from "@/server/domain/askMarketInference";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { deriveLegacyCandidateEnvelope } from "@/server/domain/candidateEnvelope";

const CODE = "TEST_BYPASS_EXPOSURE";
const day = 24 * 60 * 60 * 1000;

/** The exact corpus rows the corrected measurement classified, one per class. */
const ROWS = [
  {
    id: "DEV-EN-214",
    klass: "FALSE_ELIGIBILITY_EXPOSURE",
    expected: "REFUSED / AMBIGUOUS_CARDINALITY",
    query: "How does the unemployment rate work with inflation?",
  },
  {
    id: "DEV-EN-215",
    klass: "FALSE_ELIGIBILITY_EXPOSURE",
    expected: "REFUSED / AMBIGUOUS_CARDINALITY",
    query: "What is the mechanism for the policy rate?",
  },
  {
    id: "DEV-EN-123",
    klass: "DETERMINISTIC_VIA_PLANNER",
    expected: "ANSWERABLE / DEFINITION",
    query: "How does a repurchase agreement work?",
  },
  {
    id: "DEV-EN-096",
    klass: "TRUE_RECOGNITION_GAP",
    expected: "ANSWERABLE / ATTRIBUTED_REPORTED_OBSERVATION",
    query: "Consensus on US nonfarm payrolls - what has it been reported as?",
  },
];

/**
 * Fixtures chosen so the SUBJECTS these requests name really exist.
 *
 * The point is non-vacuity: `unemployment rate` and `inflation` are both stored, and a relation
 * between them is stored, so if the door still declines to hand a planner candidate evidence that
 * is a refusal rather than an empty shelf.
 */
async function seed() {
  await wipe();
  const source = await prisma.source.create({
    data: { code: CODE, name: "Consensus", tier: "TIER_S" },
  });
  for (const name of ["unemployment rate", "inflation", "policy rate", "US nonfarm payrolls"]) {
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: `${CODE}_${name.replace(/\s+/g, "_")}`,
        name,
        unit: "index",
        frequency: "monthly",
      },
    });
    for (const ago of [1, 32]) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: new Date(Date.now() - ago * day),
          value: "100.0",
          raw: {},
        },
      });
    }
  }
  for (const [from, to] of [
    ["unemployment rate", "inflation"],
    ["policy rate", "inflation"],
  ] as const) {
    await prisma.causalEdge.create({
      data: {
        fromVariable: from,
        toVariable: to,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "Seeded so the bypass has real evidence to reach for.",
        evidence: "Fixture only.",
        lag: "1 quarter",
        counterexamples: "Fixture edge.",
      },
    });
  }
}

async function wipe() {
  const sources = await prisma.source.findMany({ where: { code: CODE } });
  for (const s of sources) {
    await prisma.observation.deleteMany({ where: { sourceId: s.id } });
    await prisma.series.deleteMany({ where: { sourceId: s.id } });
  }
  await prisma.source.deleteMany({ where: { code: CODE } });
  await prisma.causalEdge.deleteMany({
    where: { fromVariable: { in: ["unemployment rate", "policy rate"] } },
  });
}

async function probe(query: string) {
  const calls: string[] = [];
  const sink: InferenceSink = {
    generatePlan: async (q: string) => {
      calls.push(q);
      return { segments: [] };
    },
  };
  const authorization = authorizeInference(query);
  const legacy = await deriveLegacyCandidateEnvelope(query);
  let outcome: string;
  try {
    outcome = (await answerWithInference(query, sink)).status;
  } catch (error) {
    // A thrown stub is not a zero. Say so rather than reporting calls=0.
    outcome = `THREW ${(error as Error).message.slice(0, 40)}`;
  }
  return {
    provenance: authorization.eligible
      ? authorization.provenance
      : `blocked/${authorization.blockedBy}`,
    legacy: `${legacy.status}/${legacy.seriesIds.length}s+${legacy.causalEdgeIds.length}e`,
    outcome,
    calls: calls.length,
  };
}

async function main() {
  for (const state of ["EMPTY", "SEEDED"] as const) {
    if (state === "EMPTY") await wipe();
    else await seed();
    console.log(`\n=== repository ${state} ===`);
    for (const row of ROWS) {
      const r = await probe(row.query);
      console.log(`  ${row.id} ${row.klass}`);
      console.log(`     corpus expects : ${row.expected}`);
      console.log(
        `     provenance=${r.provenance}  legacy=${r.legacy}  outcome=${r.outcome}  ` +
          `generatePlan calls=${r.calls}`,
      );
    }
  }
  await wipe();
  await prisma.$disconnect();

  console.log(
    `\nA planner call on a row the corpus marks REFUSED is the exposure. A planner call on a row ` +
      `whose expected operation is deterministic is the wrong door answering, not throughput.`,
  );
}

void main();
