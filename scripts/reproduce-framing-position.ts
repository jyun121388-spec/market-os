/**
 * Does a framing word before an identity change what the request IS -- and does the DATABASE decide?
 *
 * IR-107 Unit 2, the next bounded unit after the redirect repair. `FRAMING_TOKENS` is one global,
 * position-insensitive bag. `process`, `mechanism` and `procedure` are in it deliberately, because
 * `What process connects A to B?` is a real construction where `process` frames the question. The
 * bag does not know that, so it also strips the word when it sits in front of a stored name.
 *
 * Two claims to separate, because only the second is clearly a defect:
 *
 *   1. `Explain how process A affects B.` authorizes as a relation between A and B. Arguable: a
 *      user may well mean that, and it was measured identically on all three doors, so it is shared
 *      rather than a divergence.
 *
 *   2. THE SAME SENTENCE MEANS DIFFERENT THINGS DEPENDING ON WHAT IS STORED. With `A -> B` in the
 *      repository the sentence is a question about A; with `Process A -> B` stored instead it is a
 *      question about `Process A`. Grammar is being decided by inventory. That is the property this
 *      script exists to measure, and it is why the repair cannot be a token rule -- POSITION and
 *      CONSTRUCTION decide grammatical role, not membership in a global bag.
 *
 * Three inventory states, the same probes in each. A row whose parse changes between S1 and S2 is
 * the defect; a row that stays constant is the parser deciding grammar on its own, which is what it
 * must do.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx --tsconfig tsconfig.json \
 *   scripts/reproduce-framing-position.ts
 */
import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { resolveRequestAuthority, asPlannerRequest } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import {
  deriveCanonicalCandidateEnvelope,
  deriveLegacyCandidateEnvelope,
} from "@/server/domain/candidateEnvelope";

const A = "TEST Frame Alpha";
const PA = "Process TEST Frame Alpha";
const B = "TEST Frame Beta";

const PROBES = [
  { id: "F1", query: `Explain how process ${A} affects ${B}.` },
  { id: "F2", query: `Explain how mechanism ${A} affects ${B}.` },
  { id: "F3", query: `Explain how procedure ${A} affects ${B}.` },
  // Positive controls. PC1 is the construction the framing allowlist exists FOR -- if a repair
  // breaks this, it has traded one wrong answer for another. PC2 is the plain relation, which must
  // keep working throughout.
  { id: "PC1", query: `What process connects ${A} to ${B}?` },
  { id: "PC2", query: `Explain how ${A} affects ${B}.` },
];

async function clean() {
  await prisma.causalEdge.deleteMany({ where: { fromVariable: { in: [A, PA] } } });
}

async function seed(from: string) {
  await prisma.causalEdge.create({
    data: {
      fromVariable: from,
      toVariable: B,
      direction: "POSITIVE",
      confidence: "MEDIUM",
      mechanism: "test transmission mechanism",
      evidence: "test fixture",
      lag: "1 quarter",
      counterexamples: "test fixture",
    },
  });
}

/**
 * Which stored edge a door actually selected, by name -- not how many.
 *
 * The first version of this printed counts, and counts cannot see the thing being measured: two
 * doors that both answer "1 edge" may have chosen DIFFERENT edges from the same request. In S3,
 * where both `A -> B` and `Process A -> B` are stored, that distinction is the whole finding.
 */
async function edgeNames(ids: readonly string[]): Promise<string> {
  if (ids.length === 0) return "none";
  const rows = await prisma.causalEdge.findMany({ where: { id: { in: [...ids] } } });
  return rows.map((e) => `${e.fromVariable} -> ${e.toVariable}`).join(", ");
}

async function canonicalDoor(query: string): Promise<string> {
  const authorization = authorizeInference(query);
  if (!authorization.eligible) return `blocked/${authorization.blockedBy}`;
  if (authorization.provenance !== "CANONICAL") return `provenance/${authorization.provenance}`;
  const plannerRequest = asPlannerRequest(authorization.request);
  if (plannerRequest === null) return "not-planner-permitted";
  const envelope = await deriveCanonicalCandidateEnvelope(query, plannerRequest);
  return `${envelope.status} ${await edgeNames(envelope.causalEdgeIds)}`;
}

async function measure(stateLabel: string) {
  console.log(`\n=== ${stateLabel}`);
  console.log(
    `  id   ${"cause region".padEnd(30)} ${"parse".padEnd(22)} ${"deterministic".padEnd(30)} ` +
      `${"legacy door".padEnd(24)} canonical door`,
  );
  const parses: Record<string, string> = {};
  for (const { id, query } of PROBES) {
    const a = resolveRequestAuthority(query);
    const cause = a.status === "AUTHORIZED" ? (a.causeRegion ?? "-") : "-";
    const parse = a.status === "AUTHORIZED" ? a.operation : a.status;

    const served = await askMarket(query);
    const edges = served.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`);
    const deterministic = `${served.status}${edges.length ? " " + JSON.stringify(edges) : ""}`;

    let legacy = "-";
    try {
      const e = await deriveLegacyCandidateEnvelope(query);
      legacy = `${e.status}/${e.causalEdgeIds.length} edge(s)`;
    } catch (error) {
      legacy = `THREW ${(error as Error).message.slice(0, 24)}`;
    }

    const canonical = await canonicalDoor(query);

    parses[id] = `${parse}|${cause}`;
    console.log(
      `  ${id.padEnd(4)} ${cause.padEnd(30)} ${parse.padEnd(22)} ${deterministic.padEnd(30)} ` +
        `${legacy.padEnd(24)} ${canonical}`,
    );
  }
  return parses;
}

async function main() {
  await clean();

  await seed(A);
  const s1 = await measure(`S1  only "${A} -> ${B}" stored`);

  await clean();
  await seed(PA);
  const s2 = await measure(`S2  only "${PA} -> ${B}" stored`);

  await clean();
  await seed(A);
  await seed(PA);
  const s3 = await measure(`S3  BOTH stored`);

  await clean();
  await prisma.$disconnect();

  // The parse -- operation plus cause region -- is a claim about GRAMMAR. It must be identical in
  // all three states, because the same sentence has the same structure whatever the repository
  // happens to hold. Any id listed here is inventory deciding grammar.
  console.log(`\n--- parse stability across inventory states`);
  const unstable = PROBES.filter(({ id }) => !(s1[id] === s2[id] && s2[id] === s3[id])).map(
    ({ id }) => id,
  );
  for (const { id } of PROBES) {
    const mark = unstable.includes(id) ? "INVENTORY-DEPENDENT" : "stable            ";
    console.log(`  ${id.padEnd(4)} ${mark}  S1 ${s1[id]}   S2 ${s2[id]}   S3 ${s3[id]}`);
  }
  console.log(
    `\nREPRODUCED if any probe is INVENTORY-DEPENDENT. Inventory-dependent parses: ` +
      `${unstable.length}/${PROBES.length}`,
  );
}

void main();
