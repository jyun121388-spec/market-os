/**
 * Can a record from source Y answer a request explicitly attributed to source X?
 *
 * IR-107 B2-C. `CanonicalPlannerRequest` carries `sourceRegion`, and
 * `deriveCanonicalCandidateEnvelope` never reads it: the ATTRIBUTED_REPORTED_OBSERVATION branch
 * resolves by SUBJECT series identity alone. The legacy envelope likewise delegates third-party
 * reported facts to subject authority with no requested-source binding, and final FACT candidate
 * membership checks `seriesId` against `envelope.seriesIds`, where no source identity is
 * represented at all.
 *
 * So the question is not whether attribution is enforced weakly. It is whether attribution is a
 * candidate-authority dimension AT ALL on those paths. This measures it before any code changes.
 *
 * A wrong-source answer is a specific and serious failure for this product: publishing a figure as
 * "what X reported" when the figure came from Y is a false attribution to a named organisation,
 * carrying a true number. The number being real is what makes it credible.
 *
 * FOUR DOORS, because a repair proven on one of them is not a repair:
 *   deterministic   `askMarket` -- already source-bound; the control that says the fixture works
 *   canonical       `deriveCanonicalCandidateEnvelope` -- planner-facing
 *   legacy          `deriveLegacyCandidateEnvelope`
 *   planner         `answerWithInference` with a COUNTING sink, so "no model call" is measured
 *                   rather than assumed
 *
 * THREE INVENTORY STATES x SIX REQUEST SHAPES. The states matter because Y-only is where
 * substitution shows: with only X stored a wrong answer is indistinguishable from no answer.
 *
 * ## Why the provider names end in `Analysts`
 *
 * Not decoration, and not a fixture bent to produce a failure. The first run of this script used
 * `Xraywire Analytics` and reported NO substitution -- because every canonical row came back
 * `blocked/FRAME_NOT_ELIGIBLE`, so the branch under test was never entered. A clean result from a
 * door that never opened is not evidence of anything, which is the trap this whole file exists to
 * avoid.
 *
 * `authorizeInference` admits `THIRD_PARTY_REPORTED_FACT`, and the frame classifier proves that
 * frame from third-party vocabulary in the request. `What did <name> analysts publish about X?` is
 * therefore eligible and CANONICAL and planner-permitted, while `What did <name> Analytics publish
 * about X?` is not -- measured, not assumed. Any real provider whose name reads as a research house
 * lands on the reachable side, so this is an ordinary shape rather than a contrived one.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx scripts/reproduce-source-substitution.ts
 */

import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { answerWithInference, type InferenceSink } from "@/server/domain/askMarketInference";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { asPlannerRequest } from "@/server/domain/requestAuthority";
import {
  deriveCanonicalCandidateEnvelope,
  deriveLegacyCandidateEnvelope,
} from "@/server/domain/candidateEnvelope";

const X_CODE = "TESTSRC_XRAY";
const Y_CODE = "TESTSRC_YANKEE";
const X_NAME = "Xraywire Analysts";
const Y_NAME = "Yankeefeed Analysts";
/** THE SAME SEMANTIC SUBJECT under both providers. That is the whole point of the fixture. */
const SUBJECT = "TESTSRC Widget Price Index";

const day = 24 * 60 * 60 * 1000;

async function wipe() {
  const sources = await prisma.source.findMany({ where: { code: { in: [X_CODE, Y_CODE] } } });
  for (const source of sources) {
    await prisma.observation.deleteMany({ where: { sourceId: source.id } });
    await prisma.series.deleteMany({ where: { sourceId: source.id } });
  }
  await prisma.source.deleteMany({ where: { code: { in: [X_CODE, Y_CODE] } } });
}

async function seed(code: string, name: string) {
  const source = await prisma.source.create({ data: { code, name, tier: "TIER_S" } });
  const series = await prisma.series.create({
    data: {
      sourceId: source.id,
      externalId: `${code}_SERIES`,
      name: SUBJECT,
      unit: "index",
      frequency: "daily",
    },
  });
  for (const [ago, value] of [
    [1, code === X_CODE ? "101.0" : "202.0"],
    [2, code === X_CODE ? "100.0" : "200.0"],
  ] as const) {
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: new Date(Date.now() - ago * day),
        value,
        raw: {},
      },
    });
  }
  return { sourceId: source.id, seriesId: series.id };
}

/** Which provider a series id belongs to, so a published row can be named by its true origin. */
async function providerOf(seriesIds: readonly string[]): Promise<string> {
  if (seriesIds.length === 0) return "none";
  const rows = await prisma.series.findMany({
    where: { id: { in: [...seriesIds] } },
    include: { source: { select: { code: true } } },
  });
  return rows.map((r) => r.source.code).join(",");
}

/**
 * A sink that records every call instead of making one.
 *
 * Written against the real `InferenceSink` contract rather than a guessed one, and that correction
 * matters: the first version defined `plan`/`write`, so `answerWithInference` threw
 * `sink.generatePlan is not a function` the moment it reached the planner. The run still printed
 * `calls=0`, which would have read as "no model call" when the truth was "the call was attempted
 * and my stub was the wrong shape". A zero that comes from a crash is not a zero.
 */
