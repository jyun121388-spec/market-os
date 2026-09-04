/**
 * Does the advice redirect publish causal edges its neutral twin would refuse?
 *
 * IR-107 Unit 2, parity review of bc9c6b5, finding 10. The redirect branch ran a WIDE topical edge
 * search that no authorized operation uses: `CAUSAL_EDGE` serves `findMechanismEdges` on resolved,
 * oriented, exactly-framed regions, and every other branch publishes no edges at all. So the
 * redirect had a publishing rule of its own, looser than the only real one.
 *
 * The redirect's stated contract is that it shows exactly the factors its neutral twin would show,
 * so this measures BOTH directions. Showing an edge the twin refuses is the reported defect;
 * showing none where the twin shows one would be the same contract broken by the repair. Which of
 * those is even reachable depends on whether an advice-framed relation still resolves as an
 * AUTHORIZED CAUSAL_EDGE, so the authority resolution is printed rather than assumed.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx --tsconfig tsconfig.json \
 *   scripts/reproduce-redirect-parity.ts
 */
import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

const A = "TEST Redirect Cause";
const B = "TEST Redirect Effect";

async function clean() {
  await prisma.causalEdge.deleteMany({ where: { fromVariable: A } });
}

/** The neutral twin of each advice form: the same relation, with the advice framing removed. */
const CASES = [
  {
    label: "affirmative",
    neutral: `Explain how ${A} affects ${B}.`,
    advice: `Should I buy ${A}? Explain how ${A} affects ${B}.`,
  },
  {
    label: "denial",
    neutral: `Explain how it is false that ${A} affects ${B}.`,
    advice: `Should I buy ${A}? Explain how it is false that ${A} affects ${B}.`,
  },
  {
    label: "conditional",
    neutral: `Explain how ${A} affects ${B} only if something else.`,
    advice: `Should I buy ${A}? Explain how ${A} affects ${B} only if something else.`,
  },
];

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

  let divergent = 0;
  for (const { label, neutral, advice } of CASES) {
    for (const [side, query] of [
      ["neutral twin", neutral],
      ["ADVICE form ", advice],
    ] as const) {
      const authority = resolveRequestAuthority(query);
      const operation = authority.status === "AUTHORIZED" ? authority.operation : "-";
      const result = await askMarket(query);
      const edges = result.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`);
      console.log(
        `  ${label.padEnd(12)} ${side}  ${authority.status.padEnd(12)} ${operation.padEnd(14)} ` +
          `${result.status.padEnd(32)} ${JSON.stringify(edges)}`,
      );
    }
    const n = await askMarket(neutral);
    const a = await askMarket(advice);
    const same =
      JSON.stringify(n.causalFactors.map((f) => [f.fromVariable, f.toVariable])) ===
      JSON.stringify(a.causalFactors.map((f) => [f.fromVariable, f.toVariable]));
    if (!same) divergent += 1;
    console.log(`  ${" ".repeat(12)} PARITY: ${same ? "same" : "DIVERGENT"}\n`);
  }

  await clean();
  await prisma.$disconnect();
  console.log(`REPRODUCED if any row is DIVERGENT. Divergent cases: ${divergent}/${CASES.length}`);
}

void main();
