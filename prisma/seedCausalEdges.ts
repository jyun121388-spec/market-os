/**
 * Seeds the initial Economic Causal Graph edges. Idempotent: checks for an existing edge with
 * the same (fromVariable, toVariable, mechanism) before inserting, since CausalEdge has no
 * single natural-key column to upsert on (unlike Source.code).
 */
import { prisma } from "../src/server/db/client";
import { CAUSAL_EDGES } from "./causalEdges";

async function main() {
  let inserted = 0;
  let unchanged = 0;

  for (const edge of CAUSAL_EDGES) {
    const existing = await prisma.causalEdge.findFirst({
      where: {
        fromVariable: edge.fromVariable,
        toVariable: edge.toVariable,
        mechanism: edge.mechanism,
      },
    });

    if (existing) {
      unchanged++;
      continue;
    }

    await prisma.causalEdge.create({ data: edge });
    inserted++;
  }

  console.log(`Seeded causal edges: ${inserted} inserted, ${unchanged} already present.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
