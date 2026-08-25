/**
 * Does deterministic serving apply the same qualifier rule as inference candidate authority?
 *
 * IR-107 Unit 2. B2-B put `regionIsExactlyFramingAndIdentity` on both relation regions of the
 * canonical CANDIDATE path. `askMarket` serves mechanisms on its own deterministic path, takes the
 * same canonical `causeRegion`, and calls `explicitlyNamed` on it with no well-formedness check at
 * all — so the denial and the conditional may be answered there while the inference path refuses
 * them. Two answer-bearing paths, one request, opposite verdicts.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx --tsconfig tsconfig.json \
 *   scripts/reproduce-mechanism-parity.ts
 */
import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";

const A = "TEST Parity Cause";
const B = "TEST Parity Effect";

async function clean() {
  await prisma.causalEdge.deleteMany({ where: { fromVariable: A } });
}

async function main() {
  await clean();
  await prisma.causalEdge.create({
    data: {
      fromVariable: A,
      toVariable: B,
      direction: "POSITIVE",
      confidence: "MEDIUM",
      mechanism: "test transmission mechanism",
      evidence: "test fixture",
      lag: "1 quarter",
      counterexamples: "test fixture",
    },
  });

  for (const [label, query] of [
    ["affirmative (positive control)", `Explain how ${A} affects ${B}.`],
    ["cause qualified", `Explain how it is false that ${A} affects ${B}.`],
    ["effect qualified", `Explain how ${A} affects ${B} only if something else.`],
  ] as const) {
    const result = await askMarket(query);
    const edges = result.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`);
    console.log(`  ${label.padEnd(32)} ${result.status.padEnd(20)} ${JSON.stringify(edges)}`);
  }

  await clean();
  await prisma.$disconnect();
  console.log(
    "\nREPRODUCED if either qualified row serves the edge while the affirmative one does too.",
  );
}

void main();