function countingSink() {
  const calls: string[] = [];
  const sink: InferenceSink = {
    generatePlan: async () => {
      calls.push("generatePlan");
      return { segments: [] };
    },
  };
  return { calls, sink };
}

async function measure(label: string, queries: { id: string; query: string }[]) {
  console.log(`\n=== ${label}`);
  console.log(
    `  ${"id".padEnd(6)} ${"deterministic".padEnd(26)} ${"canonical".padEnd(30)} ` +
      `${"legacy".padEnd(26)} planner`,
  );
  const rows: Record<string, string> = {};
  for (const { id, query } of queries) {
    const served = await askMarket(query);
    const deterministic = `${served.status}/${served.seriesFactors
      .map((f) => f.sourceCode)
      .join(",")}`;

    let canonical = "-";
    const authorization = authorizeInference(query);
    if (authorization.eligible && authorization.provenance === "CANONICAL") {
      const plannerRequest = asPlannerRequest(authorization.request);
      if (plannerRequest === null) canonical = "not-planner-permitted";
      else {
        const envelope = await deriveCanonicalCandidateEnvelope(query, plannerRequest);
        canonical = `${envelope.status}/${await providerOf(envelope.seriesIds)}`;
      }
    } else if (authorization.eligible) {
      canonical = `provenance/${authorization.provenance}`;
    } else {
      canonical = `blocked/${authorization.blockedBy}`;
    }

    let legacy = "-";
    try {
      const envelope = await deriveLegacyCandidateEnvelope(query);
      legacy = `${envelope.status}/${await providerOf(envelope.seriesIds)}`;
    } catch (error) {
      legacy = `THREW ${(error as Error).message.slice(0, 20)}`;
    }

    const { calls, sink } = countingSink();
    let planner = "-";
    try {
      const outcome = await answerWithInference(query, sink);
      planner = `${outcome.status}/calls=${calls.length}`;
    } catch (error) {
      planner = `THREW ${(error as Error).message.slice(0, 20)}/calls=${calls.length}`;
    }

    rows[id] = `${deterministic}|${canonical}|${legacy}|${planner}`;
    console.log(
      `  ${id.padEnd(6)} ${deterministic.padEnd(26)} ${canonical.padEnd(30)} ` +
        `${legacy.padEnd(26)} ${planner}`,
    );
  }
  return rows;
}

const PROBES = [
  { id: "EXACT", query: `What did ${X_NAME} publish about ${SUBJECT}?` },
  { id: "CODE", query: `What did ${X_CODE} publish about ${SUBJECT}?` },
  { id: "OTHER", query: `What did ${Y_NAME} publish about ${SUBJECT}?` },
  { id: "AMBIG", query: `What did ${X_NAME} ${Y_NAME} publish about ${SUBJECT}?` },
  { id: "RESID", query: `What did ${X_NAME} Purchase Gamma shares publish about ${SUBJECT}?` },
  { id: "UNKNWN", query: `What did Nowhere Research publish about ${SUBJECT}?` },
];

async function main() {
  await wipe();

  await seed(X_CODE, X_NAME);
  const xOnly = await measure(`S1  only ${X_CODE} publishes "${SUBJECT}"`, PROBES);

  await wipe();
  await seed(Y_CODE, Y_NAME);
  const yOnly = await measure(
    `S2  only ${Y_CODE} publishes "${SUBJECT}"  <-- SUBSTITUTION SHOWS HERE`,
    PROBES,
  );

  await wipe();
  await seed(X_CODE, X_NAME);
  await seed(Y_CODE, Y_NAME);
  const both = await measure(`S3  BOTH publish "${SUBJECT}"`, PROBES);

  await wipe();
  await prisma.$disconnect();

  // ------------------------------------------------------------------------------------------
  // The finding, stated as a property rather than left to the reader.
  //
  // In S2 the repository holds NOTHING from X. Any door that returns a candidate for a request
  // naming X is offering Y's record as X's, and the number in it is real -- which is exactly what
  // makes a false attribution credible.
  // ------------------------------------------------------------------------------------------
  console.log(`\n--- WRONG-SOURCE SUBSTITUTION (S2: only ${Y_CODE} stored, requests name X)`);
  const violations: string[] = [];
  for (const id of ["EXACT", "CODE"]) {
    const [deterministic, canonical, legacy, planner] = yOnly[id].split("|");
    for (const [door, value] of [
      ["deterministic", deterministic],
      ["canonical", canonical],
      ["legacy", legacy],
      ["planner", planner],
    ] as const) {
      if (value.includes(Y_CODE)) violations.push(`${id}/${door} -> ${value}`);
    }
  }
  for (const v of violations) console.log(`  SUBSTITUTION  ${v}`);
  console.log(
    violations.length > 0
      ? `\nREPRODUCED. ${violations.length} door/shape combination(s) offered ${Y_CODE}'s record ` +
          `for a request naming ${X_NAME}.`
      : `\nNo substitution over these probes.`,
  );

  console.log(`\n--- S1/S3 rows, for the non-vacuity and ambiguity questions`);
  for (const { id } of PROBES) {
    console.log(`  ${id.padEnd(6)} S1 ${xOnly[id]}`);
    console.log(`  ${"".padEnd(6)} S3 ${both[id]}`);
  }
}

void main();
